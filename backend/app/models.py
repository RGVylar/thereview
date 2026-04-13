import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    memes: Mapped[list["Meme"]] = relationship(back_populates="user")
    votes: Mapped[list["Vote"]] = relationship(back_populates="user")


class Meme(Base):
    __tablename__ = "memes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="memes")
    session_memes: Mapped[list["SessionMeme"]] = relationship(back_populates="meme")
    votes: Mapped[list["Vote"]] = relationship(back_populates="meme")

    __table_args__ = (
        UniqueConstraint("user_id", "url", name="uq_user_meme_url"),
    )


class SessionStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    FINISHED = "finished"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus), default=SessionStatus.PENDING, nullable=False
    )
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    creator: Mapped["User"] = relationship()
    participants: Mapped[list["SessionUser"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    session_memes: Mapped[list["SessionMeme"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    votes: Mapped[list["Vote"]] = relationship(back_populates="session")


class SessionUser(Base):
    __tablename__ = "session_users"

    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)

    session: Mapped["Session"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship()


class SessionMeme(Base):
    __tablename__ = "session_memes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    meme_id: Mapped[int] = mapped_column(ForeignKey("memes.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    session: Mapped["Session"] = relationship(back_populates="session_memes")
    meme: Mapped["Meme"] = relationship(back_populates="session_memes")

    __table_args__ = (
        UniqueConstraint("session_id", "meme_id", name="uq_session_meme"),
        UniqueConstraint("session_id", "position", name="uq_session_position"),
    )


class Vote(Base):
    __tablename__ = "votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    meme_id: Mapped[int] = mapped_column(ForeignKey("memes.id"), nullable=False)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="votes")
    meme: Mapped["Meme"] = relationship(back_populates="votes")
    session: Mapped["Session"] = relationship(back_populates="votes")

    __table_args__ = (
        UniqueConstraint("user_id", "meme_id", "session_id", name="uq_user_meme_session_vote"),
    )
