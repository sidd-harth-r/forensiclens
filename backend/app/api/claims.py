"""
ForensicLens Claim Verification API Router.

Exposes case-scoped endpoints for:
- POST /api/cases/{case_id}/claims/extract: Retrieve evidence and extract atomic claims
- GET  /api/cases/{case_id}/claims: List paginated claims with filtering and status summary
- POST /api/cases/{case_id}/claims/{claim_id}/verify: Deterministically verify claim against evidence
- GET  /api/cases/{case_id}/claims/{claim_id}/history: Retrieve append-only verification history
"""

from __future__ import annotations

import logging
import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_verified_case_dir, validate_identifier
from app.api.retrieval import get_retrieval_orchestrator
from app.config import get_cases_dir
from app.llm.provider import (
    LLMOutputFormatError,
    LLMProviderError,
    LLMProviderUnavailableError,
)
from app.retrieval.embeddings import ModelNotReadyError
from app.retrieval.schemas import RetrievalMode, RetrievalSearchRequest
from app.retrieval.service import RetrievalOrchestrator
from app.verification.engine import (
    CaseDatabaseNotFoundError,
    CrossCaseViolationError,
    DeterministicVerificationEngine,
)
from app.verification.extractor import ClaimExtractor
from app.verification.persistence import (
    get_case_claims,
    get_claim_by_id,
    get_claim_verification_history,
    save_claim_verification,
    save_extracted_claims,
)
from app.verification.schemas import (
    ClaimExtractionRequest,
    ClaimExtractionResponse,
    ClaimListResponse,
    ClaimType,
    ClaimVerificationResult,
    VerificationStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cases/{case_id}/claims", tags=["Claims"])

# Injectable module singletons
_claim_extractor: Optional[ClaimExtractor] = None
_verification_engine: Optional[DeterministicVerificationEngine] = None


def get_claim_extractor() -> ClaimExtractor:
    """Dependency provider for ClaimExtractor."""
    global _claim_extractor
    if _claim_extractor is None:
        _claim_extractor = ClaimExtractor()
    return _claim_extractor


def set_claim_extractor(extractor: Optional[ClaimExtractor]) -> None:
    """Allows test fixtures to inject custom or mock extractor instances."""
    global _claim_extractor
    _claim_extractor = extractor


def get_verification_engine() -> DeterministicVerificationEngine:
    """Dependency provider for DeterministicVerificationEngine."""
    global _verification_engine
    if _verification_engine is None:
        _verification_engine = DeterministicVerificationEngine()
    return _verification_engine


def set_verification_engine(engine: Optional[DeterministicVerificationEngine]) -> None:
    """Allows test fixtures to inject custom or mock verification engine instances."""
    global _verification_engine
    _verification_engine = engine


@router.post(
    "/extract",
    response_model=ClaimExtractionResponse,
    summary="Retrieve evidence and extract grounded atomic claims",
)
def extract_case_claims(
    case_id: str,
    payload: ClaimExtractionRequest,
    orchestrator: RetrievalOrchestrator = Depends(get_retrieval_orchestrator),
    extractor: ClaimExtractor = Depends(get_claim_extractor),
) -> ClaimExtractionResponse:
    """
    Retrieve case evidence, construct a bounded evidence context, extract atomic claims
    via LLM provider abstraction, validate candidate citations, and persist extracted
    claims with strictly UNVERIFIED initial status without executing verification.
    """
    validate_identifier(case_id, "case_id")
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    # Parse retrieval mode safely
    mode = RetrievalMode.HYBRID
    if payload.retrieval_mode:
        try:
            mode = RetrievalMode(payload.retrieval_mode.upper())
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid retrieval_mode '{payload.retrieval_mode}'. Valid modes: {[m.value for m in RetrievalMode]}",
            )

    try:
        # Step 1: Retrieve candidate evidence using existing retrieval orchestrator
        search_req = RetrievalSearchRequest(
            query=payload.query,
            topK=payload.retrieval_limit,
            mode=mode,
        )
        search_res = orchestrator.search(cases_dir, case_id, search_req)

        # Step 2: Extract atomic claims grounded in retrieved evidence
        extraction_res = extractor.extract_claims(
            case_id=case_id,
            query=payload.query,
            evidence_records=search_res.items,
            investigation_id=payload.investigation_id,
        )

        # Step 3: Controlled persistence (strictly UNVERIFIED, zero verification run)
        if extraction_res.extracted_claims:
            save_extracted_claims(case_id, extraction_res.extracted_claims, data_dir=cases_dir)

        return extraction_res

    except (ModelNotReadyError, LLMProviderUnavailableError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except (LLMOutputFormatError, LLMProviderError) as exc:
        logger.exception("LLM extraction failed for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Claim extraction model failed to produce valid output.",
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Claim extraction failed for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while extracting claims.",
        )


@router.get(
    "",
    response_model=ClaimListResponse,
    summary="List paginated claims for a case",
)
def list_case_claims(
    case_id: str,
    claim_type: Optional[ClaimType] = Query(None, alias="claimType", description="Filter by claim type"),
    status_filter: Optional[VerificationStatus] = Query(None, alias="status", description="Filter by verification status"),
    page: int = Query(1, ge=1, description="1-based page index"),
    page_size: int = Query(50, ge=1, le=200, alias="pageSize", description="Items per page"),
) -> ClaimListResponse:
    """
    Retrieve paginated claims scoped strictly to the specified case with optional
    claim_type and verification status filters, including global case status summary counts.
    """
    validate_identifier(case_id, "case_id")
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    # Sanitize default arguments when called directly as a Python function
    if not isinstance(page, int) or page < 1:
        page = 1
    if not isinstance(page_size, int) or page_size < 1:
        page_size = 50

    claim_type_val: Optional[str] = None
    if isinstance(claim_type, ClaimType):
        claim_type_val = claim_type.value
    elif isinstance(claim_type, str):
        claim_type_val = claim_type

    status_val: Optional[str] = None
    if isinstance(status_filter, VerificationStatus):
        status_val = status_filter.value
    elif isinstance(status_filter, str):
        status_val = status_filter

    try:
        claims, total, summary = get_case_claims(
            case_id=case_id,
            claim_type=claim_type_val,
            status=status_val,
            page=page,
            page_size=page_size,
            data_dir=cases_dir,
        )
        total_pages = max(1, math.ceil(total / page_size))
        return ClaimListResponse(
            caseId=case_id,
            total=total,
            claims=claims,
            summary=summary,
            page=page,
            pageSize=page_size,
            totalPages=total_pages,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to list claims for case '%s'", case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while retrieving claims.",
        )


@router.post(
    "/{claim_id}/verify",
    response_model=ClaimVerificationResult,
    summary="Deterministically verify a single claim against case evidence",
)
def verify_case_claim(
    case_id: str,
    claim_id: str,
    engine: DeterministicVerificationEngine = Depends(get_verification_engine),
) -> ClaimVerificationResult:
    """
    Deterministically evaluate a single claim against case evidence using read-only
    parameterized queries and deterministic predicate rules.

    Persists the verification record and atomically updates the denormalized
    claims.status cache in a single transaction. Callers cannot supply their own
    status or rules.
    """
    validate_identifier(case_id, "case_id")
    validate_identifier(claim_id, "claim_id")
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    claim = get_claim_by_id(case_id, claim_id, data_dir=cases_dir)
    if not claim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim '{claim_id}' not found in case '{case_id}'.",
        )

    try:
        result = engine.verify_claim(case_id, claim)
        save_claim_verification(case_id, result, claim=claim, data_dir=cases_dir)
        return result
    except CrossCaseViolationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except CaseDatabaseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Claim verification failed for claim '%s' in case '%s'", claim_id, case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while verifying the claim.",
        )


@router.get(
    "/{claim_id}/history",
    response_model=List[ClaimVerificationResult],
    summary="Get immutable verification history for a claim",
)
def get_claim_history(
    case_id: str,
    claim_id: str,
) -> List[ClaimVerificationResult]:
    """
    Retrieve the immutable append-only verification audit history for a single claim
    in deterministic reverse chronological order.
    """
    validate_identifier(case_id, "case_id")
    validate_identifier(claim_id, "claim_id")
    get_verified_case_dir(case_id)
    cases_dir = get_cases_dir()

    claim = get_claim_by_id(case_id, claim_id, data_dir=cases_dir)
    if not claim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim '{claim_id}' not found in case '{case_id}'.",
        )

    try:
        return get_claim_verification_history(case_id, claim_id, data_dir=cases_dir)
    except (ValueError, FileNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claim '{claim_id}' not found in case '{case_id}'.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to retrieve verification history for claim '%s' in case '%s'", claim_id, case_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal error occurred while retrieving verification history.",
        )
