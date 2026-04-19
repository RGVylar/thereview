"""
Media downloader — uses yt-dlp Python API to fetch TikTok and Twitter/X
videos server-side so they can be served as plain <video> elements.

Optimisations:
  • yt-dlp imported once per process — no per-download Python startup cost
  • Max 480p — keeps file sizes small (TikTok looks fine at 480p)
  • Global semaphore — caps concurrent downloads at 6
  • 4 parallel HTTP fragments per video
  • In-memory progress tracking via yt-dlp progress hooks
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
from pathlib import Path
from typing import TypedDict

from app.database import SessionLocal

logger = logging.getLogger(__name__)

MEDIA_ROOT = Path(__file__).parent.parent / "media"

_DOWNLOADABLE = re.compile(
    r"(tiktok\.com|tiktokv\.com|twitter\.com|x\.com)",
    re.IGNORECASE,
)

# Max 6 concurrent yt-dlp downloads
_DL_SEMAPHORE = threading.Semaphore(6)

# In-memory progress: (session_id, meme_id) -> {downloaded, total, speed}
_progress_lock = threading.Lock()
_download_progress: dict[tuple[int, int], dict] = {}


class SessionProgress(TypedDict):
    downloaded_bytes: int
    total_bytes: int
    speed_bps: float
    active_count: int


def get_session_progress(session_id: int) -> SessionProgress | None:
    """Return aggregate download progress for all active downloads in a session."""
    with _progress_lock:
        relevant = {k: v for k, v in _download_progress.items() if k[0] == session_id}
    if not relevant:
        return None
    return SessionProgress(
        downloaded_bytes=sum(v["downloaded"] for v in relevant.values()),
        total_bytes=sum(v["total"] for v in relevant.values()),
        speed_bps=sum(v["speed"] for v in relevant.values()),
        active_count=len(relevant),
    )


def _make_progress_hook(session_id: int, meme_id: int):
    key = (session_id, meme_id)

    def hook(d: dict) -> None:
        if d["status"] == "downloading":
            with _progress_lock:
                _download_progress[key] = {
                    "downloaded": d.get("downloaded_bytes") or 0,
                    "total": d.get("total_bytes") or d.get("total_bytes_estimate") or 0,
                    "speed": d.get("speed") or 0.0,
                }
        elif d["status"] in ("finished", "error"):
            with _progress_lock:
                _download_progress.pop(key, None)

    return hook


def is_downloadable(url: str) -> bool:
    return bool(_DOWNLOADABLE.search(url))


def media_path(session_id: int, meme_id: int) -> Path:
    return MEDIA_ROOT / str(session_id) / f"{meme_id}.mp4"


def download_and_update(session_id: int, meme_id: int, url: str) -> None:
    """Download *url* and update MediaCache. Runs in a background thread."""
    from app.models import MediaCache

    print(f"[DL] Starting download: session={session_id}, meme={meme_id}, url={url}")

    out = media_path(session_id, meme_id)
    out.parent.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        cache = db.query(MediaCache).filter_by(session_id=session_id, meme_id=meme_id).first()
        if not cache:
            return

        if out.exists():
            cache.status = "ready"
            db.commit()
            return

        # Register as active immediately — shows in stats during URL extraction
        # and semaphore wait, not just during data transfer.
        with _progress_lock:
            _download_progress[(session_id, meme_id)] = {"downloaded": 0, "total": 0, "speed": 0.0}

        meta = _run_ytdlp(out, url, session_id, meme_id)

        # Re-fetch — session may have been deleted while downloading
        cache = db.query(MediaCache).filter_by(session_id=session_id, meme_id=meme_id).first()
        if not cache:
            if out.exists():
                out.unlink(missing_ok=True)
            return

        if out.exists():
            cache.status = "ready"
            if meta:
                import json
                cache.dl_metadata = json.dumps(meta, ensure_ascii=False)
        else:
            cache.status = "failed"
            cache.error = "yt-dlp produced no output file"
            print(f"[DL] yt-dlp no output [session={session_id} meme={meme_id}]")
        db.commit()

    except Exception as exc:
        error_msg = str(exc)[:500]
        print(f"[DL] yt-dlp failed [session={session_id} meme={meme_id}]: {error_msg}")
        try:
            cache = db.query(MediaCache).filter_by(session_id=session_id, meme_id=meme_id).first()
            if cache:
                cache.status = "failed"
                cache.error = error_msg
                db.commit()
        except Exception:
            pass
    finally:
        with _progress_lock:
            _download_progress.pop((session_id, meme_id), None)
        db.close()


_META_FIELDS = (
    "uploader", "uploader_id", "uploader_url",
    "like_count", "comment_count", "view_count",
    "duration", "title", "description",
)


def _run_ytdlp(out: Path, url: str, session_id: int, meme_id: int) -> dict:
    """Run yt-dlp via its Python API.  Returns extracted metadata dict (may be empty)."""
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp not installed in this environment")

    meta: dict = {}
    with _DL_SEMAPHORE:
        ydl_opts = {
            "outtmpl": str(out),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
            "merge_output_format": "mp4",
            "socket_timeout": 15,
            "retries": 2,
            "fragment_retries": 2,
            "concurrent_fragment_downloads": 4,
            "nopart": True,
            "progress_hooks": [_make_progress_hook(session_id, meme_id)],
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ie = ydl.extract_info(url, download=True)
            if ie:
                meta = {k: ie[k] for k in _META_FIELDS if ie.get(k) is not None}
    return meta


def cleanup_session_media(session_id: int) -> None:
    """Delete all downloaded files for a finished/deleted session."""
    session_dir = MEDIA_ROOT / str(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)
