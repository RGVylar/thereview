import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Meme, User
from app.schemas import DeadCheckRequest, DeadCheckResponse, MemeCreate, MemeList, MemeOut

router = APIRouter(prefix="/api/memes", tags=["memes"])


def _check_tiktok_dead(url: str) -> bool:
    """Return True if the TikTok video appears deleted/unavailable. Best-effort."""
    try:
        match = re.search(r"/video/(\d+)", url)
        if not match:
            return False
        video_id = match.group(1)
        oembed_url = (
            "https://www.tiktok.com/oembed?url="
            + urllib.parse.quote(f"https://www.tiktok.com/video/{video_id}/", safe="")
        )
        req = urllib.request.Request(
            oembed_url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TheReview/1.0)"},
        )
        urllib.request.urlopen(req, timeout=8)
        return False  # 200 OK → alive
    except urllib.error.HTTPError as e:
        return e.code in (400, 404, 410)
    except Exception:
        return False  # network error → assume alive


@router.post("/check-dead", response_model=DeadCheckResponse)
def check_dead_urls(
    body: DeadCheckRequest,
    current_user: User = Depends(get_current_user),
):
    """Check which TikTok URLs are dead (server-side, no CORS issues)."""
    if not body.urls:
        return {"dead": []}
    dead: list[str] = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(_check_tiktok_dead, url): url for url in body.urls}
        for future in as_completed(futures):
            try:
                if future.result():
                    dead.append(futures[future])
            except Exception:
                pass
    return {"dead": dead}


@router.post("", response_model=MemeOut, status_code=status.HTTP_201_CREATED)
def add_meme(
    body: MemeCreate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(Meme).filter(
        Meme.user_id == current_user.id,
        Meme.url == str(body.url),
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Meme already exists")
    meme = Meme(url=str(body.url), user_id=current_user.id)
    db.add(meme)
    db.commit()
    db.refresh(meme)
    return meme


@router.get("", response_model=MemeList)
def list_my_memes(
    pending: bool = True,
    page: int = 1,
    per_page: int = 10,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base = db.query(Meme).filter(Meme.user_id == current_user.id)
    if pending:
        base = base.filter(Meme.reviewed_at.is_(None))

    total = base.count()
    items = (
        base.order_by(Meme.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_memes(
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete every meme belonging to the current user."""
    memes = db.query(Meme).filter(Meme.user_id == current_user.id).all()
    for meme in memes:
        db.delete(meme)
    db.commit()


@router.delete("/{meme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meme(
    meme_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meme = db.query(Meme).filter(Meme.id == meme_id).first()
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    if meme.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your meme")
    db.delete(meme)
    db.commit()

