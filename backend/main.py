"""
ForensicLens Backend application entrypoint.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.cases import router as cases_router
from app.api.evidence import router as evidence_router
from app.api.events import router as events_router
from app.api.timeline import router as timeline_router
from app.api.sessions import router as sessions_router
from app.api.retrieval import router as retrieval_router

app = FastAPI(
    title="ForensicLens Backend",
    description="Privacy-Preserving, Verifiable Digital Forensics API",
    version="0.1.0",
)

# CORS middleware for local Vite frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(cases_router)
app.include_router(evidence_router)
app.include_router(events_router)
app.include_router(timeline_router)
app.include_router(sessions_router)
app.include_router(retrieval_router)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "forensiclens-backend",
    }
