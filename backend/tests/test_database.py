"""
Test suite for the ForensicLens case database foundation.

Tests cover:
    - Schema creation from a fresh database
    - Migration application (001_initial.sql)
    - Foreign key enforcement
    - FTS5 table creation and querying
    - Case isolation (separate databases per case)
    - Idempotent initialization (repeated runs do not corrupt)
    - Constraint and index verification
    - Legal KB initialization

All tests use temporary databases that are cleaned up automatically.
No persistent test databases are created in the repository.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import uuid
from pathlib import Path

import pytest

# Ensure imports resolve from the backend directory
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.cases.database import (
    EXPECTED_FTS_TABLES,
    EXPECTED_TABLES,
    SCHEMA_VERSION,
    DatabaseError,
    FTS5NotAvailableError,
    MigrationError,
    SchemaValidationError,
    close_case_db,
    get_case_db_path,
    initialize_case_db,
    initialize_legal_kb,
    open_case_db,
    run_migrations,
    verify_schema,
)


# ---------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------


@pytest.fixture
def tmp_data_dir(tmp_path: Path) -> Path:
    """Provide a temporary data directory for case databases."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return data_dir


@pytest.fixture
def case_id() -> str:
    """Generate a unique case ID for testing."""
    return f"CASE_{uuid.uuid4().hex[:12].upper()}"


@pytest.fixture
def initialized_db(tmp_data_dir: Path, case_id: str):
    """Create and return an initialized case database connection."""
    db_path = get_case_db_path(tmp_data_dir, case_id)
    conn = initialize_case_db(db_path, case_id, "Test Case")
    yield conn
    close_case_db(conn)


# ---------------------------------------------------------------
# 1. Schema creation tests
# ---------------------------------------------------------------


class TestSchemaCreation:
    """Test that a fresh database can be created successfully."""

    def test_create_new_case_database(self, tmp_data_dir: Path, case_id: str):
        """A new case database file is created on disk."""
        db_path = get_case_db_path(tmp_data_dir, case_id)
        assert not db_path.exists()

        conn = initialize_case_db(db_path, case_id, "Test Case")
        try:
            assert db_path.exists()
            assert db_path.stat().st_size > 0
        finally:
            close_case_db(conn)

    def test_parent_directories_created(self, tmp_data_dir: Path, case_id: str):
        """Parent directories are created automatically."""
        db_path = get_case_db_path(tmp_data_dir, case_id)
        assert not db_path.parent.exists()

        conn = initialize_case_db(db_path, case_id, "Test Case")
        try:
            assert db_path.parent.is_dir()
        finally:
            close_case_db(conn)

    def test_case_record_inserted(self, initialized_db: sqlite3.Connection, case_id: str):
        """The initial case record is created with correct values."""
        row = initialized_db.execute(
            "SELECT case_id, name, status, schema_version FROM cases"
        ).fetchone()
        assert row is not None
        assert row["case_id"] == case_id
        assert row["name"] == "Test Case"
        assert row["status"] == "OPEN"
        assert row["schema_version"] == SCHEMA_VERSION

    def test_privacy_config_seeded(self, initialized_db: sqlite3.Connection, case_id: str):
        """Default privacy configuration L2 is seeded per DATABASE.md section 10."""
        row = initialized_db.execute(
            "SELECT case_id, level FROM privacy_configs"
        ).fetchone()
        assert row is not None
        assert row["case_id"] == case_id
        assert row["level"] == "L2"

    def test_all_expected_tables_exist(self, initialized_db: sqlite3.Connection):
        """All P0 tables specified in DATABASE.md are present."""
        rows = initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'events_fts%' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        actual_tables = {row["name"] for row in rows}
        for table in EXPECTED_TABLES:
            assert table in actual_tables, f"Missing table: {table}"

    def test_all_fts5_tables_exist(self, initialized_db: sqlite3.Connection):
        """All FTS5 virtual tables specified in DATABASE.md are present."""
        rows = initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%'"
        ).fetchall()
        fts_tables = {row["name"] for row in rows}
        for table in EXPECTED_FTS_TABLES:
            assert table in fts_tables, f"Missing FTS5 table: {table}"


# ---------------------------------------------------------------
# 2. Migration tests
# ---------------------------------------------------------------


