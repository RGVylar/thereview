from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Meme, User
from app.schemas import MemeCreate, MemeOut, MemeList

router = APIRouter(prefix="/api/memes", tags=["memes"])


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
    if meme.reviewed_at is not None:
        raise HTTPException(status_code=400, detail="Meme already reviewed")
    db.delete(meme)
    db.commit()
