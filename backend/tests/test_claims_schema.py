"""
Unit and integration tests for ForensicLens Step 9 Phase B:
- Database Migration 003 (claim_verification schema rebuild)
- Read-only connection enforcement (PRAGMA query_only = ON)
- Typed Pydantic schemas for atomic claims and verification results
- Safe upgrade path from schema v2 to v3 with foreign key integrity
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
import pytest

from app.cases.database import (
    MigrationError,
    SCHEMA_VERSION,
    _apply_migration,
    _compute_migration_checksum,
    _split_sql_statements,
    _strip_sql_comments,
    close_case_db,
    get_case_db_path,
    initialize_case_db,
    open_case_db,
    open_case_db_readonly,
    run_migrations,
    verify_schema,
)
from app.verification.schemas import (
    Claim,
    ClaimExtractionRequest,
    ClaimExtractionResponse,
    ClaimListResponse,
    ClaimType,
    ClaimVerificationRequest,
    ClaimVerificationResponse,
    ClaimVerificationResult,
    EvidenceReference,
    EvidenceRole,
    ExtractionMethod,
    VerificationStatus,
)


@pytest.fixture
def tmp_case(tmp_path: Path):
    """Create an isolated test case with fully initialized v3 schema."""
    case_id = f"CASE_{uuid.uuid4().hex[:12].upper()}"
    db_path = get_case_db_path(tmp_path / "cases", case_id)
    conn = initialize_case_db(db_path, case_id, "Claims Schema Test Case")
    try:
        yield case_id, db_path, conn
    finally:
        close_case_db(conn)


class TestMigration003Fresh:
    """Test migration 003 application on a brand new case database."""

    def test_schema_version_is_current(self, tmp_case):
        case_id, db_path, conn = tmp_case
        assert SCHEMA_VERSION == 4
        schema_info = verify_schema(conn)
        assert schema_info["valid"] is True
        assert schema_info["schema_version"] == 4

    def test_claims_table_columns(self, tmp_case):
        _, _, conn = tmp_case
        cols = {
            row["name"]: row["type"]
            for row in conn.execute("PRAGMA table_info(claims)").fetchall()
        }
        expected = [
            "claim_id",
            "case_id",
            "investigation_id",
            "claim_type",
            "statement",
            "subject",
            "action",
            "object",
            "source_ip",
            "destination_ip",
            "source_port",
            "timestamp_claimed",
            "time_range_start",
            "time_range_end",
            "attributes_json",
            "model_output_json",
            "status",
            "extraction_method",
            "compiler_version",
            "confidence",
            "created_at",
        ]
        for col in expected:
            assert col in cols, f"Missing column in claims: {col}"

    def test_claim_evidence_table_columns(self, tmp_case):
        _, _, conn = tmp_case
        cols = {
            row["name"]: row["type"]
            for row in conn.execute("PRAGMA table_info(claim_evidence)").fetchall()
        }
        expected = [
            "claim_evidence_id",
            "claim_id",
            "evidence_id",
            "raw_record_id",
            "event_id",
            "role",
            "record_no",
            "line_number",
            "byte_start",
            "byte_end",
            "snippet",
            "created_at",
        ]
        for col in expected:
            assert col in cols, f"Missing column in claim_evidence: {col}"

    def test_claim_verifications_table_columns(self, tmp_case):
        _, _, conn = tmp_case
        cols = {
            row["name"]: row["type"]
            for row in conn.execute("PRAGMA table_info(claim_verifications)").fetchall()
        }
        expected = [
            "verification_id",
            "claim_id",
            "status",
            "rule_id",
            "rule_version",
            "predicate_type",
            "resolved_parameters_json",
            "matched_row_count",
            "evidence_refs_json",
            "supporting_records_json",
            "contradicting_records_json",
            "explanation",
            "failure_reason",
            "verifier_version",
            "verified_at",
        ]
        for col in expected:
            assert col in cols, f"Missing column in claim_verifications: {col}"

    def test_foreign_key_check_passes(self, tmp_case):
        _, _, conn = tmp_case
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        assert len(violations) == 0

    def test_append_only_triggers_created_by_migration(self, tmp_case):
        """Migration 003 must create append-only triggers on claim_verifications directly."""
        _, _, conn = tmp_case
        triggers = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'claim_verifications'"
        ).fetchall()
        trigger_names = {t["name"] for t in triggers}
        assert "trg_prevent_verification_update" in trigger_names
        assert "trg_prevent_verification_delete" in trigger_names


class TestMigrationUpgradeV2ToV3:
    """Test safe upgrading from schema v2 to v3 with pre-existing data."""

    def test_upgrade_migrates_existing_data(self, tmp_path: Path):
        case_id = "CASE_MIGRATION_V2_V3"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        # Open db and manually apply only migration 001 and 002
        conn = open_case_db(db_path, create=True)
        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001 = (migrations_dir / "001_initial.sql").read_text(encoding="utf-8")
        m002 = (migrations_dir / "002_raw_records_fts.sql").read_text(encoding="utf-8")

        from app.cases.database import _compute_migration_checksum

        conn.executescript(m001)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (1, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m001),),
        )
        conn.executescript(m002)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (2, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m002),),
        )

        # Insert case, evidence, event, investigation, claim, claim_evidence, verification in v1/v2 schema
        conn.execute(
            "INSERT INTO cases (case_id, name, status, created_at, updated_at, schema_version) VALUES (?, 'V2 Case', 'OPEN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_1', ?, 'hash1', 100, 'auth.log', 'OPENSSH', 'PARSED', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, message, event_type, source, parse_status, event_hash, created_at) "
            "VALUES ('EVT_1', ?, 'EV_1', 'Accepted password for root', 'AUTH_SUCCESS', 'OpenSSH', 'PARSED', 'evthash1', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO investigations (investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES ('INV_1', ?, 'Who logged in?', 'L2', 'ACTIVE', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{\"statement\": \"root login\"}', 'VERIFIED', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_1', 'SUPPORTING', '2026-01-01T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO claim_verifications (verification_id, claim_id, status, predicate_type, predicate_version, resolved_parameters_json, matched_row_count, evidence_refs_json, failure_reason, verified_at) "
            "VALUES ('VRF_1', 'CLM_1', 'VERIFIED', 'EXISTS', '1.0.0', '{}', 1, '[\"EVT_1\"]', NULL, '2026-01-01T00:00:00Z')"
        )
        conn.commit()

        # Run remaining migrations (003, 004)
        applied = run_migrations(conn)
        assert 3 in applied
        assert 4 in applied

        # Verify claims table upgraded
        clm = conn.execute("SELECT * FROM claims WHERE claim_id = 'CLM_1'").fetchone()
        assert clm is not None
        assert clm["case_id"] == case_id
        assert clm["status"] == "SUPPORTED"  # translated from VERIFIED
        assert clm["statement"] == '{"statement": "root login"}'
        assert clm["extraction_method"] == "LEGACY"

        # Verify claim_evidence upgraded
        ce = conn.execute("SELECT * FROM claim_evidence WHERE claim_id = 'CLM_1'").fetchone()
        assert ce is not None
        assert ce["evidence_id"] == "EV_1"
        assert ce["event_id"] == "EVT_1"
        assert ce["role"] == "SUPPORTING"

        # Verify claim_verifications upgraded
        cv = conn.execute("SELECT * FROM claim_verifications WHERE verification_id = 'VRF_1'").fetchone()
        assert cv is not None
        assert cv["status"] == "SUPPORTED"
        assert cv["rule_id"] == "EXISTS"

        # Check FK integrity
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        assert len(violations) == 0
        close_case_db(conn)


class TestMigrationLegacyDataPreservation:
    """
    Task B: Synthetic tests for comprehensive legacy data preservation.

    Verifies that all legacy claims, citations, and verifications survive migration 003+004
    with exact status mapping, unique citation IDs, accurate resolution to evidence_id,
    and documented defaults for new fields.
    """

    def test_all_legacy_data_survives_with_correct_mappings_and_defaults(self, tmp_path: Path):
        case_id = "CASE_PRESERVE_TEST"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = open_case_db(db_path, create=True)
        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001 = (migrations_dir / "001_initial.sql").read_text(encoding="utf-8")
        m002 = (migrations_dir / "002_raw_records_fts.sql").read_text(encoding="utf-8")

        conn.executescript(m001)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (1, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m001),),
        )
        conn.executescript(m002)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (2, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m002),),
        )

        # 1. Seed Case and Investigations
        conn.execute(
            "INSERT INTO cases (case_id, name, status, created_at, updated_at, schema_version) "
            "VALUES (?, 'Preserve Test Case', 'OPEN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO investigations (investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES ('INV_1', ?, 'Primary Investigation', 'L2', 'ACTIVE', '2026-01-01T00:00:00Z')",
            (case_id,),
        )

        # 2. Seed Evidence Files and Linked Events
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_AUTH', ?, 'hash_auth', 500, 'auth.log', 'OPENSSH', 'PARSED', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_SYSLOG', ?, 'hash_sys', 600, 'syslog.log', 'SYSLOG', 'PARSED', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, message, event_type, source, parse_status, event_hash, created_at) "
            "VALUES ('EVT_AUTH_1', ?, 'EV_AUTH', 'Accepted password for admin', 'AUTH_SUCCESS', 'OpenSSH', 'PARSED', 'h1', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, message, event_type, source, parse_status, event_hash, created_at) "
            "VALUES ('EVT_AUTH_2', ?, 'EV_SYSLOG', 'systemd session opened', 'SESSION_START', 'Syslog', 'PARSED', 'h2', '2026-01-01T00:00:00Z')",
            (case_id,),
        )

        # 3. Seed Claims with all legacy statuses
        claims_seed = [
            ("CLM_VERIFIED", "VERIFIED", "AUTH_SUCCESS", '{"assertion": "admin logged in"}', "0.8.0"),
            ("CLM_PROPOSED", "PROPOSED", "NETWORK_CONNECTION", '{"assertion": "port scan detected"}', "0.8.1"),
            ("CLM_UNVERIFIED", "UNVERIFIED", "SESSION_START", '{"assertion": "session started"}', "0.8.2"),
            ("CLM_CONTRADICTED", "CONTRADICTED", "AUTH_FAILURE", '{"assertion": "login failure"}', "0.8.3"),
            ("CLM_REJECTED", "REJECTED", "GENERIC_FORENSIC_EVENT", '{"assertion": "noise record"}', "0.8.4"),
        ]
        for cid, st, ct, mo, cv in claims_seed:
            conn.execute(
                "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, compiler_version, created_at) "
                "VALUES (?, ?, 'INV_1', ?, ?, ?, ?, '2026-01-01T00:00:00Z')",
                (cid, case_id, ct, mo, st, cv),
            )

        # 4. Seed Citations across different roles
        citations_seed = [
            ("CLM_VERIFIED", "EVT_AUTH_1", "SUPPORTING"),
            ("CLM_CONTRADICTED", "EVT_AUTH_1", "CONTRADICTING"),
            ("CLM_UNVERIFIED", "EVT_AUTH_2", "CONTEXT"),
        ]
        for cid, eid, role in citations_seed:
            conn.execute(
                "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')",
                (cid, eid, role),
            )

        # 5. Seed Verification History records with non-default legacy fields
        verifications_seed = [
            ("VRF_1", "CLM_VERIFIED", "VERIFIED", "EXISTS", "1.0.0", '{"src": "10.0.0.1"}', 5, '["EV_AUTH"]', None),
            ("VRF_2", "CLM_UNVERIFIED", "UNVERIFIED", "ATTRIBUTE_EQ", "2.1.0", '{"user": "guest"}', 0, '[]', "User mismatch"),
            ("VRF_3", "CLM_CONTRADICTED", "CONTRADICTED", "TIME_ORDER", "3.0.0", '{"window": "60s"}', 2, '["EV_SYSLOG"]', "Out of sequence"),
        ]
        for vid, cid, st, pt, pv, rp, mrc, er, fr in verifications_seed:
            conn.execute(
                "INSERT INTO claim_verifications (verification_id, claim_id, status, predicate_type, predicate_version, "
                "resolved_parameters_json, matched_row_count, evidence_refs_json, failure_reason, verified_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')",
                (vid, cid, st, pt, pv, rp, mrc, er, fr),
            )
        conn.commit()

        # Run migrations 003 and 004
        applied = run_migrations(conn)
        assert 3 in applied
        assert 4 in applied

        # --- Assertions on Claims ---
        claims_rows = {r["claim_id"]: r for r in conn.execute("SELECT * FROM claims").fetchall()}
        assert len(claims_rows) == 5, "All 5 legacy claims must survive"

        # Check status translations and defaults
        c_ver = claims_rows["CLM_VERIFIED"]
        assert c_ver["status"] == "SUPPORTED", "Legacy VERIFIED status must map to SUPPORTED"
        assert c_ver["statement"] == '{"assertion": "admin logged in"}', "statement must initialize from model_output_json"
        assert c_ver["action"] == "AUTH_SUCCESS", "action must default to claim_type"
        assert c_ver["extraction_method"] == "LEGACY"
        assert c_ver["compiler_version"] == "0.8.0"
        assert c_ver["attributes_json"] == "{}"
        assert c_ver["confidence"] is None, "confidence must be NULL from migration 004"

        assert claims_rows["CLM_PROPOSED"]["status"] == "PROPOSED"
        assert claims_rows["CLM_UNVERIFIED"]["status"] == "UNVERIFIED"
        assert claims_rows["CLM_CONTRADICTED"]["status"] == "CONTRADICTED"
        assert claims_rows["CLM_REJECTED"]["status"] == "REJECTED"

        # --- Assertions on Claim Evidence ---
        evidence_rows = conn.execute("SELECT * FROM claim_evidence").fetchall()
        assert len(evidence_rows) == 3, "All 3 legacy citations must survive"

        generated_ids = [r["claim_evidence_id"] for r in evidence_rows]
        assert len(set(generated_ids)) == 3, "Generated claim_evidence_id must be globally unique"

        # Verify correct evidence resolution via JOIN events
        ev_map = {r["claim_id"]: r for r in evidence_rows}
        assert ev_map["CLM_VERIFIED"]["evidence_id"] == "EV_AUTH"
        assert ev_map["CLM_VERIFIED"]["event_id"] == "EVT_AUTH_1"
        assert ev_map["CLM_VERIFIED"]["role"] == "SUPPORTING"
        assert ev_map["CLM_UNVERIFIED"]["evidence_id"] == "EV_SYSLOG"
        assert ev_map["CLM_UNVERIFIED"]["event_id"] == "EVT_AUTH_2"

        # --- Assertions on Claim Verifications ---
        vrf_rows = {r["verification_id"]: r for r in conn.execute("SELECT * FROM claim_verifications").fetchall()}
        assert len(vrf_rows) == 3, "All 3 legacy verification records must survive"

        v1 = vrf_rows["VRF_1"]
        assert v1["status"] == "SUPPORTED", "Verification status VERIFIED must map to SUPPORTED"
        assert v1["rule_id"] == "EXISTS", "rule_id must be populated from predicate_type"
        assert v1["rule_version"] == "1.0.0", "rule_version must be populated from predicate_version"
        assert v1["predicate_type"] == "EXISTS"
        assert v1["resolved_parameters_json"] == '{"src": "10.0.0.1"}'
        assert v1["matched_row_count"] == 5
        assert v1["evidence_refs_json"] == '["EV_AUTH"]'
        assert v1["verifier_version"] == "1.0.0", "verifier_version must default to 1.0.0"
        assert v1["supporting_records_json"] == "[]"
        assert v1["contradicting_records_json"] == "[]"

        v2 = vrf_rows["VRF_2"]
        assert v2["status"] == "UNVERIFIED"
        assert v2["rule_id"] == "ATTRIBUTE_EQ"
        assert v2["rule_version"] == "2.1.0"
        assert v2["failure_reason"] == "User mismatch"

        v3 = vrf_rows["VRF_3"]
        assert v3["status"] == "CONTRADICTED"
        assert v3["rule_id"] == "TIME_ORDER"
        assert v3["rule_version"] == "3.0.0"

        # --- Foreign Key Integrity ---
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        assert len(violations) == 0, "Foreign key integrity must be 100% clean"

        # --- Append-Only Trigger Verification ---
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("UPDATE claim_verifications SET status = 'CONTRADICTED' WHERE verification_id = 'VRF_1'")

        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            conn.execute("DELETE FROM claim_verifications WHERE verification_id = 'VRF_1'")

        close_case_db(conn)


class TestAtomicMigrationRollback:
    """
    Task C: Synthetic tests verifying complete atomic rollback on migration errors.
    """

    def test_rollback_on_foreign_key_violation_preserves_v2_schema_and_data(self, tmp_path: Path):
        """
        When a migration results in foreign-key violations, the transaction must roll back
        entirely: v2 tables must remain intact, schema_migrations must not record v3,
        conn.in_transaction must be False, and foreign keys must remain enabled.
        """
        case_id = "CASE_ROLLBACK_FK"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = open_case_db(db_path, create=True)
        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001 = (migrations_dir / "001_initial.sql").read_text(encoding="utf-8")
        m002 = (migrations_dir / "002_raw_records_fts.sql").read_text(encoding="utf-8")

        conn.executescript(m001)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (1, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m001),),
        )
        conn.executescript(m002)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (2, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m002),),
        )

        conn.execute(
            "INSERT INTO cases (case_id, name, status, created_at, updated_at, schema_version) "
            "VALUES (?, 'Rollback Case', 'OPEN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO investigations (investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES ('INV_1', ?, 'Query', 'L2', 'ACTIVE', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_VALID', ?, 'INV_1', 'AUTH_SUCCESS', '{\"statement\": \"valid\"}', 'VERIFIED', '2026-01-01T00:00:00Z')",
            (case_id,),
        )
        conn.commit()

        # Commit existing transaction first, then disable FKs to inject an invalid foreign key in claim_verifications
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute(
            "INSERT INTO claim_verifications (verification_id, claim_id, status, predicate_type, predicate_version, "
            "resolved_parameters_json, matched_row_count, evidence_refs_json, verified_at) "
            "VALUES ('VRF_ORPHAN', 'CLM_NONEXISTENT_GHOST', 'VERIFIED', 'EXISTS', '1.0.0', '{}', 1, '[]', '2026-01-01T00:00:00Z')"
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON")

        # Confirm that before migration 003, claims table has v2 schema (no statement, no action columns)
        v2_cols = [r["name"] for r in conn.execute("PRAGMA table_info(claims)").fetchall()]
        assert "statement" not in v2_cols
        assert "action" not in v2_cols

        # Attempt to run migration 003 -> Must fail due to foreign key violation on VRF_ORPHAN
        with pytest.raises(MigrationError) as exc_info:
            run_migrations(conn)

        assert "foreign key constraint violations" in str(exc_info.value)

        # Invariant 1: schema_migrations must not contain version 3
        applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
        assert 3 not in applied
        assert 4 not in applied
        assert applied == [1, 2]

        # Invariant 2: Original v2 table structures and data remain 100% intact
        cols_after = [r["name"] for r in conn.execute("PRAGMA table_info(claims)").fetchall()]
        assert "statement" not in cols_after
        assert "action" not in cols_after
        assert cols_after == v2_cols

        # Invariant 3: Original data is untouched
        row = conn.execute("SELECT * FROM claims WHERE claim_id = 'CLM_VALID'").fetchone()
        assert row is not None
        assert row["status"] == "VERIFIED"

        # Invariant 4: conn.in_transaction is False
        assert conn.in_transaction is False

        # Invariant 5: Foreign key enforcement is restored
        fk_setting = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        assert fk_setting == 1

        # Invariant 6: Database can still be queried normally
        count = conn.execute("SELECT COUNT(*) FROM claims").fetchone()[0]
        assert count == 1

        close_case_db(conn)

    def test_rejection_when_transaction_already_active(self, tmp_path: Path):
        """_apply_migration must immediately reject execution if conn.in_transaction is True."""
        case_id = "CASE_IN_TX"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = open_case_db(db_path, create=True)
        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001_path = migrations_dir / "001_initial.sql"

        # Open an uncommitted transaction
        conn.execute("BEGIN IMMEDIATE")
        assert conn.in_transaction is True

        with pytest.raises(MigrationError, match="already inside an active transaction"):
            _apply_migration(conn, 1, m001_path)

        conn.rollback()
        close_case_db(conn)

    def test_rollback_on_midway_statement_failure(self, tmp_path: Path):
        """
        When a migration fails on statement N, all statements 1 through N-1 must roll back cleanly,
        leaving zero partial tables or schema remnants.
        """
        case_id = "CASE_MIDWAY_FAIL"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = open_case_db(db_path, create=True)

        # Create a synthetic migration script where statement 1 creates a table and statement 2 has invalid SQL syntax
        synthetic_sql = (
            "CREATE TABLE temp_canary_probe (id INT PRIMARY KEY, name TEXT);\n"
            "INSERT INTO temp_canary_probe VALUES (1, 'canary');\n"
            "THIS IS INTENTIONALLY INVALID SQL SYNTAX TO FORCE MIDWAY FAILURE;\n"
        )
        fake_migration_file = tmp_path / "099_faulty_migration.sql"
        fake_migration_file.write_text(synthetic_sql, encoding="utf-8")

        with pytest.raises(MigrationError, match="Migration 099 failed"):
            _apply_migration(conn, 99, fake_migration_file)

        # Verify canary table does NOT exist in the database (rolled back)
        canary = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temp_canary_probe'"
        ).fetchone()
        assert canary is None, "Earlier DDL statements must be rolled back completely on midway failure"

        # Verify transaction state and foreign keys
        assert conn.in_transaction is False
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1

        close_case_db(conn)

    def test_failure_to_disable_foreign_keys_handled_safely(self, tmp_path: Path):
        """
        Failure to disable foreign keys prior to a transaction must be handled safely,
        raising a clear MigrationError and ensuring cleanup.
        """
        case_id = "CASE_FK_OFF_FAIL"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        raw_conn = open_case_db(db_path, create=True)

        synthetic_sql = "PRAGMA foreign_keys = OFF;\nCREATE TABLE temp_table (id INT PRIMARY KEY);\n"
        fake_migration_file = tmp_path / "098_fk_off_migration.sql"
        fake_migration_file.write_text(synthetic_sql, encoding="utf-8")

        class FailingProxy:
            def __init__(self, target):
                self._target = target

            def execute(self, sql, *args, **kwargs):
                if isinstance(sql, str) and "PRAGMA foreign_keys = OFF" in sql:
                    raise sqlite3.OperationalError("Simulated failure disabling foreign keys")
                return self._target.execute(sql, *args, **kwargs)

            def __getattr__(self, attr):
                return getattr(self._target, attr)

        proxy = FailingProxy(raw_conn)

        with pytest.raises(MigrationError, match="Failed to disable foreign keys before migration 098"):
            _apply_migration(proxy, 98, fake_migration_file)

        # Invariants: no open transaction, foreign keys restored to ON
        assert raw_conn.in_transaction is False
        assert raw_conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1

        close_case_db(raw_conn)

    def test_restoration_failure_does_not_mask_primary_migration_error(self, tmp_path: Path):
        """
        A foreign-key restoration failure in finally must NOT silently replace or discard
        the original migration exception. The original migration exception must remain primary
        with the restoration failure available in context.
        """
        case_id = "CASE_CHAINED_EXC"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        raw_conn = open_case_db(db_path, create=True)

        synthetic_sql = (
            "CREATE TABLE temp_canary_probe2 (id INT PRIMARY KEY);\n"
            "THIS IS INTENTIONALLY INVALID SQL SYNTAX TO FORCE PRIMARY FAILURE;\n"
        )
        fake_migration_file = tmp_path / "097_faulty_migration.sql"
        fake_migration_file.write_text(synthetic_sql, encoding="utf-8")

        class FailingRestoreProxy:
            def __init__(self, target):
                self._target = target

            def execute(self, sql, *args, **kwargs):
                if isinstance(sql, str) and "PRAGMA foreign_keys = ON" in sql:
                    raise sqlite3.OperationalError("Simulated disk error during PRAGMA foreign_keys = ON")
                return self._target.execute(sql, *args, **kwargs)

            def __getattr__(self, attr):
                return getattr(self._target, attr)

        proxy = FailingRestoreProxy(raw_conn)

        with pytest.raises(MigrationError) as exc_info:
            _apply_migration(proxy, 97, fake_migration_file)

        # Primary exception must be the migration failure, not the restoration failure
        assert "Migration 097 failed" in str(exc_info.value)
        # The restoration failure must not be silently swallowed; it is attached in context
        assert exc_info.value.__context__ is not None
        assert "Simulated disk error during PRAGMA foreign_keys = ON" in str(exc_info.value.__context__)

        # Transaction was rolled back
        assert raw_conn.in_transaction is False
        canary = raw_conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temp_canary_probe2'"
        ).fetchone()
        assert canary is None

        close_case_db(raw_conn)

    def test_restoration_failure_on_successful_migration_raises_error(self, tmp_path: Path):
        """
        When migration statements succeed but foreign-key enforcement cannot be restored,
        a clear MigrationError must be raised indicating restoration failure.
        """
        case_id = "CASE_RESTORE_FAIL_SUCCESS"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        raw_conn = open_case_db(db_path, create=True)
        raw_conn.execute(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"
        )
        raw_conn.commit()

        synthetic_sql = "CREATE TABLE temp_restore_ok (id INT PRIMARY KEY);\n"
        fake_migration_file = tmp_path / "096_valid_migration.sql"
        fake_migration_file.write_text(synthetic_sql, encoding="utf-8")

        class FailingRestoreProxy:
            def __init__(self, target):
                self._target = target

            def execute(self, sql, *args, **kwargs):
                if isinstance(sql, str) and "PRAGMA foreign_keys = ON" in sql:
                    raise sqlite3.OperationalError("Simulated restoration failure")
                return self._target.execute(sql, *args, **kwargs)

            def __getattr__(self, attr):
                return getattr(self._target, attr)

        proxy = FailingRestoreProxy(raw_conn)

        with pytest.raises(MigrationError, match="Failed to restore foreign key enforcement after migration 096"):
            _apply_migration(proxy, 96, fake_migration_file)

        close_case_db(raw_conn)


class TestSQLCommentScanner:
    """Test quote-aware SQL comment stripping (_strip_sql_comments)."""

    def test_single_quoted_literals_preserve_comment_characters(self):
        sql = "SELECT 'hello -- world' FROM t;"
        assert _strip_sql_comments(sql) == "SELECT 'hello -- world' FROM t;"

        sql_block = "SELECT 'hello /* block comment */ world' FROM t;"
        assert _strip_sql_comments(sql_block) == "SELECT 'hello /* block comment */ world' FROM t;"

    def test_escaped_single_quotes_preserve_comment_characters(self):
        sql = "SELECT 'O''Reilly -- author of books' FROM t;"
        assert _strip_sql_comments(sql) == "SELECT 'O''Reilly -- author of books' FROM t;"

        sql2 = "SELECT 'O''Reilly /* block */ book' FROM t;"
        assert _strip_sql_comments(sql2) == "SELECT 'O''Reilly /* block */ book' FROM t;"

    def test_double_quoted_identifiers_preserve_comment_characters(self):
        sql = 'SELECT "col--name", "col/*block*/name" FROM "my--table";'
        assert _strip_sql_comments(sql) == 'SELECT "col--name", "col/*block*/name" FROM "my--table";'

    def test_backtick_quoted_identifiers_preserve_comment_characters(self):
        sql = "SELECT `col--name`, `col/*block*/name` FROM `my--table`;"
        assert _strip_sql_comments(sql) == "SELECT `col--name`, `col/*block*/name` FROM `my--table`;"

    def test_bracket_quoted_identifiers_preserve_comment_characters(self):
        sql = "SELECT [col--name], [col/*block*/name] FROM [my--table];"
        assert _strip_sql_comments(sql) == "SELECT [col--name], [col/*block*/name] FROM [my--table];"

    def test_line_and_block_comments_are_stripped(self):
        sql = "-- initial line comment\nSELECT 1; -- trailing line comment\n/* block comment */"
        stripped = _strip_sql_comments(sql)
        assert stripped == "SELECT 1;"

    def test_block_comment_replaced_with_space_prevents_token_merging(self):
        sql = "SELECT/*comment*/1;"
        stripped = _strip_sql_comments(sql)
        assert stripped == "SELECT 1;"


class TestSQLStatementSplitter:
    """Test statement splitting with complete_statement and quote/comment awareness."""

    def test_two_statements_on_same_line(self):
        sql = "SELECT 1; SELECT 2;"
        stmts = _split_sql_statements(sql)
        assert len(stmts) == 2
        assert stmts[0].strip() == "SELECT 1;"
        assert stmts[1].strip() == "SELECT 2;"

    def test_multiline_trigger_with_two_statements_in_body(self):
        trigger_sql = """CREATE TRIGGER trg_multi_stmt