class TestMigration:
    """Test that 001_initial.sql applies successfully."""

    def test_migration_applies_cleanly(self, tmp_data_dir: Path, case_id: str):
        """Migration runs without errors on a fresh database."""
        db_path = get_case_db_path(tmp_data_dir, case_id)
        conn = open_case_db(db_path, create=True)
        try:
            applied = run_migrations(conn)
            assert 1 in applied
        finally:
            close_case_db(conn)

    def test_schema_migrations_table_populated(self, initialized_db: sqlite3.Connection):
        """The schema_migrations table records the applied migration."""
        row = initialized_db.execute(
            "SELECT version, checksum, applied_at FROM schema_migrations "
            "WHERE version = 1"
        ).fetchone()
        assert row is not None
        assert row["version"] == 1
        assert len(row["checksum"]) == 64  # SHA-256 hex
        assert row["applied_at"] is not None

    def test_migration_checksum_is_consistent(self, tmp_data_dir: Path):
        """Two fresh databases get the same migration checksum."""
        checksums = []
        for i in range(2):
            cid = f"CASE_CHECK_{i}"
            db_path = get_case_db_path(tmp_data_dir, cid)
            conn = initialize_case_db(db_path, cid, f"Check {i}")
            row = conn.execute(
                "SELECT checksum FROM schema_migrations WHERE version = 1"
            ).fetchone()
            checksums.append(row["checksum"])
            close_case_db(conn)
        assert checksums[0] == checksums[1]


# ---------------------------------------------------------------
# 3. Foreign key tests
# ---------------------------------------------------------------


