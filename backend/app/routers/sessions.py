import random
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DBSession, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.downloader import cleanup_session_media, download_and_update, is_downloadable, media_path
from app.models import MediaCache, Meme, Session, SessionMeme, SessionStatus, SessionUser, User
from app.schemas import SessionCreate, SessionDetail, SessionOut

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _user_from_session_user(su: SessionUser):
    from app.schemas import UserOut
    return UserOut.model_validate(su.user)


def _session_to_out(session: Session, meme_count: int) -> SessionOut:
    return SessionOut(
        id=session.id,
        name=session.name,
        status=session.status.value,
        created_by=session.created_by,
        created_at=session.created_at,
        started_at=session.started_at,
        meme_limit=session.meme_limit,
        mix_mode=session.mix_mode,
        participants=[_user_from_session_user(p) for p in session.participants],
        meme_count=meme_count,
    )


def _get_session_or_404(session_id: int, db: DBSession) -> Session:
    s = db.query(Session).filter(Session.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


def _assert_participant(session: Session, user_id: int):
    ids = [p.user_id for p in session.participants]
    if user_id not in ids:
        raise HTTPException(status_code=403, detail="Not a participant")


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    body: SessionCreate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_ids = list(set(body.user_ids) | {current_user.id})

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    if len(users) != len(user_ids):
        raise HTTPException(status_code=400, detail="One or more user IDs are invalid")

    memes = (
        db.query(Meme)
        .filter(Meme.user_id.in_(user_ids), Meme.reviewed_at.is_(None))
        .all()
    )
    if not memes:
        raise HTTPException(status_code=400, detail="No pending memes for selected users")

    mix_mode = body.mix_mode or "shuffle"
    if mix_mode == "batched":
        from collections import defaultdict
        by_user: dict = defaultdict(list)
        for m in memes:
            by_user[m.user_id].append(m)
        for uid_memes in by_user.values():
            random.shuffle(uid_memes)
        ordered = []
        for uid in user_ids:
            ordered.extend(by_user.get(uid, []))
        memes = ordered
    else:
        random.shuffle(memes)

    if body.meme_limit and body.meme_limit > 0:
        memes = memes[: body.meme_limit]

    if not memes:
        raise HTTPException(status_code=400, detail="No pending memes for selected users")

    session = Session(
        name=body.name,
        created_by=current_user.id,
        status=SessionStatus.PENDING,
        meme_limit=body.meme_limit,
        mix_mode=mix_mode,
    )
    db.add(session)
    db.flush()

    for uid in user_ids:
        db.add(SessionUser(session_id=session.id, user_id=uid))

    for idx, meme in enumerate(memes):
        db.add(SessionMeme(session_id=session.id, meme_id=meme.id, position=idx))

    # Schedule downloads for TikTok/Twitter memes in the background so they
    # are ready (or close to it) by the time the session actually starts.
    downloadable = [(meme.id, str(meme.url)) for meme in memes if is_downloadable(str(meme.url))]
    for meme_id, _ in downloadable:
        db.add(MediaCache(session_id=session.id, meme_id=meme_id, status="pending"))

    db.commit()
    db.refresh(session)

    for meme_id, url in downloadable:
        background_tasks.add_task(download_and_update, session.id, meme_id, url)

    return _session_to_out(session, len(memes))


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[SessionOut])
def list_sessions(
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sessions = (
        db.query(Session)
        .join(SessionUser)
        .filter(SessionUser.user_id == current_user.id)
        .options(joinedload(Session.participants).joinedload(SessionUser.user))
        .order_by(Session.created_at.desc())
        .all()
    )
    result = []
    for s in sessions:
        meme_count = db.query(SessionMeme).filter(SessionMeme.session_id == s.id).count()
        result.append(_session_to_out(s, meme_count))
    return result


# ── Get ───────────────────────────────────────────────────────────────────────

@router.get("/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        db.query(Session)
        .options(
            joinedload(Session.participants).joinedload(SessionUser.user),
            joinedload(Session.session_memes).joinedload(SessionMeme.meme),
        )
        .filter(Session.id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    _assert_participant(session, current_user.id)

    return SessionDetail(
        id=session.id,
        name=session.name,
        status=session.status.value,
        created_by=session.created_by,
        created_at=session.created_at,
        started_at=session.started_at,
        meme_limit=session.meme_limit,
        mix_mode=session.mix_mode,
        participants=[_user_from_session_user(p) for p in session.participants],
        session_memes=sorted(session.session_memes, key=lambda sm: sm.position),
    )


# ── Start ─────────────────────────────────────────────────────────────────────

@router.post("/{session_id}/start", response_model=SessionDetail)
def start_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.status != SessionStatus.PENDING:
        raise HTTPException(status_code=400, detail="Session already started/finished")

    session.status = SessionStatus.ACTIVE
    session.started_at = datetime.now(timezone.utc)
    db.commit()

    return get_session(session_id, db, current_user)


# ── Finish ────────────────────────────────────────────────────────────────────

@router.post("/{session_id}/finish", response_model=SessionDetail)
def finish_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Session is not active")

    # Mark only the memes that were actually viewed (positions 0..current_position)
    viewed_meme_ids = [
        sm.meme_id
        for sm in db.query(SessionMeme)
        .filter(
            SessionMeme.session_id == session_id,
            SessionMeme.position <= session.current_position,
        )
        .all()
    ]
    if viewed_meme_ids:
        now = datetime.now(timezone.utc)
        db.query(Meme).filter(Meme.id.in_(viewed_meme_ids)).update(
            {"reviewed_at": now}, synchronize_session="fetch"
        )

    session.status = SessionStatus.FINISHED
    db.commit()

    # Clean up downloaded media files in the background
    background_tasks.add_task(cleanup_session_media, session_id)

    return get_session(session_id, db, current_user)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creator can delete a session")
    db.delete(session)
    db.commit()
    background_tasks.add_task(cleanup_session_media, session_id)
    return None


# ── Media status ──────────────────────────────────────────────────────────────

@router.get("/{session_id}/media")
def get_media_status(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return download status for all downloadable memes in the session.
    Returns {meme_id: "pending"|"ready"|"failed"}.
    """
    session = _get_session_or_404(session_id, db)
    _assert_participant(session, current_user.id)

    rows = db.query(MediaCache).filter(MediaCache.session_id == session_id).all()
    return {str(r.meme_id): r.status for r in rows}


# ── Media streaming ───────────────────────────────────────────────────────────

@router.get("/{session_id}/media/{meme_id}")
def stream_media(
    session_id: int,
    meme_id: int,
    token: str = Query(...),
    db: DBSession = Depends(get_db),
):
    """Stream the downloaded video file.
    Auth via ?token= query param so <video src="..."> works without JS headers.
    """
    from app.auth import get_current_user as _gcr
    from fastapi.security import OAuth2PasswordBearer
    from jose import JWTError, jwt
    from app.config import settings

    # Validate token manually (can't use Depends here because token is in query)
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    session = _get_session_or_404(session_id, db)
    participant_ids = [p.user_id for p in session.participants]
    if user_id not in participant_ids:
        raise HTTPException(status_code=403, detail="Not a participant")

    cache = (
        db.query(MediaCache)
        .filter_by(session_id=session_id, meme_id=meme_id)
        .first()
    )
    if not cache or cache.status != "ready":
        raise HTTPException(status_code=404, detail="Media not ready")

    path = media_path(session_id, meme_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        filename=f"{meme_id}.mp4",
    )
