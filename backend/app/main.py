import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, SessionLocal
from app.routers import memes, sessions, users, votes, ws

Base.metadata.create_all(bind=engine)

app = FastAPI(title="The Review", version="0.1.0")


@app.on_event("startup")
def retry_pending_downloads():
    """On startup, retry any media_cache rows stuck in pending/failed state."""
    def _run():
        from app.models import MediaCache, Session as SessionModel
        from app.downloader import download_and_update, media_path
        db = SessionLocal()
        try:
            rows = (
                db.query(MediaCache)
                .join(SessionModel, SessionModel.id == MediaCache.session_id)
                .filter(
                    MediaCache.status.in_(["pending", "failed"]),
                    SessionModel.status != "finished",
                )
                .all()
            )
            for row in rows:
                row.status = "pending"
                row.error = None
            db.commit()
            for row in rows:
                meme = db.query(__import__('app.models', fromlist=['Meme']).Meme).get(row.meme_id)
                if meme:
                    threading.Thread(
                        target=download_and_update,
                        args=(row.session_id, meme.id, str(meme.url)),
                        daemon=True,
                    ).start()
        except Exception as e:
            print(f"[startup] retry_pending_downloads error: {e}")
        finally:
            db.close()
    threading.Thread(target=_run, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(memes.router)
app.include_router(sessions.router)
app.include_router(votes.router)
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}