class TestForeignKeys:
    """Test that foreign-key enforcement is enabled."""

    def test_foreign_keys_pragma_enabled(self, initialized_db: sqlite3.Connection):
        """PRAGMA foreign_keys returns 1."""
        row = initialized_db.execute("PRAGMA foreign_keys").fetchone()
        assert row[0] == 1

    def test_fk_violation_raises_error(self, initialized_db: sqlite3.Connection):
        """Inserting a row with an invalid FK raises IntegrityError."""
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO evidence_files "
                "(evidence_id, case_id, object_hash, object_size_bytes, "
                "original_name, format, parser_status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "EV_NONEXISTENT",
                    "CASE_DOES_NOT_EXIST",  # invalid FK
                    "abc123",
                    100,
                    "test.log",
                    "TXT",
                    "PENDING",
                    "2026-01-01T00:00:00Z",
                ),
            )

    def test_valid_fk_insert_succeeds(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Inserting a row with a valid FK succeeds."""
        initialized_db.execute(
            "INSERT INTO evidence_files "
            "(evidence_id, case_id, object_hash, object_size_bytes, "
            "original_name, format, parser_status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "EV_001",
                case_id,  # valid FK
                "abc123def456",
                1024,
                "auth.log",
                "OPENSSH",
                "PENDING",
                "2026-01-01T00:00:00Z",
            ),
        )
        row = initialized_db.execute(
            "SELECT evidence_id FROM evidence_files WHERE evidence_id = 'EV_001'"
        ).fetchone()
        assert row is not None


# ---------------------------------------------------------------
# 4. FTS5 tests
# ---------------------------------------------------------------


class TestFTS5:
    """Test FTS5 table creation and querying."""

    def _insert_test_event(
        self, conn: sqlite3.Connection, case_id: str, evidence_id: str
    ) -> str:
        """Helper: insert a test event and sync to FTS5."""
        event_id = f"EV_{uuid.uuid4().hex[:8]}"

        # Insert event
        conn.execute(
            "INSERT INTO events "
            "(event_id, case_id, evidence_id, message, command_value, "
            "resource, process, event_type, source, host, "
            "parse_status, event_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                case_id,
                evidence_id,
                "Failed password for root from 192.168.1.100 port 22 ssh2",
                "ssh root@192.168.1.100",
                "/var/log/auth.log",
                "sshd",
                "AUTH_FAILURE",
                "OpenSSH",
                "webserver-01",
                "PARSED",
                "deadbeef" * 8,
                "2026-01-15T10:30:00Z",
            ),
        )

        # Manually sync to FTS5 content-sync table
        rowid = conn.execute(
            "SELECT rowid FROM events WHERE event_id = ?", (event_id,)
        ).fetchone()[0]

        conn.execute(
            "INSERT INTO events_fts (rowid, message, command_value, resource, "
            "process, event_type, source, host) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                rowid,
                "Failed password for root from 192.168.1.100 port 22 ssh2",
                "ssh root@192.168.1.100",
                "/var/log/auth.log",
                "sshd",
                "AUTH_FAILURE",
                "OpenSSH",
                "webserver-01",
            ),
        )
        conn.commit()
        return event_id

    def _ensure_evidence(
        self, conn: sqlite3.Connection, case_id: str
    ) -> str:
        """Helper: ensure a test evidence_file record exists."""
        evidence_id = "EV_FTS_TEST"
        existing = conn.execute(
            "SELECT evidence_id FROM evidence_files WHERE evidence_id = ?",
            (evidence_id,),
        ).fetchone()
        if existing:
            return evidence_id

        conn.execute(
            "INSERT INTO evidence_files "
            "(evidence_id, case_id, object_hash, object_size_bytes, "
            "original_name, format, parser_status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                evidence_id,
                case_id,
                "fts_test_hash_" + "0" * 50,
                2048,
                "auth.log",
                "OPENSSH",
                "PARSED",
                "2026-01-01T00:00:00Z",
            ),
        )
        conn.commit()
        return evidence_id

    def test_events_fts_table_exists(self, initialized_db: sqlite3.Connection):
        """The events_fts FTS5 virtual table is created."""
        row = initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%' "
            "AND name = 'events_fts'"
        ).fetchone()
        assert row is not None

    def test_fts5_insert_and_match(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Records can be inserted and matched via FTS5 MATCH."""
        evidence_id = self._ensure_evidence(initialized_db, case_id)
        self._insert_test_event(initialized_db, case_id, evidence_id)

        results = initialized_db.execute(
            "SELECT * FROM events_fts WHERE events_fts MATCH 'password'"
        ).fetchall()
        assert len(results) >= 1

    def test_fts5_match_specific_column(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """FTS5 MATCH works on specific indexed columns."""
        evidence_id = self._ensure_evidence(initialized_db, case_id)
        self._insert_test_event(initialized_db, case_id, evidence_id)

        # Use quoted phrase to avoid FTS5 parsing hyphens as operators
        results = initialized_db.execute(
            'SELECT * FROM events_fts WHERE events_fts MATCH \'host:"webserver"\''
        ).fetchall()
        assert len(results) >= 1

    def test_fts5_no_results_for_nonexistent_term(
        self, initialized_db: sqlite3.Connection
    ):
        """FTS5 MATCH returns no results for terms not in the index."""
        results = initialized_db.execute(
            "SELECT * FROM events_fts WHERE events_fts MATCH 'zzz_nonexistent_zzz'"
        ).fetchall()
        assert len(results) == 0


# ---------------------------------------------------------------
# 5. Case isolation tests
# ---------------------------------------------------------------


class TestCaseIsolation:
    """Test that each case database is isolated."""

    def test_separate_databases_are_independent(self, tmp_data_dir: Path):
        """Two case databases have independent data."""
        case_a_id = "CASE_ISOLATION_A"
        case_b_id = "CASE_ISOLATION_B"

        db_a_path = get_case_db_path(tmp_data_dir, case_a_id)
        db_b_path = get_case_db_path(tmp_data_dir, case_b_id)

        conn_a = initialize_case_db(db_a_path, case_a_id, "Case A")
        conn_b = initialize_case_db(db_b_path, case_b_id, "Case B")

        try:
            # Each database has exactly one case record
            count_a = conn_a.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            count_b = conn_b.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            assert count_a == 1
            assert count_b == 1

            # Case A only has case A's data
            row_a = conn_a.execute(
                "SELECT case_id FROM cases"
            ).fetchone()
            assert row_a["case_id"] == case_a_id

            # Case B only has case B's data
            row_b = conn_b.execute(
                "SELECT case_id FROM cases"
            ).fetchone()
            assert row_b["case_id"] == case_b_id

        finally:
            close_case_db(conn_a)
            close_case_db(conn_b)

    def test_case_db_paths_are_distinct(self, tmp_data_dir: Path):
        """Different case IDs produce different database paths."""
        path_a = get_case_db_path(tmp_data_dir, "CASE_A")
        path_b = get_case_db_path(tmp_data_dir, "CASE_B")
        assert path_a != path_b
        assert path_a.parent.name == "CASE_A"
        assert path_b.parent.name == "CASE_B"

    def test_case_db_path_structure(self, tmp_data_dir: Path):
        """Case DB path follows data/cases/<case_id>/case.db structure."""
        path = get_case_db_path(tmp_data_dir, "MY_CASE")
        assert path.name == "case.db"
        assert path.parent.name == "MY_CASE"
        assert path.parent.parent.name == "cases"


# ---------------------------------------------------------------
# 6. Repeated initialization tests
# ---------------------------------------------------------------


class TestIdempotentInitialization:
    """Test that repeated initialization does not corrupt the schema."""

    def test_double_migration_is_safe(self, tmp_data_dir: Path, case_id: str):
        """Running migrations twice does not error or duplicate tables."""
        db_path = get_case_db_path(tmp_data_dir, case_id)
        conn = initialize_case_db(db_path, case_id, "Test Case")
        try:
            # Run migrations again on the same connection
            newly_applied = run_migrations(conn)
            assert newly_applied == []  # nothing new to apply

            # Schema is still valid
            result = verify_schema(conn)
            assert result["valid"]

            # Still exactly one case record
            count = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            assert count == 1
        finally:
            close_case_db(conn)

    def test_reopen_existing_db(self, tmp_data_dir: Path, case_id: str):
        """Opening an existing database and re-running migrations is safe."""
        db_path = get_case_db_path(tmp_data_dir, case_id)

        # First initialization
        conn1 = initialize_case_db(db_path, case_id, "Test Case")
        close_case_db(conn1)

        # Reopen and re-migrate
        conn2 = open_case_db(db_path)
        try:
            newly_applied = run_migrations(conn2)
            assert newly_applied == []
            result = verify_schema(conn2)
            assert result["valid"]
        finally:
            close_case_db(conn2)

    def test_table_count_stable_after_remigration(
        self, tmp_data_dir: Path, case_id: str
    ):
        """Table count does not change after re-running migrations."""
        db_path = get_case_db_path(tmp_data_dir, case_id)
        conn = initialize_case_db(db_path, case_id, "Test Case")
        try:
            tables_before = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"
            ).fetchone()[0]

            run_migrations(conn)

            tables_after = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"
            ).fetchone()[0]

            assert tables_before == tables_after
        finally:
            close_case_db(conn)


