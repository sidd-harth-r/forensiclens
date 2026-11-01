"""
Test suite for ForensicLens parser persistence (Step 9).

Validates:
    - Basic persistence of RawRecords and ParsedEvents
    - Bit-level provenance preservation (offsets, lines, raw text)
    - Normalized event field mapping
    - Timestamp handling (ISO normalized, BSD syslog uninvented)
    - Referential integrity (case boundaries, foreign keys, unknown evidence)
    - Transactionality and atomic rollback on failure
    - Idempotency and duplicate persistence handling
    - FTS5 external content synchronization and querying
    - End-to-end integration: Evidence Ingestion (Step 7) -> Parser (Step 8) -> Persistence (Step 9)
"""

from __future__ import annotations

import io
import sqlite3
import sys
from pathlib import Path

import pytest

# Ensure imports resolve from backend directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.cases.database import close_case_db, initialize_case_db
from app.evidence.service import ingest_evidence
from app.parsers.base import (
    ParsedEvent,
    ParsedRecord,
    ParseResult,
    RawRecord,
    classify_ip_scope,
)
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import (
    AlreadyPersistedError,
    CaseNotFoundError,
    EvidenceNotFoundError,
    ParserPersistenceService,
    PersistenceError,
    ReferentialIntegrityError,
    compute_event_hash,
    persist_parse_result,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def case_env(tmp_path: Path):
    """
    Set up a temporary case environment with initialized database and evidence.

    Yields (tmp_path, case_id, db_conn, evidence_id).
    """
    case_id = "CASE_PERSIST_001"
    case_dir = tmp_path / "cases" / case_id
    case_dir.mkdir(parents=True)
    db_path = case_dir / "case.db"

    conn = initialize_case_db(db_path, case_id, "Persistence Test Case")

    # Ingest a mock evidence record in evidence_files
    evidence_id = "EV_PERSIST_TEST_01"
    conn.execute(
        """
        INSERT INTO evidence_files (
            evidence_id, case_id, object_hash, object_size_bytes,
            original_name, media_type, format, parser_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            evidence_id,
            case_id,
            "a" * 64,
            1024,
            "auth.log",
            "text/plain",
            "OPENSSH",
            "PENDING",
            "2026-01-15T10:00:00Z",
        ),
    )
    conn.commit()

    yield tmp_path, case_id, conn, evidence_id

    close_case_db(conn)


@pytest.fixture
def sample_openssh_result(case_env) -> ParseResult:
    """Produce a realistic ParseResult using OpenSSHParser."""
    _, _, _, evidence_id = case_env
    parser = OpenSSHParser()
    log_content = (
        "Jan 15 10:20:30 auth-gw sshd[1001]: Failed password for invalid user hacker from 93.184.216.34 port 45678 ssh2\n"
        "Jan 15 10:20:35 auth-gw sshd[1002]: Accepted publickey for analyst from 192.168.1.50 port 54321 ssh2: RSA SHA256:abc\n"
        "Jan 15 10:20:40 auth-gw sshd[1003]: Invalid user admin from 10.0.0.99 port 33333\n"
        "Jan 15 10:20:45 auth-gw sshd[1004]: Received disconnect from 93.184.216.34: 11: Bye [preauth]\n"
        "Jan 15 10:20:50 auth-gw sshd[1005]: Unrecognized subsystem event notification\n"
        "MALFORMED LINE WITHOUT PROPER HEADERS\n"
    )
    return parser.parse(log_content, evidence_id=evidence_id)


# ---------------------------------------------------------------------------
# 1. Basic Persistence Tests
# ---------------------------------------------------------------------------


class TestBasicPersistence:
    """Test standard persistence of raw records and normalized events."""

    def test_single_raw_record_and_event(self, case_env):
        """A single parsed line correctly inserts into raw_records and events."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        raw = RawRecord(
            record_no=1,
            line_number=1,
            byte_start=0,
            byte_end=85,
            raw_text="Jan 15 10:20:30 host sshd[123]: Accepted password for user from 192.168.1.1 port 22 ssh2",
            parse_status="PARSED",
        )
        event = ParsedEvent(
            timestamp_original="Jan 15 10:20:30",
            timestamp_utc=None,
            timestamp_confidence=None,
            source="OpenSSH",
            host="host",
            event_type="ssh.auth.success",
            severity="INFO",
            user_value="user",
            src_ip="192.168.1.1",
            src_ip_scope="PRIVATE",
            src_port=22,
            process="sshd",
            pid=123,
            message="Accepted password for user from 192.168.1.1 port 22 ssh2",
            parse_status="PARSED",
            line_number=1,
            byte_start=0,
            byte_end=85,
        )
        record = ParsedRecord(
            raw_record=raw,
            event=event,
            parser_name="openssh",
            parser_version="1.0.0",
            evidence_id=evidence_id,
        )
        parse_result = ParseResult(
            evidence_id=evidence_id,
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[record],
            total_lines=1,
            parsed_lines=1,
            partial_lines=0,
            unparsed_lines=0,
        )

        res = service.persist_parse_result(case_id, parse_result, conn=conn)

        assert res.persisted is True
        assert res.raw_records_count == 1
        assert res.events_count == 1
        assert res.fts_records_count == 1
        assert res.parser_status == "PARSED"

        # Verify raw_records row
        raw_row = conn.execute(
            "SELECT * FROM raw_records WHERE case_id = ? AND evidence_id = ?",
            (case_id, evidence_id),
        ).fetchone()
        assert raw_row is not None
        assert raw_row["raw_record_id"] == f"RAW_{evidence_id}_1"
        assert raw_row["record_no"] == 1
        assert raw_row["line_number"] == 1
        assert raw_row["byte_start"] == 0
        assert raw_row["byte_end"] == 85
        assert raw_row["raw_text"] == raw.raw_text
        assert raw_row["parse_status"] == "PARSED"

        # Verify events row
        evt_row = conn.execute(
            "SELECT * FROM events WHERE case_id = ? AND evidence_id = ?",
            (case_id, evidence_id),
        ).fetchone()
        assert evt_row is not None
        assert evt_row["event_id"] == f"EVT_{evidence_id}_1"
        assert evt_row["raw_record_id"] == raw_row["raw_record_id"]
        assert evt_row["event_type"] == "ssh.auth.success"
        assert evt_row["user_value"] == "user"
        assert evt_row["src_ip"] == "192.168.1.1"
        assert evt_row["source_file_name"] == "auth.log"

    def test_multi_record_batch_persistence(self, case_env, sample_openssh_result):
        """Batch persistence creates raw records, events, and updates evidence status."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        res = service.persist_parse_result(case_id, sample_openssh_result, conn=conn)

        assert res.persisted is True
        assert res.raw_records_count == 6
        # 4 PARSED + 1 PARTIAL = 5 events created; 1 UNPARSED line has event=None
        assert res.events_count == 5
        assert res.fts_records_count == 5
        assert res.parser_status == "PARTIAL"

        # Verify total counts in DB
        raw_count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        assert raw_count == 6
        assert evt_count == 5

        # Verify evidence_files updated
        ev_row = conn.execute(
            "SELECT parser_status, total_lines, parsed_lines, parser_version "
            "FROM evidence_files WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()
        assert ev_row["parser_status"] == "PARTIAL"
        assert ev_row["total_lines"] == 6
        assert ev_row["parsed_lines"] == 4
        assert ev_row["parser_version"] == "1.0.0"

    def test_unparsed_record_persists_without_event(self, case_env):
        """Unparsed lines insert a raw_records row with error, but no events row."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        raw = RawRecord(
            record_no=1,
            line_number=1,
            byte_start=0,
            byte_end=30,
            raw_text="GARBAGE CORRUPTED BYTES",
            parse_status="UNPARSED",
            parse_error="Failed syslog header extraction",
        )
        record = ParsedRecord(
            raw_record=raw,
            event=None,
            parser_name="openssh",
            parser_version="1.0.0",
            evidence_id=evidence_id,
        )
        result = ParseResult(
            evidence_id=evidence_id,
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[record],
            total_lines=1,
            parsed_lines=0,
            partial_lines=0,
            unparsed_lines=1,
        )

        res = service.persist_parse_result(case_id, result, conn=conn)
        assert res.persisted is True
        assert res.raw_records_count == 1
        assert res.events_count == 0
        assert res.parser_status == "FAILED"

        raw_row = conn.execute(
            "SELECT parse_status, parse_error FROM raw_records WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()
        assert raw_row["parse_status"] == "UNPARSED"
        assert raw_row["parse_error"] == "Failed syslog header extraction"

        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        assert evt_count == 0

    def test_empty_parse_result(self, case_env):
        """Empty parse result updates status safely without errors."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        empty_result = ParseResult(
            evidence_id=evidence_id,
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[],
            total_lines=0,
            parsed_lines=0,
            partial_lines=0,
            unparsed_lines=0,
        )

        res = service.persist_parse_result(case_id, empty_result, conn=conn)
        assert res.persisted is True
        assert res.raw_records_count == 0
        assert res.events_count == 0
        assert res.parser_status == "PARSED"


# ---------------------------------------------------------------------------
# 2. Provenance Preservation Tests
# ---------------------------------------------------------------------------


class TestProvenancePreservation:
    """Ensure raw forensic text, byte ranges, and line numbers are uncorrupted."""

    def test_raw_text_preserved_exactly(self, case_env):
        """Raw text with tabs, spaces, quotes, and punctuation is stored bit-for-bit."""
        tmp_path, case_id, conn, evidence_id = case_env
        raw_text = 'Jan 15 10:20:30 host sshd[1]: "quotes" and \t tabs and <special>&chars'
        raw = RawRecord(
            record_no=1,
            line_number=1,
            byte_start=100,
            byte_end=173,
            raw_text=raw_text,
            parse_status="UNPARSED",
            parse_error="None",
        )
        rec = ParsedRecord(
            raw_record=raw,
            event=None,
            parser_name="openssh",
            parser_version="1.0.0",
            evidence_id=evidence_id,
        )
        res = ParseResult(
            evidence_id=evidence_id,
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[rec],
            total_lines=1,
            parsed_lines=0,
            partial_lines=0,
            unparsed_lines=1,
        )

        persist_parse_result(case_id, res, conn=conn)

        row = conn.execute(
            "SELECT raw_text, byte_start, byte_end FROM raw_records WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()
        assert row["raw_text"] == raw_text
        assert row["byte_start"] == 100
        assert row["byte_end"] == 173

    def test_byte_offsets_match_source_slice(self, case_env):
        """Byte offsets in raw_records allow exact source byte slice reconstruction."""
        tmp_path, case_id, conn, evidence_id = case_env
        source_data = (
            b"Line 1: Jan 15 10:00:00 host sshd[1]: msg1\n"
            b"Line 2: Jan 15 10:00:05 host sshd[2]: msg2\n"
        )
        parser = OpenSSHParser()
        result = parser.parse(source_data, evidence_id=evidence_id)

        persist_parse_result(case_id, result, conn=conn)

        rows = conn.execute(
            "SELECT byte_start, byte_end, raw_text FROM raw_records "
            "WHERE evidence_id = ? ORDER BY record_no",
            (evidence_id,),
        ).fetchall()

        for row in rows:
            sliced = source_data[row["byte_start"] : row["byte_end"]].decode("utf-8").rstrip("\r\n")
            assert sliced == row["raw_text"]


# ---------------------------------------------------------------------------
# 3. Event Field Mapping & Timestamp Behavior Tests
# ---------------------------------------------------------------------------


class TestEventMapping:
    """Verify structured field mapping into the events table."""

    def test_structured_fields_and_hash(self, case_env):
        """Verify normalization of user, IP, scope, port, event_type, and event_hash."""
        tmp_path, case_id, conn, evidence_id = case_env
        log_line = "Jan 15 10:20:30 myhost sshd[9999]: Failed password for root from 93.184.216.34 port 54321 ssh2\n"
        parser = OpenSSHParser()
        res = parser.parse(log_line, evidence_id=evidence_id)

        persist_parse_result(case_id, res, conn=conn)

        evt = conn.execute(
            "SELECT * FROM events WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()

        assert evt["event_type"] == "AUTH_FAILURE"
        assert evt["severity"] == "WARNING"
        assert evt["user_value"] == "root"
        assert evt["src_ip"] == "93.184.216.34"
        assert evt["src_ip_scope"] == "PUBLIC"
        assert evt["src_port"] == 54321
        assert evt["host"] == "myhost"
        assert evt["process"] == "sshd"
        assert evt["pid"] == 9999
        assert evt["source"] == "OpenSSH"
        assert len(evt["event_hash"]) == 64  # SHA-256 hex digest

    def test_explicit_iso_timestamp_normalized(self, case_env):
        """ISO-8601 timestamps with timezone offsets are converted to UTC RFC3339."""
        tmp_path, case_id, conn, evidence_id = case_env
        # Log with ISO-8601 with +05:30 offset
        iso_log = "2026-01-15T15:50:30+05:30 server sshd[123]: Accepted password for dev from 10.0.0.1 port 22 ssh2\n"
        parser = OpenSSHParser()
        res = parser.parse(iso_log, evidence_id=evidence_id)

        persist_parse_result(case_id, res, conn=conn)

        evt = conn.execute(
            "SELECT timestamp_original, timestamp_utc, timestamp_confidence "
            "FROM events WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()

        assert evt["timestamp_original"] == "2026-01-15T15:50:30+05:30"
        assert evt["timestamp_utc"] == "2026-01-15T10:20:30Z"
        assert evt["timestamp_confidence"] == "EXACT"

    def test_bsd_syslog_timestamp_unresolved(self, case_env):
        """BSD timestamps without year/timezone leave timestamp_utc and confidence NULL."""
        tmp_path, case_id, conn, evidence_id = case_env
        bsd_log = "Jan 15 10:20:30 server sshd[123]: Accepted password for dev from 10.0.0.1 port 22 ssh2\n"
        parser = OpenSSHParser()
        res = parser.parse(bsd_log, evidence_id=evidence_id)

        persist_parse_result(case_id, res, conn=conn)

        evt = conn.execute(
            "SELECT timestamp_original, timestamp_utc, timestamp_confidence "
            "FROM events WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()

        assert evt["timestamp_original"] == "Jan 15 10:20:30"
        assert evt["timestamp_utc"] is None
        assert evt["timestamp_confidence"] is None


# ---------------------------------------------------------------------------
# 4. Referential Integrity Tests
# ---------------------------------------------------------------------------


class TestReferentialIntegrity:
    """Validate case isolation, evidence existence, and foreign key rules."""

    def test_unknown_case_id_rejected(self, case_env, sample_openssh_result):
        """Persistence with nonexistent case_id raises CaseNotFoundError."""
        _, _, conn, _ = case_env
        service = ParserPersistenceService()

        with pytest.raises(CaseNotFoundError, match="Case 'NONEXISTENT_CASE' not found"):
            service.persist_parse_result("NONEXISTENT_CASE", sample_openssh_result, conn=conn)

    def test_unknown_evidence_id_rejected(self, case_env):
        """Persistence with unknown evidence_id raises EvidenceNotFoundError."""
        _, case_id, conn, _ = case_env
        service = ParserPersistenceService()

        bad_result = ParseResult(
            evidence_id="UNKNOWN_EV_999",
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[],
            total_lines=0,
            parsed_lines=0,
            partial_lines=0,
            unparsed_lines=0,
        )

        with pytest.raises(EvidenceNotFoundError, match="Evidence 'UNKNOWN_EV_999' not found"):
            service.persist_parse_result(case_id, bad_result, conn=conn)

    def test_cross_case_evidence_association_rejected(self, tmp_path):
        """Evidence belonging to another case raises ReferentialIntegrityError."""
        case_a = "CASE_A"
        case_b = "CASE_B"

        case_a_dir = tmp_path / "cases" / case_a
        case_b_dir = tmp_path / "cases" / case_b
        case_a_dir.mkdir(parents=True)
        case_b_dir.mkdir(parents=True)

        conn_a = initialize_case_db(case_a_dir / "case.db", case_a, "Case A")
        conn_b = initialize_case_db(case_b_dir / "case.db", case_b, "Case B")

        # Ingest evidence in Case A
        conn_a.execute(
            """
            INSERT INTO evidence_files (
                evidence_id, case_id, object_hash, object_size_bytes,
                original_name, format, parser_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("EV_A", case_a, "hash_a" * 8, 100, "auth.log", "OPENSSH", "PENDING", "2026-01-01T00:00:00Z"),
        )
        conn_a.commit()

        # Try to persist EV_A under Case B's connection
        parser = OpenSSHParser()
        result = parser.parse("Jan 15 10:20:30 h sshd[1]: msg\n", evidence_id="EV_A")
        service = ParserPersistenceService()

        # EV_A doesn't even exist in case B's DB -> EvidenceNotFoundError
        with pytest.raises(EvidenceNotFoundError):
            service.persist_parse_result(case_b, result, conn=conn_b)

        close_case_db(conn_a)
        close_case_db(conn_b)


# ---------------------------------------------------------------------------
# 5. Transactionality and Rollback Tests
# ---------------------------------------------------------------------------


class TestTransactionality:
    """Ensure atomic rollback leaves database completely clean on errors."""

    def test_mid_batch_failure_causes_complete_rollback(self, case_env):
        """If one event violates a constraint, all previous records are rolled back."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        # Create two valid records and one record with an invalid status that fails CHECK constraint
        rec1 = ParsedRecord(
            raw_record=RawRecord(1, 1, 0, 50, "line 1 text", "PARSED"),
            event=ParsedEvent(message="valid event 1", event_type="ssh.auth.success", parse_status="PARSED"),
            parser_name="openssh",
            parser_version="1.0.0",
            evidence_id=evidence_id,
        )
        # Invalid parse_status violates CHECK (parse_status IN ('PARSED', 'UNPARSED', 'PARTIAL'))
        rec2_bad = ParsedRecord(
            raw_record=RawRecord(2, 2, 50, 100, "line 2 text", "INVALID_STATUS"),  # Constraint violation!
            event=None,
            parser_name="openssh",
            parser_version="1.0.0",
            evidence_id=evidence_id,
        )
        batch = ParseResult(
            evidence_id=evidence_id,
            parser_name="openssh",
            parser_version="1.0.0",
            supported_format="OPENSSH",
            records=[rec1, rec2_bad],
            total_lines=2,
            parsed_lines=1,
            partial_lines=0,
            unparsed_lines=1,
        )

        with pytest.raises(ReferentialIntegrityError):
            service.persist_parse_result(case_id, batch, conn=conn)

        # Verify database has ZERO records or events
        raw_count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        evt_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        fts_count = conn.execute(
            "SELECT COUNT(*) FROM events_fts WHERE events_fts MATCH 'valid'"
        ).fetchone()[0]

        assert raw_count == 0, "Rollback failed: partial raw_records remain!"
        assert evt_count == 0, "Rollback failed: partial events remain!"
        assert fts_count == 0, "Rollback failed: partial events_fts remain!"

        # Evidence parser status remains PENDING
        status = conn.execute(
            "SELECT parser_status FROM evidence_files WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()[0]
        assert status == "PENDING"


# ---------------------------------------------------------------------------
# 6. Idempotency and Duplicate Handling Tests
# ---------------------------------------------------------------------------


class TestIdempotency:
    """Verify duplicate parse persistence behavior."""

    def test_duplicate_persistence_rejected_by_default(self, case_env, sample_openssh_result):
        """Repeated persistence with default policy raises AlreadyPersistedError."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        # First run succeeds
        res1 = service.persist_parse_result(case_id, sample_openssh_result, conn=conn)
        assert res1.persisted is True

        # Second run fails with AlreadyPersistedError
        with pytest.raises(AlreadyPersistedError, match="has already been persisted"):
            service.persist_parse_result(case_id, sample_openssh_result, conn=conn)

        # Verify record count has not doubled
        count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        assert count == 6

    def test_duplicate_persistence_safely_ignored_when_requested(
        self, case_env, sample_openssh_result
    ):
        """Persistence with if_exists='ignore' returns persisted=False without error."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        # First run
        service.persist_parse_result(case_id, sample_openssh_result, conn=conn)

        # Second run with ignore
        res2 = service.persist_parse_result(
            case_id, sample_openssh_result, conn=conn, if_exists="ignore"
        )
        assert res2.persisted is False
        assert res2.raw_records_count == 6
        assert res2.events_count == 5

        # Counts still unchanged
        count = conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0]
        assert count == 6


# ---------------------------------------------------------------------------
# 7. FTS5 Search Synchronization Tests
# ---------------------------------------------------------------------------


class TestFTS5Synchronization:
    """Verify persisted events are indexed and discoverable in FTS5."""

    def test_fts5_lexical_discovery(self, case_env, sample_openssh_result):
        """Events can be queried via FTS5 MATCH on message and metadata."""
        tmp_path, case_id, conn, evidence_id = case_env
        service = ParserPersistenceService(data_dir=tmp_path)

        service.persist_parse_result(case_id, sample_openssh_result, conn=conn)

        # Search for 'hacker' in message
        matches = conn.execute(
            "SELECT rowid, message, event_type FROM events_fts WHERE events_fts MATCH 'hacker'"
        ).fetchall()
        assert len(matches) == 1
        assert "hacker" in matches[0]["message"]
        assert matches[0]["event_type"] == "AUTH_FAILURE"

        # Search by indexed column 'process'
        proc_matches = conn.execute(
            "SELECT rowid, process FROM events_fts WHERE events_fts MATCH 'process:sshd'"
        ).fetchall()
        assert len(proc_matches) == 5

        # Search non-existent term
        no_matches = conn.execute(
            "SELECT rowid FROM events_fts WHERE events_fts MATCH 'quantum_crypto_xyz'"
        ).fetchall()
        assert len(no_matches) == 0


# ---------------------------------------------------------------------------
# 8. End-to-End Ingestion-Parser-Persistence Pipeline
# ---------------------------------------------------------------------------


class TestEndToEndPipeline:
    """Test full pipeline: EvidenceService -> OpenSSHParser -> ParserPersistenceService."""

    def test_full_pipeline_flow(self, tmp_path: Path):
        """Complete workflow from raw disk log to searchable database entries."""
        case_id = "CASE_E2E_001"
        case_dir = tmp_path / "cases" / case_id
        case_dir.mkdir(parents=True)
        db_path = case_dir / "case.db"

        conn = initialize_case_db(db_path, case_id, "E2E Investigation Case")

        # 1. Step 7: Ingest evidence file
        log_file = tmp_path / "source_auth.log"
        log_content = (
            "Jan 15 10:20:30 srv sshd[501]: Failed password for root from 198.51.100.22 port 2222 ssh2\n"
            "Jan 15 10:20:35 srv sshd[502]: Accepted password for admin from 192.168.1.10 port 3333 ssh2\n"
        )
        log_file.write_text(log_content, encoding="utf-8")

        evidence_rec = ingest_evidence(
            conn=conn,
            case_dir=case_dir,
            case_id=case_id,
            source=log_file,
            original_name="auth.log",
            format_name="OPENSSH",
        )

        assert evidence_rec.parser_status == "PENDING"

        # 2. Step 8: Parse evidence from immutable storage
        stored_path = Path(evidence_rec.storage_path)
        assert stored_path.exists()

        parser = OpenSSHParser()
        parse_result = parser.parse(stored_path, evidence_id=evidence_rec.evidence_id)
        assert parse_result.total_lines == 2
        assert parse_result.parsed_lines == 2

        # 3. Step 9: Persist parse result into case database
        persist_service = ParserPersistenceService(data_dir=tmp_path)
        persist_res = persist_service.persist_parse_result(
            case_id=case_id, parse_result=parse_result, conn=conn
        )

        assert persist_res.persisted is True
        assert persist_res.raw_records_count == 2
        assert persist_res.events_count == 2
        assert persist_res.parser_status == "PARSED"

        # 4. Verify database state
        ev_updated = conn.execute(
            "SELECT parser_status, parsed_lines, total_lines FROM evidence_files WHERE evidence_id = ?",
            (evidence_rec.evidence_id,),
        ).fetchone()
        assert ev_updated["parser_status"] == "PARSED"
        assert ev_updated["parsed_lines"] == 2
        assert ev_updated["total_lines"] == 2

        # 5. Verify FTS5 searchability
        fts_match = conn.execute(
            "SELECT message, event_type FROM events_fts WHERE events_fts MATCH 'admin'"
        ).fetchone()
        assert fts_match is not None
        assert fts_match["event_type"] == "AUTH_SUCCESS"

        close_case_db(conn)
