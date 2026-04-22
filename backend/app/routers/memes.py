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
from app.thumbnails import batch_embed_thumbnails

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

    # Get all reviewed memes from those sessions (deduplicated by meme id)
    reviewed_memes = (
        db.query(Meme)
        .join(SessionMeme)
        .filter(SessionMeme.session_id.in_(session_ids), Meme.reviewed_at.isnot(None))
        .order_by(Meme.reviewed_at.desc())
        .all()
    )
    # Deduplicate: a meme can appear in multiple sessions
    seen_ids = set()
    unique_memes = []
    for m in reviewed_memes:
        if m.id not in seen_ids:
            seen_ids.add(m.id)
            unique_memes.append(m)
    reviewed_memes = unique_memes

    if not reviewed_memes:
        return {"years": {}}

    meme_ids = [m.id for m in reviewed_memes]

    # Bulk-load ALL votes for all memes in one query — avoids N+1
    all_vote_rows = (
        db.query(Vote.meme_id, Vote.value)
        .filter(Vote.meme_id.in_(meme_ids))
        .all()
    )
    votes_by_meme: dict[int, list[int]] = {}
    for meme_id, value in all_vote_rows:
        votes_by_meme.setdefault(meme_id, []).append(value)

    # Get super favorites for quick lookup
    super_fav_ids = {
        row[0] for row in db.query(SuperFavorite.meme_id)
        .filter(SuperFavorite.meme_id.in_(meme_ids)).all()
    }

    # Meme lookup by id
    meme_by_id = {m.id: m for m in reviewed_memes}

    # Group by year
    by_year: dict[int, list] = {}
    for meme in reviewed_memes:
        year = meme.reviewed_at.year
        by_year.setdefault(year, []).append(meme)

    # ── PASS 1: compute stats + rankings, no thumbnails yet ──
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

        for meme in memes_in_year:
            vote_values = votes_by_meme.get(meme.id, [])
            avg_vote = sum(vote_values) / len(vote_values) if vote_values else 0

            meme_data = {
                "id": meme.id,
                "url": meme.url,
                "thumbnail_url": meme.thumbnail_url,  # filled in pass 2
                "reviewed_at": meme.reviewed_at.isoformat(),
                "avg_vote": round(avg_vote, 2),
                "max_vote": max(vote_values) if vote_values else 0,
                "min_vote": min(vote_values) if vote_values else 0,
                "vote_count": len(vote_values),
                "is_super_favorite": meme.id in super_fav_ids,
            }
            year_data["memes"].append(meme_data)
            if meme.id in super_fav_ids:
                year_data["super_favorites"].append(meme_data)

        # Sort + percentile
        year_data["memes"].sort(key=lambda m: m["avg_vote"], reverse=True)
        n = len(year_data["memes"])
        if n:
            avg_scores = [m["avg_vote"] for m in year_data["memes"]]
            year_avg = sum(avg_scores) / n
            ranked_scores = sorted(set(avg_scores), reverse=True)
            rank_map = {score: i + 1 for i, score in enumerate(ranked_scores)}
            for meme in year_data["memes"]:
                rank = rank_map[meme["avg_vote"]]
                meme["percentile"] = round(100 * (n - rank + 1) / n, 1)
                meme["deviation_from_avg"] = round(meme["avg_vote"] - year_avg, 2)

        voted = [m for m in year_data["memes"] if m["vote_count"] > 0]
        year_data["best_meme"] = voted[0] if voted else None
        year_data["worst_meme"] = voted[-1] if voted else None

        result[str(year)] = year_data

    # ── PASS 2: resolve thumbnails only for displayed memes ──
    # Collect: top 3 + bottom 3 + up to 6 super favs per year
    display_urls: set[str] = set()
    for year_data in result.values():
        voted = [m for m in year_data["memes"] if m["vote_count"] > 0]
        for m in voted[:3] + voted[-3:]:
            display_urls.add(m["url"])
        for m in year_data["super_favorites"][:6]:
            display_urls.add(m["url"])

    # Only fetch thumbnails for memes without one already stored
    urls_needing_thumb = [u for u in display_urls if not next(
        (m.thumbnail_url for m in reviewed_memes if m.url == u and m.thumbnail_url), None
    )]
    live_thumbs = batch_embed_thumbnails(urls_needing_thumb) if urls_needing_thumb else {}

    # Build final thumbnail map and patch into meme dicts
    thumb_map: dict[str, str | None] = {}
    for meme in reviewed_memes:
        if meme.url in display_urls:
            thumb_map[meme.url] = meme.thumbnail_url or live_thumbs.get(meme.url)

    for year_data in result.values():
        for meme in year_data["memes"]:
            if meme["url"] in thumb_map:
                meme["thumbnail_url"] = thumb_map[meme["url"]]

    # Global statistics — reuse votes_by_meme, no extra queries
    all_avg_votes = []
    platform_counts: dict[str, int] = {}
    for meme in reviewed_memes:
        vote_values = votes_by_meme.get(meme.id, [])
        if vote_values:
            all_avg_votes.append(sum(vote_values) / len(vote_values))

        if "tiktok" in meme.url:
            platform = "tiktok"
        elif "twitter" in meme.url or "x.com" in meme.url:
            platform = "twitter"
        elif "instagram" in meme.url:
            platform = "instagram"
        elif "youtube" in meme.url:
            platform = "youtube"
        else:
            platform = "otro"
        platform_counts[platform] = platform_counts.get(platform, 0) + 1

    global_stats = {
        "total_memes": len(reviewed_memes),
        "avg_score": round(sum(all_avg_votes) / len(all_avg_votes), 2) if all_avg_votes else 0,
        "platform_breakdown": platform_counts,
    }

    return {"years": result, "global_stats": global_stats}