AFTER INSERT ON t
BEGIN
    INSERT INTO audit_log (action) VALUES ('inserted');
    UPDATE stats SET total = total + 1 WHERE id = 1;
END;
SELECT 42;"""
        stmts = _split_sql_statements(trigger_sql)
        assert len(stmts) == 2
        assert "CREATE TRIGGER trg_multi_stmt" in stmts[0]
        assert "INSERT INTO audit_log" in stmts[0]
        assert "UPDATE stats SET total" in stmts[0]
        assert "END;" in stmts[0]
        assert stmts[1].strip() == "SELECT 42;"

    def test_trigger_containing_case_expression(self):
        trigger_sql = """CREATE TRIGGER trg_case_expr
AFTER UPDATE ON t
BEGIN
    UPDATE t SET label = CASE WHEN NEW.val > 10 THEN 'high' ELSE 'low' END WHERE id = NEW.id;
END;"""
        stmts = _split_sql_statements(trigger_sql)
        assert len(stmts) == 1
        assert "CASE WHEN NEW.val > 10 THEN 'high' ELSE 'low' END" in stmts[0]
        assert "END;" in stmts[0]

    def test_trigger_containing_quoted_string_with_semicolons(self):
        trigger_sql = """CREATE TRIGGER trg_quoted_semis
