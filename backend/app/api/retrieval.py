"""
Retrieval API endpoints for ForensicLens.

Provides case-scoped indexing and hybrid retrieval endpoints:
- POST /api/cases/{case_id}/retrieval/index
- POST /api/cases/{case_id}/retrieval/search
- GET  /api/cases/{case_id}/retrieval/status
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_verified_case_dir, validate_identifier
from app.config import get_cases_dir
from app.retrieval.embeddings import ModelNotReadyError
from app.retrieval.schemas import (
    RetrievalIndexRequest,
    RetrievalIndexResponse,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievalStatusResponse,
)
from app.retrieval.service import RetrievalOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cases/{case_id}/retrieval", tags=["Retrieval"])

# Global orchestrator instance (lazily initialized)
_orchestrator: Optional[RetrievalOrchestrator] = None


def get_retrieval_orchestrator() -> RetrievalOrchestrator:
    """Dependency provider for RetrievalOrchestrator."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = RetrievalOrchestrator()
    return _orchestrator


def set_retrieval_orchestrator(orchestrator: Optional[RetrievalOrchestrator]) -> None:
    """Allows test fixtures to inject custom or fake orchestrator instances."""
    global _orchestrator
    _orchestrator = orchestrator


@router.get(
    "/status",
    response_model=RetrievalStatusResponse,
    summary="Get case retrieval index and model readiness status",
)
def get_retrieval_status(
    case_id: str,
    orchestrator: RetrievalOrchestrator = Depends(get_retrieval_orchestrator),
) -> RetrievalStatusResponse:
    """
    Return indexing counts, vector index state, and local model availability for a case.
    """
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    try:
        return orchestrator.get_status(cases_dir, case_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except Exception as exc:
        logger.exception("Retrieval status check failed for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check retrieval status: {str(exc)}",
        )


@router.post(
    "/index",
    response_model=RetrievalIndexResponse,
    summary="Index or rebuild case vector collection",
)
def index_case_records(
    case_id: str,
    payload: Optional[RetrievalIndexRequest] = None,
    orchestrator: RetrievalOrchestrator = Depends(get_retrieval_orchestrator),
) -> RetrievalIndexResponse:
    """
    Generate local dense embeddings and index source evidence records into ChromaDB.
    Supports incremental indexing (default) or complete collection rebuild.
    """
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()
    req = payload or RetrievalIndexRequest()

    try:
        return orchestrator.index_case(cases_dir, case_id, req)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except ModelNotReadyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("Case indexing failed for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Indexing failed: {str(exc)}",
        )


@router.post(
    "/search",
    response_model=RetrievalSearchResponse,
    summary="Perform hybrid forensic evidence retrieval",
)
def search_case_evidence(
    case_id: str,
    payload: RetrievalSearchRequest,
    orchestrator: RetrievalOrchestrator = Depends(get_retrieval_orchestrator),
) -> RetrievalSearchResponse:
    """
    Execute hybrid retrieval combining lexical search (SQLite FTS5),
    dense semantic search (BGE embeddings + ChromaDB), Reciprocal Rank Fusion,
    and cross-encoder reranking.
    """
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    try:
        return orchestrator.search(cases_dir, case_id, payload)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except ModelNotReadyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("Hybrid search failed for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(exc)}",
        )
