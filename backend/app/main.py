import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import memes, sessions, users, votes, ws

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Re-queue any downloads that were pending when the server last shut down
    _requeue_pending_downloads()
    yield


def _requeue_pending_downloads():
    """At startup, find any media_cache rows still in 'pending' and restart their downloads."""
    from app.database import SessionLocal
    from app.models import MediaCache, Meme
    from app.downloader import download_and_update

    db = SessionLocal()
    try:
        pending = db.query(MediaCache).filter(MediaCache.status == "pending").all()
        if not pending:
            return
        print(f"[DL] Re-queuing {len(pending)} pending downloads from previous run")
        for cache in pending:
            meme = db.query(Meme).filter(Meme.id == cache.meme_id).first()
            if not meme:
                continue
            asyncio.get_event_loop().run_in_executor(
                None, download_and_update, cache.session_id, cache.meme_id, str(meme.url)
            )
    finally:
        db.close()


app = FastAPI(title="The Review", version="0.1.0", lifespan=lifespan)

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
