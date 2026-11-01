"""
FastAPI route registration.
"""

from app.api.cases import router as cases_router
from app.api.evidence import router as evidence_router
from app.api.events import router as events_router

__all__ = ["cases_router", "evidence_router", "events_router"]

