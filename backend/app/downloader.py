"""
Media downloader — uses yt-dlp Python API to fetch TikTok and Twitter/X
videos server-side so they can be served as plain <video> elements.

Optimisations vs subprocess approach:
  • yt-dlp imported once per process — no per-download Python startup cost
  • Max 480p — keeps file sizes small (TikTok looks fine at 480p)
  • Global semaphore — caps concurrent downloads at 4 to avoid bandwidth
    contention and rate-limiting
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
from pathlib import Path

from app.database import SessionLocal

logger = logging.getLogger(__name__)

MEDIA_ROOT = Path(__file__).parent.parent / "media"

_DOWNLOADABLE = re.compile(
    r"(tiktok\.com|tiktokv\.com|twitter\.com|x\.com)",
    re.IGNORECASE,
)

# Max 4 concurrent yt-dlp downloads
_DL_SEMAPHORE = threading.Semaphore(4)


def is_downloadable(url: str) -> bool:
    return bool(_DOWNLOADABLE.search(url))


def media_path(session_id: int, meme_id: int) -> Path:
    return MEDIA_ROOT / str(session_id) / f"{meme_id}.mp4"


def download_and_update(session_id: int, meme_id: int, url: str) -> None:
    """Download *url* and update MediaCache. Runs in a background thread."""
    from app.models import MediaCache

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

        _run_ytdlp(out, url)

        if out.exists():
            cache.status = "ready"
        else:
            cache.status = "failed"
            cache.error = "yt-dlp produced no output file"
            logger.warning("yt-dlp no output [session=%s meme=%s]", session_id, meme_id)
        db.commit()

    except Exception as exc:
        error_msg = str(exc)[:500]
        logger.warning("yt-dlp failed [session=%s meme=%s]: %s", session_id, meme_id, error_msg)
        try:
            cache = db.query(MediaCache).filter_by(session_id=session_id, meme_id=meme_id).first()
            if cache:
                cache.status = "failed"
                cache.error = error_msg
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _run_ytdlp(out: Path, url: str) -> None:
    """Run yt-dlp via its Python API (no subprocess overhead)."""
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp not installed in this environment")

    with _DL_SEMAPHORE:
        ydl_opts = {
            "outtmpl": str(out),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            # Prefer ≤480p mp4; fall back to any mp4, then anything
            "format": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
            "merge_output_format": "mp4",
            "socket_timeout": 15,
            # Abort if a single fragment stalls for >30 s
            "retries": 2,
            "fragment_retries": 2,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])


def cleanup_session_media(session_id: int) -> None:
    """Delete all downloaded files for a finished/deleted session."""
    session_dir = MEDIA_ROOT / str(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)
