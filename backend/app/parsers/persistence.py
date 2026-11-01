"""
ForensicLens parser persistence module.

Persists parsed forensic evidence (RawRecord and ParsedEvent objects) into the
per-case SQLite/SQLCipher database, maintaining strict bit-level provenance,
atomic transactions, referential integrity, and FTS5 search synchronization.

Architecture flow:
    Immutable Evidence
            ↓
       BaseParser (Step 8)
            ↓
       ParseResult
          /    \
         /      \
    RawRecord   ParsedEvent
       ↓             ↓
    raw_records    events
                     ↓
                 events_fts (FTS5 lexical index)

Schema alignment (docs/DATABASE.md):
    - Raw records map to `raw_records` table (Section 4.3)
    - Normalized events map to `events` table (Section 4.4)
    - Full-text search synchronized to `events_fts` (Section 4a)
    - Evidence status and line counters updated in `evidence_files` (Section 4.2)
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from app.cases.database import get_case_db_path, open_case_db
from app.parsers.base import ParsedEvent, ParseResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom Exceptions
# ---------------------------------------------------------------------------


class PersistenceError(Exception):
    """Base exception for parser persistence failures."""


class CaseNotFoundError(PersistenceError):
    """Raised when case_id does not exist in the database."""


class EvidenceNotFoundError(PersistenceError):
    """Raised when evidence_id does not exist in the specified case."""


class AlreadyPersistedError(PersistenceError):
    """Raised when raw records/events for an evidence_id have already been persisted."""


class ReferentialIntegrityError(PersistenceError):
    """Raised when foreign-key or referential integrity constraint is violated."""


# ---------------------------------------------------------------------------
# Result Data Class
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PersistenceResult:
    """Summary of a successful or ignored persistence operation."""

    case_id: str
    evidence_id: str
    raw_records_count: int
    events_count: int
    fts_records_count: int
    persisted: bool
    parser_status: str


# ---------------------------------------------------------------------------
# Canonical Event Hash Helper
# ---------------------------------------------------------------------------


def compute_event_hash(
    case_id: str,
    evidence_id: str,
    raw_record_id: Optional[str],
    event: ParsedEvent,
) -> str:
    """
    Compute deterministic SHA-256 hash over canonical event attributes.

    Per docs/DATABASE.md section 4.4, event_hash is computed over a canonical
    serialization of the event to guarantee tamper-evidence and reproducible identity.
    """
    canonical_payload = {
        "case_id": case_id,
        "evidence_id": evidence_id,
        "raw_record_id": raw_record_id,
        "timestamp_original": event.timestamp_original,
        "timestamp_utc": event.timestamp_utc,
        "tz_assumed": event.tz_assumed,
        "timestamp_confidence": event.timestamp_confidence,
        "source": event.source,
        "host": event.host,
        "event_type": event.event_type,
        "severity": event.severity,
        "user_value": event.user_value,
        "src_ip": event.src_ip,
        "src_ip_scope": event.src_ip_scope,
        "src_port": event.src_port,
        "process": event.process,
        "pid": event.pid,
        "command_value": event.command_value,
        "resource": event.resource,
        "message": event.message,
        "parse_status": event.parse_status,
        "line_number": event.line_number,
        "byte_start": event.byte_start,
        "byte_end": event.byte_end,
    }
    canonical_json = json.dumps(
        canonical_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Parser Persistence Service
# ---------------------------------------------------------------------------


class ParserPersistenceService:
    """
    Service responsible for persisting parser output into the case database.

    Enforces:
        - Exact provenance preservation (byte offsets, line numbers, unmodified raw text)
        - Atomic transactions with complete rollback on any record failure
        - Foreign key and case boundary integrity
        - FTS5 external content synchronization
        - Idempotency policy (reject by default to prevent silent forensic corruption)
    """

    def __init__(self, data_dir: Optional[str | Path] = None):
        """
        Initialize the persistence service.

        Args:
            data_dir: Base directory containing case databases (<data_dir>/cases/<case_id>/case.db).
                      Can be None if connections are explicitly passed to persist_parse_result.
        """
        self.data_dir = Path(data_dir) if data_dir is not None else None

    def persist_parse_result(
        self,
        case_id: str,
        parse_result: ParseResult,
        *,
        conn: Optional[sqlite3.Connection] = None,
        if_exists: Literal["reject", "ignore"] = "reject",
    ) -> PersistenceResult:
        """
        Persist a ParseResult (RawRecords + ParsedEvents) into the case database.

        Args:
            case_id: Target case identifier.
            parse_result: Output from a BaseParser instance.
            conn: Optional existing sqlite3.Connection. If None, opens the database
                  at <data_dir>/cases/<case_id>/case.db.
            if_exists: Policy when raw_records for evidence_id already exist:
                       - 'reject' (default): raises AlreadyPersistedError.
                       - 'ignore': returns PersistenceResult with persisted=False.

        Returns:
            PersistenceResult summarizing persisted row counts.

        Raises:
            CaseNotFoundError: If case_id does not exist in cases table.
            EvidenceNotFoundError: If evidence_id does not exist in evidence_files.
            ReferentialIntegrityError: If evidence belongs to another case or foreign key fails.
            AlreadyPersistedError: If already persisted and if_exists='reject'.
            PersistenceError: On database or transactional failure.
        """
        close_on_exit = False
        if conn is None:
            if self.data_dir is None:
                raise PersistenceError(
                    "data_dir must be configured if conn is not provided."
                )
            db_path = get_case_db_path(self.data_dir, case_id)
            conn = open_case_db(db_path)
            close_on_exit = True

        try:
            # Ensure foreign key constraints are enabled
            conn.execute("PRAGMA foreign_keys = ON")

            # 1. Validate case existence
            case_row = conn.execute(
                "SELECT case_id FROM cases WHERE case_id = ?",
                (case_id,),
            ).fetchone()
            if not case_row:
                raise CaseNotFoundError(f"Case '{case_id}' not found in database.")

            # 2. Validate evidence existence and case ownership
            evidence_id = parse_result.evidence_id
            ev_row = conn.execute(
                "SELECT evidence_id, case_id, original_name, parser_status "
                "FROM evidence_files WHERE evidence_id = ?",
                (evidence_id,),
            ).fetchone()
            if not ev_row:
                raise EvidenceNotFoundError(
                    f"Evidence '{evidence_id}' not found in database."
                )
            if ev_row["case_id"] != case_id:
                raise ReferentialIntegrityError(
                    f"Evidence '{evidence_id}' belongs to case '{ev_row['case_id']}', "
                    f"not current case '{case_id}'."
                )

            source_file_name = ev_row["original_name"]

            # 3. Check duplicate / idempotency boundary
            existing_count = conn.execute(
                "SELECT COUNT(*) FROM raw_records WHERE case_id = ? AND evidence_id = ?",
                (case_id, evidence_id),
            ).fetchone()[0]

            if existing_count > 0:
                if if_exists == "ignore":
                    existing_events = conn.execute(
                        "SELECT COUNT(*) FROM events WHERE case_id = ? AND evidence_id = ?",
                        (case_id, evidence_id),
                    ).fetchone()[0]
                    return PersistenceResult(
                        case_id=case_id,
                        evidence_id=evidence_id,
                        raw_records_count=existing_count,
                        events_count=existing_events,
                        fts_records_count=existing_events,
                        persisted=False,
                        parser_status=ev_row["parser_status"],
                    )
                raise AlreadyPersistedError(
                    f"Parse result for evidence '{evidence_id}' in case '{case_id}' "
                    f"has already been persisted ({existing_count} raw records present)."
                )

            # 4. Atomic transaction / savepoint
            sp_name = f"sp_persist_{uuid.uuid4().hex[:12]}"
            conn.execute(f"SAVEPOINT {sp_name}")

            raw_records_count = 0
            events_count = 0
            fts_count = 0
            now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            try:
                # 5. Persist records and events
                for record in parse_result.records:
                    raw = record.raw_record
                    raw_record_id = f"RAW_{evidence_id}_{raw.record_no}"

                    # Insert raw record (strictly preserving raw_text unmodified)
                    conn.execute(
                        """
                        INSERT INTO raw_records (
                            raw_record_id, case_id, evidence_id, record_no,
                            line_number, byte_start, byte_end, raw_text,
                            parse_status, parse_error, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            raw_record_id,
                            case_id,
                            evidence_id,
                            raw.record_no,
                            raw.line_number,
                            raw.byte_start,
                            raw.byte_end,
                            raw.raw_text,
                            raw.parse_status,
                            raw.parse_error,
                            now_utc,
                        ),
                    )
                    raw_records_count += 1

                    # Insert normalized event if present
                    if record.event is not None:
                        event = record.event
                        event_id = f"EVT_{evidence_id}_{raw.record_no}"
                        event_hash = compute_event_hash(
                            case_id=case_id,
                            evidence_id=evidence_id,
                            raw_record_id=raw_record_id,
                            event=event,
                        )

                        cur = conn.cursor()
                        cur.execute(
                            """
                            INSERT INTO events (
                                event_id, case_id, evidence_id, raw_record_id,
                                timestamp_utc, timestamp_original, tz_assumed, timestamp_confidence,
                                source, host, event_type, severity,
                                user_value, src_ip, src_ip_scope, src_port,
                                process, pid, command_value, resource,
                                message, parse_status, source_file_name,
                                line_number, byte_start, byte_end,
                                event_hash, created_at
                            ) VALUES (
                                ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?,
                                ?, ?, ?,
                                ?, ?
                            )
                            """,
                            (
                                event_id,
                                case_id,
                                evidence_id,
                                raw_record_id,
                                event.timestamp_utc,
                                event.timestamp_original,
                                event.tz_assumed,
                                event.timestamp_confidence,
                                event.source or parse_result.parser_name,
                                event.host,
                                event.event_type,
                                event.severity,
                                event.user_value,
                                event.src_ip,
                                event.src_ip_scope,
                                event.src_port,
                                event.process,
                                event.pid,
                                event.command_value,
                                event.resource,
                                event.message,
                                event.parse_status,
                                source_file_name,
                                event.line_number,
                                event.byte_start,
                                event.byte_end,
                                event_hash,
                                now_utc,
                            ),
                        )
                        events_count += 1
                        rowid = cur.lastrowid

                        # Synchronize to FTS5 virtual table
                        conn.execute(
                            """
                            INSERT INTO events_fts (
                                rowid, message, command_value, resource,
                                process, event_type, source, host
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                rowid,
                                event.message,
                                event.command_value,
                                event.resource,
                                event.process,
                                event.event_type,
                                event.source or parse_result.parser_name,
                                event.host,
                            ),
                        )
                        fts_count += 1

                # 6. Update evidence_files parser status and line counters
                if parse_result.total_lines == 0:
                    overall_status = "PARSED"
                elif parse_result.parsed_lines == parse_result.total_lines:
                    overall_status = "PARSED"
                elif parse_result.parsed_lines > 0 or parse_result.partial_lines > 0:
                    overall_status = "PARTIAL"
                else:
                    overall_status = "FAILED"

                conn.execute(
                    """
                    UPDATE evidence_files
                    SET parser_version = ?,
                        parser_status = ?,
                        total_lines = ?,
                        parsed_lines = ?
                    WHERE evidence_id = ? AND case_id = ?
                    """,
                    (
                        parse_result.parser_version,
                        overall_status,
                        parse_result.total_lines,
                        parse_result.parsed_lines,
                        evidence_id,
                        case_id,
                    ),
                )

                # Release savepoint and commit if connection was opened locally
                conn.execute(f"RELEASE SAVEPOINT {sp_name}")
                if close_on_exit:
                    conn.commit()

                return PersistenceResult(
                    case_id=case_id,
                    evidence_id=evidence_id,
                    raw_records_count=raw_records_count,
                    events_count=events_count,
                    fts_records_count=fts_count,
                    persisted=True,
                    parser_status=overall_status,
                )

            except Exception as e:
                # Rollback to savepoint on any failure
                conn.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                conn.execute(f"RELEASE SAVEPOINT {sp_name}")
                if isinstance(e, sqlite3.IntegrityError):
                    raise ReferentialIntegrityError(
                        f"Integrity violation persisting parse result: {e}"
                    ) from e
                if isinstance(e, PersistenceError):
                    raise
                raise PersistenceError(
                    f"Failed to persist parse result: {e}"
                ) from e

        finally:
            if close_on_exit and conn is not None:
                conn.close()


# ---------------------------------------------------------------------------
# Convenience Function
# ---------------------------------------------------------------------------


def persist_parse_result(
    case_id: str,
    parse_result: ParseResult,
    *,
    data_dir: Optional[str | Path] = None,
    conn: Optional[sqlite3.Connection] = None,
    if_exists: Literal["reject", "ignore"] = "reject",
) -> PersistenceResult:
    """
    Convenience wrapper to persist a ParseResult into a case database.

    Args:
        case_id: Target case identifier.
        parse_result: Output from a BaseParser instance.
        data_dir: Case data directory (required if conn is None).
        conn: Optional active database connection.
        if_exists: Duplicate policy ('reject' or 'ignore').

    Returns:
        PersistenceResult with persisted counts.
    """
    service = ParserPersistenceService(data_dir=data_dir)
    return service.persist_parse_result(
        case_id=case_id,
        parse_result=parse_result,
        conn=conn,
        if_exists=if_exists,
    )
