"""
Evidence processing service for ForensicLens.

Orchestrates deterministic parser resolution, reading from immutable evidence storage,
executing BaseParser implementations, and persisting normalized records and events
via ParserPersistenceService while maintaining strict case isolation and idempotency.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.cases.database import close_case_db, open_case_db
from app.evidence.storage import get_evidence_path
from app.parsers.persistence import (
    AlreadyPersistedError,
    CaseNotFoundError,
    EvidenceNotFoundError,
    ParserPersistenceService,
    PersistenceError,
    ReferentialIntegrityError,
)
from app.parsers.registry import ParserRegistry, UnknownParserError, default_registry

logger = logging.getLogger(__name__)


class EvidenceProcessingError(Exception):
    """Base exception for evidence processing failures."""


class UnsupportedParserError(EvidenceProcessingError):
    """Raised when no registered parser is available for the evidence format."""


class EvidenceArtifactNotFoundError(EvidenceProcessingError):
    """Raised when the immutable storage artifact is missing on disk."""


@dataclass(frozen=True)
class ProcessResult:
    """Structured summary of evidence parsing and persistence."""

    case_id: str
    evidence_id: str
    parser_name: str
    parser_version: Optional[str]
    raw_records_count: int
    events_count: int
    unparsed_records_count: int
    status: str
    error_summary: Optional[str] = None


def process_evidence(
    case_dir: str | Path,
    case_id: str,
    evidence_id: str,
    *,
    conn: Optional[sqlite3.Connection] = None,
    parser_name_or_format: Optional[str] = None,
    registry: Optional[ParserRegistry] = None,
) -> ProcessResult:
    """
    Process an ingested, immutable evidence artifact through the parser pipeline.

    Workflow:
    1. Verify case and evidence existence and ownership.
    2. Check idempotency (prevent duplicate parsing).
    3. Determine and resolve parser deterministically from ParserRegistry.
    4. Mark parser_status as 'PROCESSING'.
    5. Read and parse from immutable storage path (<case_dir>/evidence/objects/<evidence_id>).
    6. Persist raw_records, events, and update events_fts atomically via ParserPersistenceService.
    7. Return structured processing summary.

    Args:
        case_dir: Root directory of the case (containing case.db and evidence/).
        case_id: Target case identifier.
        evidence_id: Target evidence file identifier.
        conn: Optional existing sqlite3 database connection.
        parser_name_or_format: Optional explicit parser name (e.g. 'openssh') or format ('OPENSSH').
        registry: Optional custom ParserRegistry instance (defaults to global default_registry).

    Returns:
        ProcessResult summarizing parsed lines, events, and final status.
    """
    case_dir = Path(case_dir)
    db_path = case_dir / "case.db"
    close_on_exit = False

    if conn is None:
        conn = open_case_db(db_path)
        close_on_exit = True

    try:
        conn.execute("PRAGMA foreign_keys = ON")

        # 1. Verify case existence
        case_row = conn.execute(
            "SELECT case_id FROM cases WHERE case_id = ?",
            (case_id,),
        ).fetchone()
        if not case_row:
            raise CaseNotFoundError(f"Case '{case_id}' not found in database.")

        # 2. Verify evidence existence and case ownership
        ev_row = conn.execute(
            """
            SELECT evidence_id, case_id, original_name, format, parser_status
            FROM evidence_files
            WHERE evidence_id = ?
            """,
            (evidence_id,),
        ).fetchone()

        if not ev_row:
            raise EvidenceNotFoundError(
                f"Evidence '{evidence_id}' not found in database."
            )

        if ev_row["case_id"] != case_id:
            raise ReferentialIntegrityError(
                f"Evidence '{evidence_id}' belongs to case '{ev_row['case_id']}', "
                f"not requested case '{case_id}'."
            )

        # 3. Check duplicate / idempotency boundary
        existing_raw_count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE case_id = ? AND evidence_id = ?",
            (case_id, evidence_id),
        ).fetchone()[0]

        if existing_raw_count > 0:
            raise AlreadyPersistedError(
                f"Evidence '{evidence_id}' in case '{case_id}' has already been processed "
                f"({existing_raw_count} raw records present)."
            )

        # 4. Resolve parser deterministically
        reg = registry or default_registry
        format_candidate = (parser_name_or_format or ev_row["format"] or "").strip()

        # Heuristic format fallback for generic or text logs
        if format_candidate.upper() in ("TXT", "UNKNOWN", "GENERIC", ""):
            orig_name = ev_row["original_name"].lower()
            if "auth" in orig_name or "ssh" in orig_name:
                format_candidate = "OPENSSH"

        try:
            parser = reg.get(format_candidate)
        except UnknownParserError:
            # Mark evidence as UNSUPPORTED in database
            conn.execute(
                """
                UPDATE evidence_files
                SET parser_status = 'UNSUPPORTED'
                WHERE case_id = ? AND evidence_id = ?
                """,
                (case_id, evidence_id),
            )
            conn.commit()

            return ProcessResult(
                case_id=case_id,
                evidence_id=evidence_id,
                parser_name=format_candidate or "UNKNOWN",
                parser_version=None,
                raw_records_count=0,
                events_count=0,
                unparsed_records_count=0,
                status="UNSUPPORTED",
                error_summary=f"No registered parser available for format '{format_candidate}'",
            )

        # 5. Mark status as PROCESSING
        conn.execute(
            """
            UPDATE evidence_files
            SET parser_status = 'PROCESSING'
            WHERE case_id = ? AND evidence_id = ?
            """,
            (case_id, evidence_id),
        )
        conn.commit()

        # 6. Verify immutable storage artifact exists
        storage_path = get_evidence_path(case_dir, evidence_id)
        if not storage_path.is_file():
            conn.execute(
                """
                UPDATE evidence_files
                SET parser_status = 'FAILED'
                WHERE case_id = ? AND evidence_id = ?
                """,
                (case_id, evidence_id),
            )
            conn.commit()
            raise EvidenceArtifactNotFoundError(
                f"Immutable evidence artifact not found on disk: {storage_path}"
            )

        # 7. Execute parser
        try:
            parse_result = parser.parse(storage_path, evidence_id=evidence_id)
        except Exception as pe:
            conn.execute(
                """
                UPDATE evidence_files
                SET parser_status = 'FAILED'
                WHERE case_id = ? AND evidence_id = ?
                """,
                (case_id, evidence_id),
            )
            conn.commit()
            return ProcessResult(
                case_id=case_id,
                evidence_id=evidence_id,
                parser_name=parser.parser_name,
                parser_version=parser.parser_version,
                raw_records_count=0,
                events_count=0,
                unparsed_records_count=0,
                status="FAILED",
                error_summary=f"Parser execution failed: {pe}",
            )

        # 8. Persist parsed output atomically
        try:
            persistence_service = ParserPersistenceService(data_dir=case_dir.parent.parent)
            persist_res = persistence_service.persist_parse_result(
                case_id=case_id,
                parse_result=parse_result,
                conn=conn,
            )
        except Exception as pse:
            conn.execute(
                """
                UPDATE evidence_files
                SET parser_status = 'FAILED'
                WHERE case_id = ? AND evidence_id = ?
                """,
                (case_id, evidence_id),
            )
            conn.commit()
            raise PersistenceError(f"Persistence transaction failed: {pse}") from pse

        error_summary = None
        if parse_result.unparsed_lines > 0:
            error_summary = f"{parse_result.unparsed_lines} unparsed or unrecognized lines"

        return ProcessResult(
            case_id=case_id,
            evidence_id=evidence_id,
            parser_name=parse_result.parser_name,
            parser_version=parse_result.parser_version,
            raw_records_count=parse_result.total_lines,
            events_count=persist_res.events_count,
            unparsed_records_count=parse_result.unparsed_lines,
            status=persist_res.parser_status,
            error_summary=error_summary,
        )

    finally:
        if close_on_exit:
            close_case_db(conn)