BEFORE UPDATE ON t
BEGIN
    SELECT RAISE(FAIL, 'cannot update; internal semicolon; in quote');
END;"""
        stmts = _split_sql_statements(trigger_sql)
        assert len(stmts) == 1
        assert "cannot update; internal semicolon; in quote" in stmts[0]

    def test_trigger_execution_against_sqlite_database(self):
        """Execute resulting trigger SQL against SQLite and verify functional behavior."""
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val INTEGER, label TEXT);")
        conn.execute("CREATE TABLE audit_log (action TEXT);")
        conn.execute("CREATE TABLE stats (id INTEGER PRIMARY KEY, total INTEGER);")
        conn.execute("INSERT INTO stats VALUES (1, 0);")

        script = """
CREATE TRIGGER trg_multi_audit
AFTER INSERT ON t
BEGIN
    INSERT INTO audit_log (action) VALUES ('inserted');
    UPDATE stats SET total = total + 1 WHERE id = 1;
END;

CREATE TRIGGER trg_case_label
AFTER UPDATE ON t
BEGIN
    UPDATE t SET label = CASE WHEN NEW.val >= 100 THEN 'LARGE' ELSE 'SMALL' END WHERE id = NEW.id;
END;
"""
        statements = _split_sql_statements(script)
        assert len(statements) == 2
        for s in statements:
            conn.execute(s)

        # Test trigger 1: multi-statement body
        conn.execute("INSERT INTO t (id, val, label) VALUES (1, 5, 'none');")
        assert conn.execute("SELECT total FROM stats WHERE id = 1").fetchone()[0] == 1
        assert conn.execute("SELECT action FROM audit_log").fetchone()[0] == "inserted"

        # Test trigger 2: CASE expression
        conn.execute("UPDATE t SET val = 200 WHERE id = 1;")
        assert conn.execute("SELECT label FROM t WHERE id = 1").fetchone()[0] == "LARGE"

        conn.execute("UPDATE t SET val = 50 WHERE id = 1;")
        assert conn.execute("SELECT label FROM t WHERE id = 1").fetchone()[0] == "SMALL"
        conn.close()

    def test_semicolons_inside_quoted_strings(self):
        sql = "INSERT INTO test_tbl (data) VALUES ('semicolon; inside string; here'); SELECT 1;"
        stmts = _split_sql_statements(sql)
        assert len(stmts) == 2
        assert "INSERT INTO test_tbl" in stmts[0]
        assert "'semicolon; inside string; here'" in stmts[0]
        assert stmts[1].strip() == "SELECT 1;"

    def test_comments_between_statements(self):
        sql = """