# ---------------------------------------------------------------
# 7. Constraint and index verification tests
# ---------------------------------------------------------------


class TestConstraintsAndIndexes:
    """Test that required constraints and indexes exist."""

    def test_check_constraints_on_case_status(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Invalid case status is rejected by CHECK constraint."""
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO cases "
                "(case_id, name, status, created_at, updated_at, schema_version) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "CASE_BAD_STATUS",
                    "Bad",
                    "INVALID_STATUS",
                    "2026-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                    1,
                ),
            )

    def test_check_constraints_on_parser_status(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Invalid parser_status is rejected by CHECK constraint."""
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO evidence_files "
                "(evidence_id, case_id, object_hash, object_size_bytes, "
                "original_name, format, parser_status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "EV_BAD",
                    case_id,
                    "hash123",
                    100,
                    "test.log",
                    "TXT",
                    "INVALID_PARSER_STATUS",
                    "2026-01-01T00:00:00Z",
                ),
            )

    def test_check_constraints_on_privacy_level(
        self, initialized_db: sqlite3.Connection
    ):
        """Invalid privacy level is rejected by CHECK constraint."""
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO privacy_configs (case_id, level, updated_at) "
                "VALUES (?, ?, ?)",
                ("CASE_BAD", "L9", "2026-01-01T00:00:00Z"),
            )

    def test_check_constraints_on_claim_status(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Invalid claim status is rejected by CHECK constraint."""
        # First create investigation
        initialized_db.execute(
            "INSERT INTO investigations "
            "(investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("INV_001", case_id, "test query", "L2", "ACTIVE", "2026-01-01T00:00:00Z"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO claims "
                "(claim_id, case_id, investigation_id, claim_type, "
                "model_output_json, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    "CLAIM_BAD",
                    case_id,
                    "INV_001",
                    "TEST",
                    "{}",
                    "INVALID_STATUS",
                    "2026-01-01T00:00:00Z",
                ),
            )

    def test_check_constraints_on_boolean_is_checked(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Boolean column is_checked only accepts 0 or 1."""
        # Create required parent records
        initialized_db.execute(
            "INSERT INTO investigations "
            "(investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("INV_BOOL", case_id, "test", "L2", "ACTIVE", "2026-01-01T00:00:00Z"),
        )
        initialized_db.execute(
            "INSERT INTO claims "
            "(claim_id, case_id, investigation_id, claim_type, "
            "model_output_json, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("CLAIM_BOOL", case_id, "INV_BOOL", "TEST", "{}", "PROPOSED", "2026-01-01T00:00:00Z"),
        )

        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO claim_slots "
                "(claim_slot_id, claim_id, slot_name, entity_type, "
                "resolution_status, is_checked) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("SLOT_BAD", "CLAIM_BOOL", "user", "USER", "NOT_REQUIRED", 2),
            )

    def test_unique_constraint_on_entities(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Duplicate (case_id, entity_type, canonical_value) is rejected."""
        initialized_db.execute(
            "INSERT INTO entities "
            "(entity_id, case_id, entity_type, canonical_value, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("ENT_001", case_id, "USER", "root", "2026-01-01T00:00:00Z"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO entities "
                "(entity_id, case_id, entity_type, canonical_value, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                ("ENT_002", case_id, "USER", "root", "2026-01-01T00:00:00Z"),
            )

    def test_unique_constraint_on_audit_sequence(
        self, initialized_db: sqlite3.Connection, case_id: str
    ):
        """Duplicate (case_id, sequence_no) in audit_records is rejected."""
        initialized_db.execute(
            "INSERT INTO audit_records "
            "(audit_id, case_id, sequence_no, event_type, metadata_json, "
            "record_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("AUD_001", case_id, 1, "CASE_CREATED", "{}", "hash001", "2026-01-01T00:00:00Z"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            initialized_db.execute(
                "INSERT INTO audit_records "
                "(audit_id, case_id, sequence_no, event_type, metadata_json, "
                "record_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("AUD_002", case_id, 1, "DUPLICATE", "{}", "hash002", "2026-01-01T00:00:00Z"),
            )

    def test_indexes_exist(self, initialized_db: sqlite3.Connection):
        """Key indexes specified in DATABASE.md are present."""
        rows = initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' "
            "AND name LIKE 'idx_%' OR name LIKE 'uq_%'"
        ).fetchall()
        index_names = {row["name"] for row in rows}

        expected_indexes = [
            "idx_cases_status_updated",
            "idx_cases_created_by_updated",
            "idx_evidence_case_created",
            "idx_evidence_case_hash",
            "idx_evidence_case_parser_status",
            "idx_raw_records_provenance",
            "idx_events_timeline",
            "idx_events_user_timeline",
            "idx_events_provenance",
            "idx_sessions_timeline",
            "idx_session_events_reverse",
            "idx_event_entities_reverse",
            "idx_investigations_history",
            "idx_jobs_queue",
            "idx_claims_investigation",
            "idx_claim_evidence_reverse",
            "idx_verifications_claim",
            "idx_behaviour_case_technique",
            "idx_integrity_case_severity",
            "idx_audit_chain",
            "idx_reports_case_history",
            "uq_entities_case_type_value",
            "uq_claim_slots_name",
            "uq_audit_case_seq",
            "uq_audit_case_hash",
        ]

        for idx_name in expected_indexes:
            assert idx_name in index_names, f"Missing index: {idx_name}"

    def test_wal_journal_mode(self, initialized_db: sqlite3.Connection):
        """Journal mode is set to WAL."""
        row = initialized_db.execute("PRAGMA journal_mode").fetchone()
        assert row[0] == "wal"


# ---------------------------------------------------------------
# 8. Schema verification tests
# ---------------------------------------------------------------


class TestSchemaVerification:
    """Test the verify_schema function."""

    def test_valid_schema_passes(self, initialized_db: sqlite3.Connection):
        """verify_schema returns valid=True for a correct schema."""
        result = verify_schema(initialized_db)
        assert result["valid"] is True
        assert len(result["tables_missing"]) == 0
        assert len(result["fts_tables_missing"]) == 0
        assert result["foreign_keys_enabled"] is True
        assert result["journal_mode"] == "wal"
        assert result["schema_version"] >= SCHEMA_VERSION

    def test_schema_version_recorded(self, initialized_db: sqlite3.Connection):
        """Schema version in verification result matches SCHEMA_VERSION."""
        result = verify_schema(initialized_db)
        assert result["schema_version"] == SCHEMA_VERSION


# ---------------------------------------------------------------
# 9. Legal KB tests
# ---------------------------------------------------------------


class TestLegalKB:
    """Test the global legal knowledge base initialization."""

    def test_legal_kb_creates_tables(self, tmp_path: Path):
        """Legal KB database creates legal_provisions and legal_elements tables."""
        db_path = tmp_path / "legal" / "legal_kb.db"
        conn = initialize_legal_kb(db_path)
        try:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            table_names = {row["name"] for row in tables}
            assert "legal_provisions" in table_names
            assert "legal_elements" in table_names
        finally:
            conn.close()

    def test_legal_kb_foreign_keys(self, tmp_path: Path):
        """Legal KB enforces foreign keys between provisions and elements."""
        db_path = tmp_path / "legal" / "legal_kb.db"
        conn = initialize_legal_kb(db_path)
        try:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO legal_elements "
                    "(legal_element_id, legal_id, element_key, description, "
                    "requires_human_judgment, ordinal) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("EL_001", "NONEXISTENT_LAW", "mens_rea", "Intent", 1, 1),
                )
        finally:
            conn.close()

    def test_legal_kb_insert_and_query(self, tmp_path: Path):
        """Legal provisions and elements can be inserted and queried."""
        db_path = tmp_path / "legal" / "legal_kb.db"
        conn = initialize_legal_kb(db_path)
        try:
            conn.execute(
                "INSERT INTO legal_provisions "
                "(legal_id, act, section, title, text, status, version, "
                "source_uri, source_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "IT_ACT_66",
                    "Information Technology Act, 2000",
                    "66",
                    "Computer related offences",
                    "If any person, dishonestly or fraudulently...",
                    "IN_FORCE",
                    "1.0",
                    "https://indiacode.nic.in/handle/123456",
                    "abc" * 20 + "ab",
                    "2026-01-01T00:00:00Z",
                ),
            )
            conn.execute(
                "INSERT INTO legal_elements "
                "(legal_element_id, legal_id, element_key, description, "
                "requires_human_judgment, ordinal) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("EL_66_1", "IT_ACT_66", "dishonest_intent", "Dishonest or fraudulent intent", 1, 1),
            )
            conn.commit()

            row = conn.execute(
                "SELECT title FROM legal_provisions WHERE legal_id = 'IT_ACT_66'"
            ).fetchone()
            assert row["title"] == "Computer related offences"

            elements = conn.execute(
                "SELECT element_key FROM legal_elements WHERE legal_id = 'IT_ACT_66'"
            ).fetchall()
            assert len(elements) == 1
            assert elements[0]["element_key"] == "dishonest_intent"
        finally:
            conn.close()

    def test_legal_kb_check_constraints(self, tmp_path: Path):
        """Legal provision status CHECK constraint is enforced."""
        db_path = tmp_path / "legal" / "legal_kb.db"
        conn = initialize_legal_kb(db_path)
        try:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO legal_provisions "
                    "(legal_id, act, section, text, status, version, "
                    "source_uri, source_hash, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        "BAD_LAW",
                        "Test Act",
                        "1",
                        "text",
                        "INVALID_STATUS",
                        "1.0",
                        "uri",
                        "hash",
                        "2026-01-01T00:00:00Z",
                    ),
                )
        finally:
            conn.close()


# ---------------------------------------------------------------
# 10. Error handling tests
# ---------------------------------------------------------------


class TestErrorHandling:
    """Test error conditions are handled correctly."""

    def test_open_nonexistent_db_raises_error(self, tmp_path: Path):
        """Opening a non-existent database without create=True raises DatabaseError."""
        with pytest.raises(DatabaseError):
            open_case_db(tmp_path / "nonexistent" / "case.db")

    def test_get_case_db_path_structure(self, tmp_path: Path):
        """get_case_db_path returns the correct path structure."""
        path = get_case_db_path(tmp_path, "CASE_123")
        assert str(path).endswith(os.path.join("cases", "CASE_123", "case.db"))
