from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Meme, Session, SessionMeme, SessionStatus, SessionUser, User, Vote
from app.schemas import RankingEntry, VoteCreate, VoteOut
from app.thumbnails import batch_embed_thumbnails

router = APIRouter(prefix="/api/sessions/{session_id}/votes", tags=["votes"])


@router.post("", response_model=VoteOut, status_code=status.HTTP_201_CREATED)
def cast_vote(
    session_id: int,
    body: VoteCreate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Session is not active")

    # Check participant
    is_participant = (
        db.query(SessionUser)
        .filter(
            SessionUser.session_id == session_id,
            SessionUser.user_id == current_user.id,
        )
        .first()
    )
    if not is_participant:
        raise HTTPException(status_code=403, detail="Not a participant")

    # Check meme is in session
    session_meme = (
        db.query(SessionMeme)
        .filter(
            SessionMeme.session_id == session_id,
            SessionMeme.meme_id == body.meme_id,
        )
        .first()
    )
    if not session_meme:
        raise HTTPException(
            status_code=400, detail="Meme is not part of this session"
        )

    # Check duplicate vote
    existing = (
        db.query(Vote)
        .filter(
            Vote.user_id == current_user.id,
            Vote.meme_id == body.meme_id,
            Vote.session_id == session_id,
        )
        .first()
    )
    if existing:
        # Update vote
        existing.value = body.value
        db.commit()
        db.refresh(existing)
        return existing

    vote = Vote(
        user_id=current_user.id,
        meme_id=body.meme_id,
        session_id=session_id,
        value=body.value,
    )
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


@router.get("", response_model=list[VoteOut])
def list_votes(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Vote).filter(Vote.session_id == session_id).all()
    )


@router.get("/ranking", response_model=list[RankingEntry])
def get_ranking(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results = (
        db.query(
            Meme.id.label("meme_id"),
            Meme.url,
            User.display_name.label("submitted_by"),
            func.coalesce(func.sum(Vote.value), 0).label("total_score"),
            func.count(Vote.id).label("vote_count"),
        )
        .join(SessionMeme, SessionMeme.meme_id == Meme.id)
        .join(User, User.id == Meme.user_id)
        .outerjoin(
            Vote, (Vote.meme_id == Meme.id) & (Vote.session_id == session_id)
        )
        .filter(SessionMeme.session_id == session_id)
        .group_by(Meme.id, Meme.url, User.display_name)
        .order_by(func.coalesce(func.sum(Vote.value), 0).desc())
        .all()
    )

    urls = [r.url for r in results]
    thumbs = batch_embed_thumbnails(urls)

    return [
        RankingEntry(
            meme_id=r.meme_id,
            url=r.url,
            submitted_by=r.submitted_by,
            total_score=r.total_score,
            vote_count=r.vote_count,
            thumbnail_url=thumbs.get(r.url),
        )
        for r in results
    ]
