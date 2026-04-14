"""WebSocket hub for real-time session synchronisation.

Each active session is a "room".  Participants join by opening
ws://.../api/sessions/{id}/ws?token=<jwt>.

Messages are JSON with a "type" field:
  → Incoming (client → server):
      {"type":"navigate","index":3}     — move everyone to meme at index
      {"type":"vote","meme_id":7,"value":4}
      {"type":"start"}
      {"type":"finish"}
  ← Outgoing (server → all clients in room):
      {"type":"start","user":"display_name"}
      {"type":"navigate","index":3,"user":"display_name"}
      {"type":"vote","meme_id":7,"user_id":1,"value":4,"user":"name"}
      {"type":"finish","user":"display_name"}
      {"type":"join","user":"display_name","count":N}
      {"type":"leave","user":"display_name","count":N}
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt

from app.config import settings
from app.database import SessionLocal
from app.models import Session, SessionUser

router = APIRouter()

# ── Room registry ─────────────────────────────────────────────────────────────

_rooms: dict[int, dict[int, tuple[WebSocket, str]]] = {}
# session_id → {user_id: (ws, display_name)}


def _get_room(session_id: int) -> dict[int, tuple[WebSocket, str]]:
    if session_id not in _rooms:
        _rooms[session_id] = {}
    return _rooms[session_id]


async def _broadcast(session_id: int, msg: dict[str, Any], exclude_uid: int | None = None):
    room = _rooms.get(session_id, {})
    data = json.dumps(msg)
    stale: list[int] = []
    for uid, (ws, _name) in room.items():
        if uid == exclude_uid:
            continue
        try:
            await ws.send_text(data)
        except Exception:
            stale.append(uid)
    for uid in stale:
        room.pop(uid, None)


def _authenticate_ws(token: str) -> tuple[int, str] | None:
    """Validate JWT and return (user_id, display_name) or None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
    db = SessionLocal()
    try:
        from app.models import User
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return None
        return user.id, user.display_name
    finally:
        db.close()


def _is_participant(session_id: int, user_id: int) -> bool:
    db = SessionLocal()
    try:
        return (
            db.query(SessionUser)
            .filter(SessionUser.session_id == session_id, SessionUser.user_id == user_id)
            .first()
            is not None
        )
    finally:
        db.close()


# ── WebSocket endpoint ────────────────────────────────────────────────────────


@router.websocket("/api/sessions/{session_id}/ws")
async def session_ws(websocket: WebSocket, session_id: int, token: str = Query(...)):
    auth = _authenticate_ws(token)
    if not auth:
        await websocket.close(code=4001, reason="Unauthorized")
        return
    user_id, display_name = auth

    if not _is_participant(session_id, user_id):
        await websocket.close(code=4003, reason="Not a participant")
        return

    await websocket.accept()
    room = _get_room(session_id)

    # Remove previous connection for same user (e.g. page refresh)
    old = room.pop(user_id, None)
    if old:
        try:
            await old[0].close()
        except Exception:
            pass

    room[user_id] = (websocket, display_name)
    await _broadcast(session_id, {"type": "join", "user": display_name, "count": len(room)})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "navigate":
                await _broadcast(
                    session_id,
                    {"type": "navigate", "index": msg.get("index", 0), "user": display_name},
                )

            elif msg_type == "vote":
                await _broadcast(
                    session_id,
                    {
                        "type": "vote",
                        "meme_id": msg.get("meme_id"),
                        "user_id": user_id,
                        "value": msg.get("value"),
                        "user": display_name,
                    },
                    exclude_uid=None,  # everyone sees votes
                )

            elif msg_type == "finish":
                await _broadcast(
                    session_id,
                    {"type": "finish", "user": display_name},
                )

            elif msg_type == "start":
                await _broadcast(
                    session_id,
                    {"type": "start", "user": display_name},
                )

            elif msg_type == "ready":
                await _broadcast(
                    session_id,
                    {"type": "ready", "user_id": user_id, "user": display_name},
                )

            elif msg_type == "play_sync":
                await _broadcast(
                    session_id,
                    {"type": "play_sync", "user": display_name},
                )

            elif msg_type == "playback":
                # Video playback sync (play/pause/seek) from browser extension
                await _broadcast(
                    session_id,
                    {
                        "type": "playback",
                        "action": msg.get("action"),       # "play" | "pause" | "seek"
                        "currentTime": msg.get("currentTime"),
                        "user_id": user_id,
                        "user": display_name,
                    },
                    exclude_uid=user_id,  # don't echo back to sender
                )

    except WebSocketDisconnect:
        pass
    finally:
        room.pop(user_id, None)
        count = len(room)
        await _broadcast(session_id, {"type": "leave", "user": display_name, "count": count})
        if count == 0:
            _rooms.pop(session_id, None)
