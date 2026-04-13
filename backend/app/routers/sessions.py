import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Meme, Session, SessionMeme, SessionStatus, SessionUser, User
from app.schemas import SessionCreate, SessionDetail, SessionOut

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    body: SessionCreate,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Ensure creator is in participant list
    user_ids = list(set(body.user_ids) | {current_user.id})

    # Validate all user_ids exist
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    if len(users) != len(user_ids):
        raise HTTPException(status_code=400, detail="One or more user IDs are invalid")

    # Gather unreviewed memes from all participants
    memes = (
        db.query(Meme)
        .filter(Meme.user_id.in_(user_ids), Meme.reviewed_at.is_(None))
        .all()
    )
    if not memes:
        raise HTTPException(
            status_code=400, detail="No pending memes for selected users"
        )

    # Shuffle
    random.shuffle(memes)

    # Create session
    session = Session(
        name=body.name,
        created_by=current_user.id,
        status=SessionStatus.PENDING,
    )
    db.add(session)
    db.flush()

    # Add participants
    for uid in user_ids:
        db.add(SessionUser(session_id=session.id, user_id=uid))

    # Add memes with fixed order
    for idx, meme in enumerate(memes):
        db.add(
            SessionMeme(session_id=session.id, meme_id=meme.id, position=idx)
        )

    db.commit()
    db.refresh(session)

    return _session_to_out(session, len(memes))


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
        meme_count = (
            db.query(SessionMeme).filter(SessionMeme.session_id == s.id).count()
        )
        result.append(_session_to_out(s, meme_count))
    return result


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

    # Check membership
    participant_ids = [p.user_id for p in session.participants]
    if current_user.id not in participant_ids:
        raise HTTPException(status_code=403, detail="Not a participant")

    return SessionDetail(
        id=session.id,
        name=session.name,
        status=session.status.value,
        created_by=session.created_by,
        created_at=session.created_at,
        participants=[_user_from_session_user(p) for p in session.participants],
        session_memes=sorted(session.session_memes, key=lambda sm: sm.position),
    )


@router.post("/{session_id}/start", response_model=SessionDetail)
def start_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.PENDING:
        raise HTTPException(status_code=400, detail="Session already started/finished")

    # Mark memes as reviewed
    meme_ids = [
        sm.meme_id
        for sm in db.query(SessionMeme)
        .filter(SessionMeme.session_id == session_id)
        .all()
    ]
    now = datetime.now(timezone.utc)
    db.query(Meme).filter(Meme.id.in_(meme_ids)).update(
        {"reviewed_at": now}, synchronize_session="fetch"
    )

    session.status = SessionStatus.ACTIVE
    db.commit()

    return get_session(session_id, db, current_user)


@router.post("/{session_id}/finish", response_model=SessionDetail)
def finish_session(
    session_id: int,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Session is not active")

    session.status = SessionStatus.FINISHED
    db.commit()

    return get_session(session_id, db, current_user)


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
        participants=[_user_from_session_user(p) for p in session.participants],
        meme_count=meme_count,
    )
