"""
Case management API endpoints.

Provides listing, retrieval, and initialization of isolated forensic cases.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import validate_identifier
from app.cases.service import create_case, get_case, list_cases
from app.config import get_cases_dir

router = APIRouter(prefix="/api/cases", tags=["Cases"])


class CaseResponse(BaseModel):
    caseId: str
    name: str
    description: str = ""
    status: str
    evidenceCount: int = 0
    eventsCount: int = 0
    investigationsCount: int = 0
    findingsCount: int = 0
    lastActivity: str
    createdAt: str
    leadInvestigator: str = "Lead Analyst"


class CreateCaseRequest(BaseModel):
    caseId: Optional[str] = Field(
        default=None,
        description="Optional explicit Case ID. If omitted, a trusted ID is generated.",
    )
    name: str = Field(..., min_length=1, max_length=200, description="Investigation title")
    description: Optional[str] = Field(default="", max_length=2000)
    leadInvestigator: Optional[str] = Field(default="Lead Analyst", max_length=100)


@router.get("", response_model=list[CaseResponse])
def get_all_cases() -> list[dict]:
    """List all available forensic cases in the repository."""
    cases_dir = get_cases_dir()
    return list_cases(cases_dir)


@router.get("/{case_id}", response_model=CaseResponse)
def get_case_by_id(case_id: str) -> dict:
    """Retrieve metadata and artifact counts for a specific case."""
    validate_identifier(case_id, "case_id")
    cases_dir = get_cases_dir()
    case_data = get_case(cases_dir, case_id)
    if not case_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' was not found.",
        )
    return case_data


@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
def create_new_case(request: CreateCaseRequest) -> dict:
    """Initialize a new forensic case and database."""
    case_id = request.caseId
    if case_id:
        validate_identifier(case_id, "case_id")
    else:
        case_id = f"CASE-{uuid.uuid4().hex[:8].upper()}"

    cases_dir = get_cases_dir()
    try:
        return create_case(
            cases_dir=cases_dir,
            case_id=case_id,
            name=request.name,
            description=request.description,
            created_by=request.leadInvestigator,
        )
    except FileExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Case '{case_id}' already exists.",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initialize case: {e}",
        ) from e

