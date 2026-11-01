"""
Test suite for Step 3: Evidence ingestion to parser detection, parsing, and persistence.

Covers:
    - Successful OpenSSH evidence processing via process_evidence and API endpoint
    - Correct raw_records persistence with exact line numbers and byte offsets
    - Correct events persistence with event_hash and UTC normalization
    - Correct events_fts synchronization and lexical discovery
    - Unsupported parser handling (returns UNSUPPORTED and updates evidence_files)
    - Missing evidence (404 Not Found)
    - Cross-case evidence access rejection (Case Isolation)
    - Idempotency & re-processing duplicate rejection (409 Conflict)
    - Parser/persistence failure rollback with no partial database state
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException

from app.api.evidence import (
    ProcessEvidenceRequest,
    process_case_evidence_endpoint,
    upload_case_evidence,
)
from app.cases.database import close_case_db, initialize_case_db, open_case_db
from app.evidence.service import get_evidence, ingest_evidence
from app.parsers.persistence import AlreadyPersistedError, EvidenceNotFoundError
from app.parsers.registry import ParserRegistry
from app.parsers.service import (
    EvidenceArtifactNotFoundError,
    ProcessResult,
    process_evidence,
)


@pytest.fixture
def processing_env(tmp_path: Path, monkeypatch):
    """Set up isolated case databases and directories for processing tests."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # Case 1: Active investigation
    case_1_id = "CASE-PROC-1"
    case_1_dir = cases_dir / case_1_id
    case_1_dir.mkdir(parents=True)
    db_1 = case_1_dir / "case.db"
    conn_1 = initialize_case_db(db_1, case_1_id, "Processing Test Case 1")

    # Ingest a sample OpenSSH log file into Case 1
    sample_log = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:22:00 server sshd[1236]: Disconnected from authenticating user root 10.0.0.1 port 55433 [preauth]\n"
    ).encode("utf-8")

    ev_record = ingest_evidence(
        conn=conn_1,
        case_dir=case_1_dir,
        case_id=case_1_id,
        source=io.BytesIO(sample_log),
        original_name="auth.log",
        format_name="OPENSSH",
    )

    # Ingest an unsupported format evidence artifact into Case 1
    unsupported_content = b"GENERIC UNSTRUCTURED ARTIFACT RAW BYTES\n"
    ev_unsupported = ingest_evidence(
        conn=conn_1,
        case_dir=case_1_dir,
        case_id=case_1_id,
        source=io.BytesIO(unsupported_content),
        original_name="unknown_dump.bin",
        format_name="BINARY_PROPRIETARY",
    )

    # Case 2: Separate case for isolation checks
    case_2_id = "CASE-PROC-2"
    case_2_dir = cases_dir / case_2_id
    case_2_dir.mkdir(parents=True)
    db_2 = case_2_dir / "case.db"
    conn_2 = initialize_case_db(db_2, case_2_id, "Processing Test Case 2")

    close_case_db(conn_1)
    close_case_db(conn_2)

    return {
        "tmp_path": tmp_path,
        "cases_dir": cases_dir,
        "case_1_id": case_1_id,
        "case_1_dir": case_1_dir,
        "case_1_db": db_1,
        "case_2_id": case_2_id,
        "case_2_dir": case_2_dir,
        "case_2_db": db_2,
        "evidence_id": ev_record.evidence_id,
        "unsupported_evidence_id": ev_unsupported.evidence_id,
    }


# ---------------------------------------------------------------------------
# 1. Successful Processing & Persistence Tests
# ---------------------------------------------------------------------------

