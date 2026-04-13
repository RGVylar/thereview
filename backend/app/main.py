from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import memes, sessions, users, votes

app = FastAPI(title="The Review", version="0.1.0")

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


@app.get("/health")
def health():
    return {"status": "ok"}
