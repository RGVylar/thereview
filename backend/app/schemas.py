from datetime import datetime

from pydantic import BaseModel, HttpUrl


# ── Auth ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── User ──────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    display_name: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Meme ──────────────────────────────────────────────────────────────────────
class MemeCreate(BaseModel):
    url: HttpUrl


class MemeOut(BaseModel):
    id: int
    url: str
    user_id: int
    reviewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Session ───────────────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    name: str
    user_ids: list[int]


class SessionMemeOut(BaseModel):
    id: int
    meme_id: int
    position: int
    meme: MemeOut

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: int
    name: str
    status: str
    created_by: int
    created_at: datetime
    participants: list[UserOut]
    meme_count: int

    model_config = {"from_attributes": True}


class SessionDetail(BaseModel):
    id: int
    name: str
    status: str
    created_by: int
    created_at: datetime
    participants: list[UserOut]
    session_memes: list[SessionMemeOut]

    model_config = {"from_attributes": True}


# ── Vote ──────────────────────────────────────────────────────────────────────
class VoteCreate(BaseModel):
    meme_id: int
    value: int


class VoteOut(BaseModel):
    id: int
    user_id: int
    meme_id: int
    session_id: int
    value: int
    created_at: datetime

    model_config = {"from_attributes": True}


class RankingEntry(BaseModel):
    meme_id: int
    url: str
    submitted_by: str
    total_score: int
    vote_count: int
