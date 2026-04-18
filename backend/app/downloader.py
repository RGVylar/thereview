"""
Media downloader — uses yt-dlp to fetch TikTok and Twitter/X videos
server-side so they can be served as plain <video> elements, bypassing
all browser autoplay/iframe restrictions.

Downloads are triggered when a session is created and stored under
  backend/media/{session_id}/{meme_id}.mp4

Status is tracked in the MediaCache table:
  pending → ready | failed
"""
from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path

from app.database import SessionLocal

logger = logging.getLogger(__name__)

# Resolved at import time relative to this file → backend/media/
MEDIA_ROOT = Path(__file__).parent.parent / "media"

_DOWNLOADABLE = re.compile(
    r"(tiktok\.com|tiktokv\.com|twitter\.com|x\.com)",
    re.IGNORECASE,
)


def is_downloadable(url: str) -> bool:
    """Return True if yt-dlp can handle this URL (TikTok / Twitter)."""
    return bool(_DOWNLOADABLE.search(url))


def media_path(session_id: int, meme_id: int) -> Path:
    return MEDIA_ROOT / str(session_id) / f"{meme_id}.mp4"


def download_and_update(session_id: int, meme_id: int, url: str) -> None:
    """
    Download *url* with yt-dlp and update the MediaCache row accordingly.
    Designed to run inside a FastAPI BackgroundTask (sync thread pool).
    """
    from app.models import MediaCache  # local import avoids circular refs

    out = media_path(session_id, meme_id)
    out.parent.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        cache = (
            db.query(MediaCache)
            .filter_by(session_id=session_id, meme_id=meme_id)
            .first()
        )
        if not cache:
            return  # row was deleted (session finished) before download finished

        if out.exists():
            cache.status = "ready"
            db.commit()
            return

        result = subprocess.run(
            [
                sys.executable, "-m", "yt_dlp",
                "--no-playlist",
                "--quiet",
                "-f", "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
                "--merge-output-format", "mp4",
                "-o", str(out),
                url,
            ],
            capture_output=True,
            timeout=180,
        )

        if result.returncode == 0 and out.exists():
            cache.status = "ready"
        else:
            cache.status = "failed"
            cache.error = result.stderr.decode(errors="replace").strip()[-500:]
            logger.warning("yt-dlp failed [session=%s meme=%s]: %s", session_id, meme_id, cache.error)
        db.commit()

    except subprocess.TimeoutExpired:
        _mark_failed(db, session_id, meme_id, "Download timed out after 180 s")
    except FileNotFoundError:
        # yt-dlp not installed — fail silently, frontend falls back to embed
        _mark_failed(db, session_id, meme_id, "yt-dlp not found")
    except Exception as exc:
        _mark_failed(db, session_id, meme_id, str(exc))
    finally:
        db.close()


def _mark_failed(db, session_id: int, meme_id: int, error: str) -> None:
    from app.models import MediaCache

    cache = (
        db.query(MediaCache)
        .filter_by(session_id=session_id, meme_id=meme_id)
        .first()
    )
    if cache:
        cache.status = "failed"
        cache.error = error
        db.commit()


def cleanup_session_media(session_id: int) -> None:
    """Delete all downloaded files for a finished/deleted session."""
    session_dir = MEDIA_ROOT / str(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)