CREATE TABLE a (id INT);
-- Comment describing table b; with semicolon inside comment
CREATE TABLE b (id INT);
"""
        stmts = _split_sql_statements(sql)
        assert len(stmts) == 2
        assert "CREATE TABLE a" in stmts[0]
        assert "CREATE TABLE b" in stmts[1]

    def test_trailing_comments_without_final_sql_statements(self):
        sql = """
CREATE TABLE a (id INT);
-- Trailing line comment 1
-- Trailing line comment with semicolon; inside
/* Trailing block comment with semicolon; inside */
"""
        stmts = _split_sql_statements(sql)
        assert len(stmts) == 1
        assert "CREATE TABLE a" in stmts[0]

    def test_empty_or_pure_comment_input_yields_empty_list(self):
        assert _split_sql_statements("") == []
        assert _split_sql_statements("   -- only comment\n/* only block */  ") == []

    def test_incomplete_trigger_input_rejected(self):
        """Incomplete triggers must raise ValueError rather than returning broken fragments."""
        incomplete_sql = "CREATE TRIGGER trg_broken BEGIN SELECT 1;"
        with pytest.raises(ValueError, match="Incomplete or malformed SQL"):
            _split_sql_statements(incomplete_sql)

    def test_unclosed_quotes_and_comments_rejected(self):
        """Unclosed quotes and comments must raise ValueError."""
        with pytest.raises(ValueError, match="unclosed single-quoted"):
            _split_sql_statements("SELECT 'unclosed string;")

        with pytest.raises(ValueError, match="unclosed double-quoted"):
            _split_sql_statements('SELECT "unclosed identifier;')

        with pytest.raises(ValueError, match="unclosed block comment"):
            _split_sql_statements("/* unclosed comment")

    def test_backslash_not_treated_as_escape_following_sqlite_rules(self):
        """SQLite does not treat backslash as an escape in standard SQL literals."""
        sql = r"SELECT 'C:\Users\', 42;"
        stmts = _split_sql_statements(sql)
        assert len(stmts) == 1
        assert "42" in stmts[0]


class TestLegacyEvidenceValidationAndPreservation:
    """
    Test Step 9 migration 003 legacy citation validation and collision-safe preservation.
    """

    def _setup_v2_database(self, tmp_path: Path, case_id: str):
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = open_case_db(db_path, create=True)

        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001 = (migrations_dir / "001_initial.sql").read_text(encoding="utf-8")
        m002 = (migrations_dir / "002_raw_records_fts.sql").read_text(encoding="utf-8")

        conn.executescript(m001)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (1, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m001),),
        )
        conn.executescript(m002)
        conn.execute(
            "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (2, ?, '2026-01-01T00:00:00Z')",
            (_compute_migration_checksum(m002),),
        )

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO cases (case_id, name, status, created_at, updated_at, schema_version) "
            "VALUES (?, 'Validation Test Case', 'OPEN', ?, ?, 2)",
            (case_id, now, now),
        )
        conn.execute(
            "INSERT INTO investigations (investigation_id, case_id, query_text, privacy_level, status, created_at) "
            "VALUES ('INV_1', ?, 'Test query', 'L2', 'ACTIVE', ?)",
            (case_id, now),
        )
        conn.commit()
        return conn

    def test_validation_aborts_on_orphaned_event(self, tmp_path: Path):
        """Migration must abort and roll back if legacy claim_evidence references a non-existent event."""
        case_id = "CASE_VAL_ORPHAN"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_NONEXISTENT_GHOST', 'SUPPORTING', ?)",
            (now,),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON;")

        with pytest.raises(MigrationError) as exc_info:
            run_migrations(conn)

        assert "legacy claim_evidence references non-existent event" in str(exc_info.value)

        # Invariants: 003 not applied, rollback intact, FKs restored
        applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
        assert 3 not in applied
        assert conn.in_transaction is False
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        close_case_db(conn)

    def test_validation_aborts_on_referenced_event_with_null_or_empty_evidence_id(self, tmp_path: Path):
        """Migration must abort and roll back if referenced event has NULL or empty evidence_id."""
        case_id = "CASE_VAL_NULL_EVID"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('EVT_NULL_EV', ?, '', 'PARSED', 'hash1', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_NULL_EV', 'SUPPORTING', ?)",
            (now,),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON;")

        with pytest.raises(MigrationError) as exc_info:
            run_migrations(conn)

        assert "referenced event has null or empty evidence_id" in str(exc_info.value)
        applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
        assert 3 not in applied
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        close_case_db(conn)

    def test_validation_aborts_on_missing_evidence_file(self, tmp_path: Path):
        """Migration must abort and roll back if referenced event points to non-existent evidence_files row."""
        case_id = "CASE_VAL_MISSING_EF"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('EVT_1', ?, 'EV_GHOST_FILE', 'PARSED', 'hash1', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_1', 'SUPPORTING', ?)",
            (now,),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON;")

        with pytest.raises(MigrationError) as exc_info:
            run_migrations(conn)

        assert "referenced evidence file does not exist in evidence_files" in str(exc_info.value)
        applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
        assert 3 not in applied
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        close_case_db(conn)

    def test_validation_aborts_on_cross_case_evidence_file(self, tmp_path: Path):
        """Migration must abort and roll back if evidence file belongs to a different case than the claim."""
        case_id = "CASE_VAL_CROSS"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO cases (case_id, name, status, created_at, updated_at, schema_version) "
            "VALUES ('CASE_OTHER', 'Other Case', 'OPEN', ?, ?, 2)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        # Evidence file belongs to CASE_OTHER
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_OTHER', 'CASE_OTHER', 'hash_other', 500, 'auth.log', 'OPENSSH', 'PARSED', ?)",
            (now,),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('EVT_1', 'CASE_OTHER', 'EV_OTHER', 'PARSED', 'hash1', ?)",
            (now,),
        )
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_1', 'SUPPORTING', ?)",
            (now,),
        )
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON;")

        with pytest.raises(MigrationError) as exc_info:
            run_migrations(conn)

        assert "evidence file or event does not belong to the same case as the claim" in str(exc_info.value)
        applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()]
        assert 3 not in applied
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        close_case_db(conn)

    def test_citation_id_collision_safety_with_underscores(self, tmp_path: Path):
        """
        Verify that citations whose (claim_id, event_id) would collide under naive underscore concatenation
        (e.g. ('CLM_1', 'EVT_2') vs ('CLM', '1_EVT_2')) receive collision-safe deterministic primary keys
        and are preserved without loss.
        """
        case_id = "CASE_COLLISION_SAFE"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_1', ?, 'hash1', 500, 'auth.log', 'OPENSSH', 'PARSED', ?)",
            (case_id, now),
        )

        # Seed claims with underscores
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )

        # Seed events with underscores
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('EVT_2', ?, 'EV_1', 'PARSED', 'hash1', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('1_EVT_2', ?, 'EV_1', 'PARSED', 'hash2', ?)",
            (case_id, now),
        )

        # Seed constructed collision case under naive concatenation 'CLM_1_EVT_2_SUPPORTING':
        # Citation 1: CLM_1 + EVT_2 + SUPPORTING
        # Citation 2: CLM + 1_EVT_2 + SUPPORTING
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM_1', 'EVT_2', 'SUPPORTING', ?)",
            (now,),
        )
        conn.execute(
            "INSERT INTO claim_evidence (claim_id, event_id, role, created_at) "
            "VALUES ('CLM', '1_EVT_2', 'SUPPORTING', ?)",
            (now,),
        )
        conn.commit()

        # Run migration 003
        applied = run_migrations(conn)
        assert 3 in applied

        # Assert BOTH citations survived in claim_evidence
        rows = conn.execute("SELECT * FROM claim_evidence ORDER BY claim_id").fetchall()
        assert len(rows) == 2, "Both citation rows must survive without collision or deduplication"

        id1 = rows[0]["claim_evidence_id"]
        id2 = rows[1]["claim_evidence_id"]
        assert id1 != id2, "Generated IDs must be strictly unique"

        # Verify preservation of all citation fields exactly
        r_clm = [r for r in rows if r["claim_id"] == "CLM"][0]
        assert r_clm["event_id"] == "1_EVT_2"
        assert r_clm["role"] == "SUPPORTING"
        assert r_clm["evidence_id"] == "EV_1"
        assert r_clm["created_at"] == now

        r_clm1 = [r for r in rows if r["claim_id"] == "CLM_1"][0]
        assert r_clm1["event_id"] == "EVT_2"
        assert r_clm1["role"] == "SUPPORTING"
        assert r_clm1["evidence_id"] == "EV_1"
        assert r_clm1["created_at"] == now

        close_case_db(conn)

    def test_multiple_citations_same_claim_and_event_different_roles(self, tmp_path: Path):
        """Multiple citations for the same claim and event with different roles must each receive unique IDs."""
        case_id = "CASE_MULTI_ROLES"
        conn = self._setup_v2_database(tmp_path, case_id)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO evidence_files (evidence_id, case_id, object_hash, object_size_bytes, original_name, format, parser_status, created_at) "
            "VALUES ('EV_1', ?, 'hash1', 500, 'auth.log', 'OPENSSH', 'PARSED', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO claims (claim_id, case_id, investigation_id, claim_type, model_output_json, status, created_at) "
            "VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', ?)",
            (case_id, now),
        )
        conn.execute(
            "INSERT INTO events (event_id, case_id, evidence_id, parse_status, event_hash, created_at) "
            "VALUES ('EVT_1', ?, 'EV_1', 'PARSED', 'hash1', ?)",
            (case_id, now),
        )

        # Seed two citations for the same claim and event with different roles
        conn.execute("INSERT INTO claim_evidence VALUES ('CLM_1', 'EVT_1', 'SUPPORTING', ?)", (now,))
        conn.execute("INSERT INTO claim_evidence VALUES ('CLM_1', 'EVT_1', 'CONTEXT', ?)", (now,))
        conn.commit()

        applied = run_migrations(conn)
        assert 3 in applied

        rows = conn.execute("SELECT * FROM claim_evidence").fetchall()
        assert len(rows) == 2
        ids = {r["claim_evidence_id"] for r in rows}
        assert len(ids) == 2, "Both citations must receive unique primary keys"
        roles = {r["role"] for r in rows}
        assert roles == {"SUPPORTING", "CONTEXT"}

        close_case_db(conn)


class TestLegacyVerificationCompatibilityMapping:
    """
    Test Step 9 migration 003 legacy verification compatibility mappings:
    - predicate_type -> rule_id
    - predicate_version -> rule_version
    - predicate_type -> predicate_type
    - Legacy VERIFIED -> SUPPORTED
    - Exact preservation of verification_id, claim_id, resolved_parameters_json,
      matched_row_count, evidence_refs_json, failure_reason, verified_at.
    """

    def test_exact_verification_field_mapping_and_preservation(self, tmp_path: Path):
        case_id = "CASE_VERIF_MAPPING"
        db_path = get_case_db_path(tmp_path / "cases", case_id)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = open_case_db(db_path, create=True)

        migrations_dir = Path(__file__).resolve().parent.parent / "migrations"
        m001 = (migrations_dir / "001_initial.sql").read_text(encoding="utf-8")
        m002 = (migrations_dir / "002_raw_records_fts.sql").read_text(encoding="utf-8")

        conn.executescript(m001)
        conn.execute("INSERT INTO schema_migrations VALUES (1, ?, '2026-01-01T00:00:00Z')", (_compute_migration_checksum(m001),))
        conn.executescript(m002)
        conn.execute("INSERT INTO schema_migrations VALUES (2, ?, '2026-01-01T00:00:00Z')", (_compute_migration_checksum(m002),))

        now = "2026-03-29T10:00:00Z"
        conn.execute("INSERT INTO cases VALUES (?, 'Mapping Case', NULL, 'OPEN', ?, ?, NULL, 2)", (case_id, now, now))
        conn.execute("INSERT INTO investigations VALUES ('INV_1', ?, 'q', NULL, NULL, 'L2', 'ACTIVE', ?, NULL)", (case_id, now))
        conn.execute("INSERT INTO claims VALUES ('CLM_1', ?, 'INV_1', 'AUTH_SUCCESS', '{}', 'VERIFIED', NULL, ?)", (case_id, now))
        conn.execute("INSERT INTO claims VALUES ('CLM_2', ?, 'INV_1', 'NETWORK_FLOW', '{}', 'UNVERIFIED', NULL, ?)", (case_id, now))

        # Seed verification with all distinct legacy fields (using valid legacy predicate_type values per migration 001 check constraint)
        conn.execute(
            "INSERT INTO claim_verifications (verification_id, claim_id, status, predicate_type, predicate_version, "
            "resolved_parameters_json, matched_row_count, evidence_refs_json, failure_reason, verified_at) "
            "VALUES ('VRF_MAP_1', 'CLM_1', 'VERIFIED', 'EXISTS', '2.5.0', "
            "'{\"user\": \"root\", \"ip\": \"192.168.1.1\"}', 3, '[\"EV_1\", \"EV_2\"]', NULL, ?)",
            (now,),
        )
        conn.execute(
            "INSERT INTO claim_verifications (verification_id, claim_id, status, predicate_type, predicate_version, "
            "resolved_parameters_json, matched_row_count, evidence_refs_json, failure_reason, verified_at) "
            "VALUES ('VRF_MAP_2', 'CLM_2', 'UNVERIFIED', 'ATTRIBUTE_EQ', '1.1.0', "
            "'{}', 0, '[]', 'No matching packet found', ?)",
            (now,),
        )
        conn.commit()

        applied = run_migrations(conn)
        assert 3 in applied

        v1 = conn.execute("SELECT * FROM claim_verifications WHERE verification_id = 'VRF_MAP_1'").fetchone()
        assert v1 is not None
        # Rule & predicate mappings
        assert v1["rule_id"] == "EXISTS", "predicate_type must map to rule_id"
        assert v1["rule_version"] == "2.5.0", "predicate_version must map to rule_version"
        assert v1["predicate_type"] == "EXISTS", "predicate_type must be preserved as predicate_type"
        # Status mapping
        assert v1["status"] == "SUPPORTED", "Legacy VERIFIED status must map to SUPPORTED"
        # Preserved fields
        assert v1["verification_id"] == "VRF_MAP_1"
        assert v1["claim_id"] == "CLM_1"
        assert v1["resolved_parameters_json"] == '{"user": "root", "ip": "192.168.1.1"}'
        assert v1["matched_row_count"] == 3
        assert v1["evidence_refs_json"] == '["EV_1", "EV_2"]'
        assert v1["failure_reason"] is None
        assert v1["verified_at"] == now
        # Default Step 9 verification metadata
        assert v1["verifier_version"] == "1.0.0"
        assert v1["supporting_records_json"] == "[]"
        assert v1["contradicting_records_json"] == "[]"
        assert v1["explanation"] is None

        v2 = conn.execute("SELECT * FROM claim_verifications WHERE verification_id = 'VRF_MAP_2'").fetchone()
        assert v2["status"] == "UNVERIFIED"
        assert v2["rule_id"] == "ATTRIBUTE_EQ"
        assert v2["rule_version"] == "1.1.0"
        assert v2["failure_reason"] == "No matching packet found"

        close_case_db(conn)


class TestReadOnlyConnection:
    """Test read-only database connections (PRAGMA query_only = ON)."""

    def test_readonly_allows_select(self, tmp_case):
        case_id, db_path, _ = tmp_case
        ro_conn = open_case_db_readonly(db_path)
        try:
            row = ro_conn.execute("SELECT COUNT(*) FROM cases").fetchone()
            assert row[0] >= 1
        finally:
            close_case_db(ro_conn)

    def test_readonly_blocks_insert(self, tmp_case):
        case_id, db_path, _ = tmp_case
        ro_conn = open_case_db_readonly(db_path)
        try:
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute(
                    "INSERT INTO investigations (investigation_id, case_id, query_text, privacy_level, status, created_at) "
                    "VALUES ('INV_FAIL', ?, 'illegal insert', 'L2', 'ACTIVE', '2026-01-01T00:00:00Z')",
                    (case_id,),
                )
        finally:
            close_case_db(ro_conn)

    def test_readonly_blocks_update(self, tmp_case):
        case_id, db_path, _ = tmp_case
        ro_conn = open_case_db_readonly(db_path)
        try:
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute("UPDATE cases SET name = 'Mutated' WHERE case_id = ?", (case_id,))
        finally:
            close_case_db(ro_conn)


class TestPydanticSchemas:
    """Test Pydantic schema validation, constraints, and serialization."""

    def test_evidence_reference_valid(self):
        ref = EvidenceReference(
            evidence_id="EV_123",
            raw_record_id="REC_456",
            event_id="EVT_789",
            role=EvidenceRole.PRIMARY_CITING,
            line_number=42,
            snippet="Accepted publickey for ubuntu",
        )
        assert ref.evidence_id == "EV_123"
        assert ref.raw_record_id == "REC_456"
        assert ref.event_id == "EVT_789"
        assert ref.role == EvidenceRole.PRIMARY_CITING

    def test_evidence_reference_requires_grounding(self):
        with pytest.raises(ValueError, match="at least one of"):
            EvidenceReference(
                evidence_id="EV_123",
                role=EvidenceRole.PRIMARY_CITING,
            )

    def test_claim_schema_full_serialization(self):
        claim = Claim(
            claim_id="CLM_001",
            case_id="CASE_001",
            claim_type=ClaimType.AUTH_SUCCESS,
            statement="User root authenticated successfully via SSH from 192.168.1.100 on port 22",
            subject="root",
            action="LOGIN_SUCCESS",
            object="ssh2",
            source_ip="192.168.1.100",
            source_port=22,
            timestamp_claimed="2026-03-29T06:12:35Z",
            extraction_method=ExtractionMethod.DETERMINISTIC_FAKE,
            confidence=0.98,
            evidence_references=[
                EvidenceReference(
                    evidence_id="EV_100",
                    raw_record_id="RAW_100",
                    role=EvidenceRole.PRIMARY_CITING,
                    line_number=10,
                )
            ],
            current_status=VerificationStatus.UNVERIFIED,
            created_at="2026-03-29T06:15:00Z",
        )

        data = claim.model_dump(by_alias=True)
        assert data["claimId"] == "CLM_001"
        assert data["caseId"] == "CASE_001"
        assert data["claimType"] == "AUTH_SUCCESS"
        assert data["sourceIp"] == "192.168.1.100"
        assert data["currentStatus"] == "UNVERIFIED"
        assert len(data["evidenceReferences"]) == 1
        assert data["evidenceReferences"][0]["evidenceId"] == "EV_100"

        # Roundtrip JSON
        json_str = claim.model_dump_json(by_alias=True)
        deserialized = Claim.model_validate_json(json_str)
        assert deserialized.claim_id == claim.claim_id
        assert deserialized.source_ip == claim.source_ip

    def test_verification_result_schema(self):
        res = ClaimVerificationResult(
            verification_id="VRF_001",
            claim_id="CLM_001",
            status=VerificationStatus.SUPPORTED,
            rule_id="RULE_AUTH_SUCCESS_MATCH",
            predicate_type="EXACT_EVENT_MATCH",
            resolved_parameters={"user": "root", "src_ip": "192.168.1.100"},
            matched_row_count=1,
            evidence_refs=["EV_100"],
            supporting_records=[{"event_id": "EVT_1", "line_number": 10}],
            explanation="Matched 1 normalized AUTH_SUCCESS event for user 'root' from 192.168.1.100.",
            discrepancies=[],
            verified_at="2026-03-29T06:20:00Z",
        )
        data = res.model_dump(by_alias=True)
        assert data["verificationId"] == "VRF_001"
        assert data["status"] == "SUPPORTED"
        assert data["ruleId"] == "RULE_AUTH_SUCCESS_MATCH"

    def test_api_requests_responses(self):
        req = ClaimExtractionRequest(
            query="Did root log in?",
            retrieval_mode="HYBRID",
            retrieval_limit=15,
        )
        assert req.retrieval_limit == 15

        resp = ClaimExtractionResponse(
            case_id="CASE_TEST",
            query="Did root log in?",
            extracted_claims=[],
            evidence_retrieved_count=0,
            extraction_method=ExtractionMethod.DETERMINISTIC_FAKE,
        )
        assert resp.case_id == "CASE_TEST"
        assert resp.evidence_retrieved_count == 0

        v_req = ClaimVerificationRequest(claim_ids=["CLM_1", "CLM_2"], force_reverify=True)
        assert v_req.claim_ids == ["CLM_1", "CLM_2"]
        assert v_req.force_reverify is True

        v_resp = ClaimVerificationResponse(
            case_id="CASE_TEST",
            verified_count=2,
            summary={"SUPPORTED": 1, "CONTRADICTED": 1, "UNVERIFIED": 0, "INSUFFICIENT_EVIDENCE": 0},
            results=[],
        )
        assert v_resp.summary["SUPPORTED"] == 1

        list_resp = ClaimListResponse(
            case_id="CASE_TEST",
            total=0,
            claims=[],
            summary={"UNVERIFIED": 0},
        )
        assert list_resp.total == 0
