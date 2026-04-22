import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Meme, User, Vote, SuperFavorite, Session, SessionMeme, SessionUser
from app.schemas import DeadCheckRequest, DeadCheckResponse, MemeBatchCreate, MemeBatchResult, MemeCreate, MemeList, MemeOut

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


@router.post("/batch", response_model=MemeBatchResult)
def add_memes_batch(
    body: MemeBatchCreate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import multiple meme URLs at once, skipping duplicates. Max 1000 per call."""
    urls = list(dict.fromkeys(str(u) for u in body.urls))[:1000]  # dedupe + cap

    existing_urls = {
        row[0]
        for row in db.query(Meme.url)
        .filter(Meme.user_id == current_user.id, Meme.url.in_(urls))
        .all()
    }

    to_add = [u for u in urls if u not in existing_urls]
    skipped = len(urls) - len(to_add)

    for url in to_add:
        db.add(Meme(url=url, user_id=current_user.id))

    try:
        db.commit()
        return MemeBatchResult(imported=len(to_add), skipped=skipped, failed=0)
    except Exception:
        db.rollback()
        return MemeBatchResult(imported=0, skipped=skipped, failed=len(to_add))


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


@router.get("/rewind/review-stats")
def get_rewind_stats(
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get year-by-year review statistics for rewind view."""
    # Get all sessions where current user participated (as creator or participant)
    user_sessions = db.query(Session.id).filter(
        (Session.created_by == current_user.id) |
        (Session.participants.any(SessionUser.user_id == current_user.id))
    ).all()
    session_ids = [s[0] for s in user_sessions]

    if not session_ids:
        return {"years": {}}

    # Get all reviewed memes from those sessions
    reviewed_memes = (
        db.query(Meme)
        .join(SessionMeme)
        .filter(SessionMeme.session_id.in_(session_ids), Meme.reviewed_at.isnot(None))
        .order_by(Meme.reviewed_at.desc())
        .all()
    )

    if not reviewed_memes:
        return {"years": {}}

    # Get super favorites for quick lookup
    super_fav_ids = {
        row[0] for row in db.query(SuperFavorite.meme_id).all()
    }

    # Group by year
    by_year: dict[int, list] = {}
    for meme in reviewed_memes:
        year = meme.reviewed_at.year
        if year not in by_year:
            by_year[year] = []
        by_year[year].append(meme)

    # For each year, compute stats
    result = {}
    for year in sorted(by_year.keys(), reverse=True):
        memes_in_year = by_year[year]
        year_data = {
            "count": len(memes_in_year),
            "first_reviewed": min(m.reviewed_at for m in memes_in_year).isoformat(),
            "last_reviewed": max(m.reviewed_at for m in memes_in_year).isoformat(),
            "memes": [],
            "super_favorites": [],
        }

        # Get vote stats for each meme
        for meme in memes_in_year:
            votes_for_meme = (
                db.query(Vote.value)
                .filter(Vote.meme_id == meme.id)
                .all()
            )
            if votes_for_meme:
                vote_values = [v[0] for v in votes_for_meme]
                avg_vote = sum(vote_values) / len(vote_values)
                max_vote = max(vote_values)
                min_vote = min(vote_values)
            else:
                avg_vote = 0
                max_vote = 0
                min_vote = 0

            meme_data = {
                "id": meme.id,
                "url": meme.url,
                "reviewed_at": meme.reviewed_at.isoformat(),
                "avg_vote": round(avg_vote, 2),
                "max_vote": max_vote,
                "min_vote": min_vote,
                "vote_count": len(votes_for_meme),
                "is_super_favorite": meme.id in super_fav_ids,
            }
            year_data["memes"].append(meme_data)

            # Track super favorites separately
            if meme.id in super_fav_ids:
                year_data["super_favorites"].append(meme_data)

        # Calculate percentile for each meme (normalized by year average)
        if year_data["memes"]:
            avg_scores = [m["avg_vote"] for m in year_data["memes"]]
            year_avg = sum(avg_scores) / len(avg_scores) if avg_scores else 0

            for meme in year_data["memes"]:
                # Percentile: position in sorted list
                sorted_scores = sorted([m["avg_vote"] for m in year_data["memes"]], reverse=True)
                position = sorted_scores.index(meme["avg_vote"]) + 1
                meme["percentile"] = (100 * (len(sorted_scores) - position + 1)) / len(sorted_scores)
                # Deviation from year average
                meme["deviation_from_avg"] = round(meme["avg_vote"] - year_avg, 2)

        # Sort by average vote descending
        year_data["memes"].sort(key=lambda m: m["avg_vote"], reverse=True)

        # Pick best and worst
        if year_data["memes"]:
            year_data["best_meme"] = year_data["memes"][0]
            year_data["worst_meme"] = year_data["memes"][-1]
        else:
            year_data["best_meme"] = None
            year_data["worst_meme"] = None

        result[str(year)] = year_data

    return {"years": result}