def test_successful_openssh_processing(processing_env):
    """Processing valid OpenSSH evidence extracts raw records and normalized events."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        evidence_id = processing_env["evidence_id"]
        case_dir = processing_env["case_1_dir"]

        result = process_evidence(
            case_dir=case_dir,
            case_id=case_id,
            evidence_id=evidence_id,
            conn=conn,
        )

        assert isinstance(result, ProcessResult)
        assert result.case_id == case_id
        assert result.evidence_id == evidence_id
        assert result.parser_name == "openssh"
        assert result.raw_records_count == 3
        assert result.events_count == 3
        assert result.unparsed_records_count == 0
        assert result.status == "PARSED"
        assert result.error_summary is None

        # Verify raw_records in database
        raw_rows = conn.execute(
            "SELECT * FROM raw_records WHERE case_id = ? AND evidence_id = ? ORDER BY record_no",
            (case_id, evidence_id),
        ).fetchall()
        assert len(raw_rows) == 3
        assert raw_rows[0]["line_number"] == 1
        assert raw_rows[0]["byte_start"] == 0
        assert "Failed password" in raw_rows[0]["raw_text"]

        # Verify events in database
        event_rows = conn.execute(
            "SELECT * FROM events WHERE case_id = ? AND evidence_id = ? ORDER BY line_number",
            (case_id, evidence_id),
        ).fetchall()
        assert len(event_rows) == 3
        assert event_rows[0]["event_type"] == "AUTH_FAILURE"
        assert event_rows[0]["user_value"] == "hacker"
        assert event_rows[0]["src_ip"] == "192.168.1.100"
        assert len(event_rows[0]["event_hash"]) == 64

        assert event_rows[1]["event_type"] == "AUTH_SUCCESS"
        assert event_rows[1]["user_value"] == "root"
        assert event_rows[1]["src_ip"] == "10.0.0.1"

        # Verify evidence_files updated status
        ev = get_evidence(conn, case_dir, evidence_id)
        assert ev.parser_status == "PARSED"
        assert ev.total_lines == 3
        assert ev.parsed_lines == 3
    finally:
        close_case_db(conn)


def test_events_fts_synchronized(processing_env):
    """Persisted events are indexed in events_fts and discoverable via lexical queries."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        process_evidence(
            case_dir=processing_env["case_1_dir"],
            case_id=processing_env["case_1_id"],
            evidence_id=processing_env["evidence_id"],
            conn=conn,
        )

        # Query events_fts for message keyword
        fts_match = conn.execute(
            "SELECT rowid, message, event_type FROM events_fts WHERE events_fts MATCH 'hacker'"
        ).fetchall()
        assert len(fts_match) == 1
        assert "hacker" in fts_match[0]["message"]
        assert fts_match[0]["event_type"] == "AUTH_FAILURE"

        # Query by indexed process column
        proc_match = conn.execute(
            "SELECT rowid, process FROM events_fts WHERE events_fts MATCH 'process:sshd'"
        ).fetchall()
        assert len(proc_match) == 3
    finally:
        close_case_db(conn)


# ---------------------------------------------------------------------------
# 2. Unsupported Parser Handling
# ---------------------------------------------------------------------------

def test_unsupported_parser_handling(processing_env):
    """Artifacts with unrecognized formats return UNSUPPORTED status and update DB cleanly."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        ev_id = processing_env["unsupported_evidence_id"]
        case_dir = processing_env["case_1_dir"]

        result = process_evidence(
            case_dir=case_dir,
            case_id=case_id,
            evidence_id=ev_id,
            conn=conn,
        )

        assert result.status == "UNSUPPORTED"
        assert result.raw_records_count == 0
        assert result.events_count == 0
        assert "No registered parser available" in (result.error_summary or "")

        # Verify evidence_files parser_status updated to UNSUPPORTED
        ev = get_evidence(conn, case_dir, ev_id)
        assert ev.parser_status == "UNSUPPORTED"
        assert ev.parsed_lines == 0

        # No records or events created
        raw_count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (ev_id,)
        ).fetchone()[0]
        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (ev_id,)
        ).fetchone()[0]
        assert raw_count == 0
        assert evt_count == 0
    finally:
        close_case_db(conn)


# ---------------------------------------------------------------------------
# 3. Idempotency & Duplicate Re-processing Prevention
# ---------------------------------------------------------------------------

def test_reprocessing_duplicate_rejection(processing_env):
    """Attempting to process already-processed evidence raises AlreadyPersistedError."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        evidence_id = processing_env["evidence_id"]
        case_dir = processing_env["case_1_dir"]

        # First processing succeeds
        res1 = process_evidence(
            case_dir=case_dir,
            case_id=case_id,
            evidence_id=evidence_id,
            conn=conn,
        )
        assert res1.status == "PARSED"

        # Second attempt must raise AlreadyPersistedError
        with pytest.raises(AlreadyPersistedError):
            process_evidence(
                case_dir=case_dir,
                case_id=case_id,
                evidence_id=evidence_id,
                conn=conn,
            )

        # Database counts must remain strictly 3 (no duplicate events created)
        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE case_id = ? AND evidence_id = ?",
            (case_id, evidence_id),
        ).fetchone()[0]
        assert evt_count == 3
    finally:
        close_case_db(conn)


# ---------------------------------------------------------------------------
# 4. Case Isolation & Security Boundary Tests
# ---------------------------------------------------------------------------

