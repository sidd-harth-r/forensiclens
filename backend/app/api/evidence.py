"""
Evidence management API endpoints.

Provides immutable artifact ingestion, SHA-256 verification, and evidence discovery.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.api.deps import get_case_connection, get_verified_case_dir, validate_identifier
from app.evidence.service import (
    DuplicateEvidenceError,
    EvidenceIngestionError,
    EvidenceRecord,
    get_evidence,
    ingest_evidence,
    list_evidence,
)
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result

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
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> EvidenceResponse:
    """
    Ingest a new immutable evidence artifact into the case directory.

    Computes streaming SHA-256 hash, checks for duplicates, creates database record,
    and automatically triggers parsing when a supported parser is available.
    """
    case_dir = get_verified_case_dir(case_id)
    if not isinstance(format_name, str):
        format_name = None
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

        # Trigger parser persistence automatically for OpenSSH / auth logs
        if record.format == "OPENSSH" or "auth" in original_filename.lower():
            try:
                parser = OpenSSHParser()
                parse_result = parser.parse(
                    record.storage_path, evidence_id=record.evidence_id
                )
                persist_parse_result(
                    case_id=case_id,
                    parse_result=parse_result,
                    conn=conn,
                )
                # Re-fetch updated record reflecting parsed line count and status
                updated = get_evidence(conn, case_dir, record.evidence_id)
                if updated:
                    record = updated
            except Exception as pe:
                logger.warning(
                    "Automatic parsing failed for evidence %s: %s",
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
