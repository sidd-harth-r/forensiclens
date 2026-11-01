"""
Evidence management API endpoints.

Provides immutable artifact ingestion, SHA-256 verification, evidence discovery,
and deterministic parser processing into raw records and normalized events.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import get_case_connection, get_verified_case_dir, validate_identifier
from app.evidence.service import (
    DuplicateEvidenceError,
    EvidenceIngestionError,
    EvidenceRecord,
    get_evidence,
    ingest_evidence,
    list_evidence,
)
from app.parsers.persistence import (
    AlreadyPersistedError,
    CaseNotFoundError,
    EvidenceNotFoundError,
    PersistenceError,
    ReferentialIntegrityError,
)
from app.parsers.service import (
    EvidenceArtifactNotFoundError,
    process_evidence,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cases/{case_id}/evidence", tags=["Evidence"])


class EvidenceResponse(BaseModel):
    evidenceId: str
    caseId: str
    originalName: str
    mediaType: Optional[str] = None
    format: str
    objectHash: str
    objectSizeBytes: int
    parserStatus: str
    totalLines: Optional[int] = None
    parsedLines: Optional[int] = None
    hashVerifiedAt: Optional[str] = None
    createdAt: str
    storagePath: Optional[str] = None


class ProcessEvidenceRequest(BaseModel):
    parserName: Optional[str] = Field(
        default=None,
        description="Optional explicit parser name or format (e.g. 'OPENSSH' or 'openssh')",
    )


class ProcessEvidenceResponse(BaseModel):
    caseId: str
    evidenceId: str
    parserName: str
    parserVersion: Optional[str] = None
    rawRecordsCount: int = 0
    eventsCount: int = 0
    unparsedRecordsCount: int = 0
    status: str
    errorSummary: Optional[str] = None


def _to_response(record: EvidenceRecord) -> EvidenceResponse:
    """Map internal EvidenceRecord dataclass to API response model."""
    return EvidenceResponse(
        evidenceId=record.evidence_id,
        caseId=record.case_id,
        originalName=record.original_name,
        mediaType=record.media_type,
        format=record.format,
        objectHash=record.object_hash,
        objectSizeBytes=record.object_size_bytes,
        parserStatus=record.parser_status,
        totalLines=record.total_lines,
        parsedLines=record.parsed_lines,
        hashVerifiedAt=record.hash_verified_at,
        createdAt=record.created_at,
        storagePath=record.storage_path,
    )


@router.get("", response_model=list[EvidenceResponse])
def list_case_evidence(
    case_id: str,
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> list[EvidenceResponse]:
    """List all ingested evidence records for a case."""
    case_dir = get_verified_case_dir(case_id)
    records = list_evidence(conn, case_dir, case_id)
    return [_to_response(r) for r in records]


@router.get("/{evidence_id}", response_model=EvidenceResponse)
def get_case_evidence_by_id(
    case_id: str,
    evidence_id: str,
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> EvidenceResponse:
    """Retrieve metadata and hash integrity status for a specific evidence artifact."""
    validate_identifier(evidence_id, "evidence_id")
    case_dir = get_verified_case_dir(case_id)
    record = get_evidence(conn, case_dir, evidence_id)

    if not record or record.case_id != case_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evidence artifact '{evidence_id}' not found in case '{case_id}'.",
        )

    return _to_response(record)


@router.post("", response_model=EvidenceResponse, status_code=status.HTTP_201_CREATED)
def upload_case_evidence(
    case_id: str,
    file: UploadFile = File(...),
    format_name: Optional[str] = Form(None),
    auto_process: bool = Form(False),
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> EvidenceResponse:
    """
    Ingest a new immutable evidence artifact into the case directory.

    Computes streaming SHA-256 hash, checks for duplicates, and creates a database record
    with parser_status 'PENDING'. If auto_process is True, executes processing immediately.
    """
    case_dir = get_verified_case_dir(case_id)
    if not isinstance(format_name, str):
        format_name = None
    if not isinstance(auto_process, bool):
        auto_process = False
    original_filename = file.filename or "evidence.log"

    try:
        record = ingest_evidence(
            conn=conn,
            case_dir=case_dir,
            case_id=case_id,
            source=file.file,
            original_name=original_filename,
            format_name=format_name,
        )

        if auto_process:
            try:
                process_evidence(
                    case_dir=case_dir,
                    case_id=case_id,
                    evidence_id=record.evidence_id,
                    conn=conn,
                    parser_name_or_format=format_name,
                )
                updated = get_evidence(conn, case_dir, record.evidence_id)
                if updated:
                    record = updated
            except Exception as pe:
                logger.warning(
                    "Auto-processing during upload failed for evidence %s: %s",
                    record.evidence_id,
                    pe,
                )

        return _to_response(record)

    except DuplicateEvidenceError as de:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(de),
        ) from de
    except EvidenceIngestionError as ie:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ie),
        ) from ie
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Evidence ingestion failed: {e}",
        ) from e


@router.post("/{evidence_id}/process", response_model=ProcessEvidenceResponse)
def process_case_evidence_endpoint(
    case_id: str,
    evidence_id: str,
    request: Optional[ProcessEvidenceRequest] = None,
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> ProcessEvidenceResponse:
    """
    Process an ingested evidence artifact through the pluggable parser pipeline.

    Reads the stored immutable artifact, executes the resolved parser, and
    persists raw records and normalized events into the case database.
    """
    validate_identifier(case_id, "case_id")
    validate_identifier(evidence_id, "evidence_id")
    case_dir = get_verified_case_dir(case_id)

    parser_name = request.parserName if request and isinstance(request, ProcessEvidenceRequest) else None

    try:
        result = process_evidence(
            case_dir=case_dir,
            case_id=case_id,
            evidence_id=evidence_id,
            conn=conn,
            parser_name_or_format=parser_name,
        )

        return ProcessEvidenceResponse(
            caseId=result.case_id,
            evidenceId=result.evidence_id,
            parserName=result.parser_name,
            parserVersion=result.parser_version,
            rawRecordsCount=result.raw_records_count,
            eventsCount=result.events_count,
            unparsedRecordsCount=result.unparsed_records_count,
            status=result.status,
            errorSummary=result.error_summary,
        )
    except AlreadyPersistedError as ape:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(ape),
        ) from ape
    except (
        EvidenceNotFoundError,
        CaseNotFoundError,
        ReferentialIntegrityError,
        EvidenceArtifactNotFoundError,
    ) as nf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(nf),
        ) from nf
    except PersistenceError as pe:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Persistence transaction failed: {pe}",
        ) from pe
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Evidence processing failed: {e}",
        ) from e