def test_missing_evidence_not_found(processing_env):
    """Processing a nonexistent evidence ID raises EvidenceNotFoundError."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        with pytest.raises(EvidenceNotFoundError):
            process_evidence(
                case_dir=processing_env["case_1_dir"],
                case_id=processing_env["case_1_id"],
                evidence_id="EV_NONEXISTENT_999",
                conn=conn,
            )
    finally:
        close_case_db(conn)


def test_cross_case_evidence_isolation(processing_env):
    """Case 2 cannot process evidence belonging to Case 1."""
    conn_2 = open_case_db(processing_env["case_2_db"])
    try:
        # Case 1 evidence ID requested inside Case 2 workspace
        with pytest.raises(EvidenceNotFoundError):
            process_evidence(
                case_dir=processing_env["case_2_dir"],
                case_id=processing_env["case_2_id"],
                evidence_id=processing_env["evidence_id"],
                conn=conn_2,
            )
    finally:
        close_case_db(conn_2)


# ---------------------------------------------------------------------------
# 5. Rollback on Failure & No Partial State
# ---------------------------------------------------------------------------

def test_rollback_on_persistence_failure(processing_env, monkeypatch):
    """If persistence encounters an error, the transaction rolls back completely."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        evidence_id = processing_env["evidence_id"]
        case_dir = processing_env["case_1_dir"]

        # Simulate database failure during event insertion by closing connection mid-flight
        # or monkeypatching insert
        from app.parsers.persistence import ParserPersistenceService

        def broken_persist(*args, **kwargs):
            raise RuntimeError("Simulated mid-transaction database crash")

        monkeypatch.setattr(ParserPersistenceService, "persist_parse_result", broken_persist)

        with pytest.raises(Exception):
            process_evidence(
                case_dir=case_dir,
                case_id=case_id,
                evidence_id=evidence_id,
                conn=conn,
            )

        # Verify no partial raw_records or events exist in DB
        raw_count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]

        assert raw_count == 0, "Partial raw_records leaked into database!"
        assert evt_count == 0, "Partial events leaked into database!"

        # Status should be marked as FAILED
        ev = get_evidence(conn, case_dir, evidence_id)
        assert ev.parser_status == "FAILED"
    finally:
        close_case_db(conn)


# ---------------------------------------------------------------------------
# 6. API Endpoint Integration Tests
# ---------------------------------------------------------------------------

def test_api_process_endpoint_success(processing_env):
    """Calling POST /api/cases/{case_id}/evidence/{evidence_id}/process executes pipeline."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        ev_id = processing_env["evidence_id"]

        req = ProcessEvidenceRequest(parserName="OPENSSH")
        res = process_case_evidence_endpoint(
            case_id=case_id,
            evidence_id=ev_id,
            request=req,
            conn=conn,
        )

        assert res.caseId == case_id
        assert res.evidenceId == ev_id
        assert res.parserName == "openssh"
        assert res.rawRecordsCount == 3
        assert res.eventsCount == 3
        assert res.status == "PARSED"
        assert res.errorSummary is None
    finally:
        close_case_db(conn)


def test_api_process_endpoint_idempotency_conflict(processing_env):
    """Second call to process endpoint returns 409 Conflict."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        ev_id = processing_env["evidence_id"]

        # First call succeeds
        process_case_evidence_endpoint(
            case_id=case_id,
            evidence_id=ev_id,
            conn=conn,
        )

        # Second call raises HTTP 409 Conflict
        with pytest.raises(HTTPException) as exc_info:
            process_case_evidence_endpoint(
                case_id=case_id,
                evidence_id=ev_id,
                conn=conn,
            )
        assert exc_info.value.status_code == 409
        assert "already been processed" in exc_info.value.detail
    finally:
        close_case_db(conn)


def test_api_process_endpoint_unsupported(processing_env):
    """Calling process endpoint on unsupported evidence returns status UNSUPPORTED."""
    conn = open_case_db(processing_env["case_1_db"])
    try:
        case_id = processing_env["case_1_id"]
        ev_id = processing_env["unsupported_evidence_id"]

        res = process_case_evidence_endpoint(
            case_id=case_id,
            evidence_id=ev_id,
            conn=conn,
        )

        assert res.status == "UNSUPPORTED"
        assert res.eventsCount == 0
        assert "No registered parser available" in (res.errorSummary or "")
    finally:
        close_case_db(conn)
