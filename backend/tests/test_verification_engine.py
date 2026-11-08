"""
Comprehensive test suite for ForensicLens Step 9 Phase D:
- Deterministic Predicate Registry (supported rules, unsupported parser gap rules)
- DeterministicVerificationEngine with strictly read-only execution (PRAGMA query_only = ON)
- Four-state verification semantics (SUPPORTED, CONTRADICTED, UNVERIFIED, INSUFFICIENT_EVIDENCE)
- Refinement 1: Failure at 10:00 followed by success at 10:02 is non-contradictory; ambiguous attempts return UNVERIFIED
- Refinement 2: Unparsed substring presence alone never marks GENERIC_FORENSIC_EVENT as SUPPORTED
- Refinement 3: Single-transaction append-only verification persistence with immutable triggers and denormalized claims.status cache
- Security tests: SQL injection resistance, cross-case violation rejection, and read-only enforcement
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
import pytest

from app.cases.database import (
    close_case_db,
    get_case_db_path,
    initialize_case_db,
    open_case_db,
    open_case_db_readonly,
)
from app.verification.engine import (
    CaseDatabaseNotFoundError,
    CrossCaseViolationError,
    DeterministicVerificationEngine,
)
from app.verification.persistence import (
    ensure_append_only_triggers,
    get_claim_verification_history,
    get_latest_claim_status,
    save_claim_verification,
    save_extracted_claims,
)
from app.verification.predicates import (
    ATTRIBUTION_DISCLAIMER,
    PredicateRegistry,
    default_predicate_registry,
)
from app.verification.schemas import (
    Claim,
    ClaimType,
    ClaimVerificationResult,
    EvidenceReference,
    EvidenceRole,
    ExtractionMethod,
    VerificationStatus,
)


@pytest.fixture
def case_env(tmp_path: Path):
    """Set up an isolated case database populated with synthetic forensic events."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    case_id = f"CASE_{uuid.uuid4().hex[:10].upper()}"
    db_path = get_case_db_path(cases_dir, case_id)
    conn = initialize_case_db(db_path, case_id, "Verification Test Case")

    # Ingest synthetic evidence file
    conn.execute(
        """
        INSERT INTO evidence_files (
            evidence_id, case_id, object_hash, object_size_bytes,
            original_name, format, parser_status, created_at
        ) VALUES ('EV_AUTH_1', ?, 'hash123', 500, 'auth.log', 'OPENSSH', 'PARSED', '2026-01-15T10:00:00Z')
        """,
        (case_id,),
    )

    # Ingest synthetic raw records
    conn.execute(
        """
        INSERT INTO raw_records (
            raw_record_id, case_id, evidence_id, record_no, line_number,
            byte_start, byte_end, raw_text, parse_status, created_at
        ) VALUES
        ('REC_1', ?, 'EV_AUTH_1', 1, 1, 0, 100, 'Jan 15 10:00:00 server sshd[100]: Failed password for admin from 192.168.1.50 port 45000 ssh2', 'PARSED', '2026-01-15T10:00:00Z'),
        ('REC_2', ?, 'EV_AUTH_1', 2, 2, 101, 200, 'Jan 15 10:02:00 server sshd[101]: Accepted password for admin from 192.168.1.50 port 45002 ssh2', 'PARSED', '2026-01-15T10:02:00Z'),
        ('REC_3', ?, 'EV_AUTH_1', 3, 3, 201, 300, 'Jan 15 10:02:05 server sshd[101]: pam_unix(sshd:session): session opened for user admin by (uid=0)', 'PARSED', '2026-01-15T10:02:05Z'),
        ('REC_4', ?, 'EV_AUTH_1', 4, 4, 301, 400, 'Jan 15 10:15:00 server sshd[101]: pam_unix(sshd:session): session closed for user admin', 'PARSED', '2026-01-15T10:15:00Z'),
        ('REC_RAW_UNPARSED', ?, 'EV_AUTH_1', 5, 5, 401, 500, 'CUSTOM_AUDIT_LOG: kernel firewall blocked packet from 10.99.99.99', 'UNPARSED', '2026-01-15T10:20:00Z')
        """,
        (case_id, case_id, case_id, case_id, case_id),
    )

    # Ingest synthetic normalized events
    conn.execute(
        """
        INSERT INTO events (
            event_id, case_id, evidence_id, raw_record_id, timestamp_utc,
            timestamp_original, event_type, severity, user_value, src_ip,
            src_port, process, pid, message, parse_status, line_number,
            byte_start, byte_end, event_hash, created_at
        ) VALUES
        ('EVT_FAIL', ?, 'EV_AUTH_1', 'REC_1', '2026-01-15T10:00:00Z', 'Jan 15 10:00:00', 'AUTH_FAILURE', 'WARNING', 'admin', '192.168.1.50', 45000, 'sshd', 100, 'Failed password for admin', 'PARSED', 1, 0, 100, 'hashfail', '2026-01-15T10:00:00Z'),
        ('EVT_SUCCESS', ?, 'EV_AUTH_1', 'REC_2', '2026-01-15T10:02:00Z', 'Jan 15 10:02:00', 'AUTH_SUCCESS', 'INFO', 'admin', '192.168.1.50', 45002, 'sshd', 101, 'Accepted password for admin', 'PARSED', 2, 101, 200, 'hashsucc', '2026-01-15T10:02:00Z'),
        ('EVT_SESS_OPEN', ?, 'EV_AUTH_1', 'REC_3', '2026-01-15T10:02:05Z', 'Jan 15 10:02:05', 'SESSION_OPENED', 'INFO', 'admin', '192.168.1.50', 45002, 'sshd', 101, 'session opened for user admin', 'PARSED', 3, 201, 300, 'hashopen', '2026-01-15T10:02:05Z'),
        ('EVT_SESS_CLOSE', ?, 'EV_AUTH_1', 'REC_4', '2026-01-15T10:15:00Z', 'Jan 15 10:15:00', 'SESSION_CLOSED', 'INFO', 'admin', '192.168.1.50', 45002, 'sshd', 101, 'session closed for user admin', 'PARSED', 4, 301, 400, 'hashclose', '2026-01-15T10:15:00Z')
        """,
        (case_id, case_id, case_id, case_id),
    )

    # Ingest synthetic reconstructed session
    conn.execute(
        """
        INSERT INTO sessions (
            session_id, case_id, session_type, principal_key, start_time_utc,
            end_time_utc, confidence, algorithm_version, created_at
        ) VALUES (
            'SESS_001', ?, 'SSH_SESSION', 'admin@192.168.1.50', '2026-01-15T10:02:00Z',
            '2026-01-15T10:15:00Z', 1.0, '1.0.0', '2026-01-15T10:15:00Z'
        )
        """,
        (case_id,),
    )
    conn.execute(
        """
        INSERT INTO session_events (session_id, event_id, ordinal, relationship)
        VALUES
        ('SESS_001', 'EVT_SUCCESS', 1, 'START'),
        ('SESS_001', 'EVT_SESS_OPEN', 2, 'ACTIVITY'),
        ('SESS_001', 'EVT_SESS_CLOSE', 3, 'TERMINATE')
        """
    )
    conn.commit()
    close_case_db(conn)

    return case_id, cases_dir


# ---------------------------------------------------------------------------
# 1. Predicate Registry Tests
# ---------------------------------------------------------------------------


class TestPredicateRegistry:
    """Test registry indexing, supported types, and unsupported parser gap types."""

    def test_default_registry_contains_all_10_claim_types(self):
        reg = default_predicate_registry
        implemented = reg.list_implemented_types()
        unsupported = reg.list_unsupported_types()

        assert len(implemented) == 6
        assert ClaimType.AUTH_SUCCESS in implemented
        assert ClaimType.AUTH_FAILURE in implemented
        assert ClaimType.SESSION_START in implemented
        assert ClaimType.SESSION_END in implemented
        assert ClaimType.SESSION_ACTIVITY in implemented
        assert ClaimType.GENERIC_FORENSIC_EVENT in implemented

        assert len(unsupported) == 4
        assert ClaimType.NETWORK_CONNECTION in unsupported
        assert ClaimType.FILE_ACCESS in unsupported
        assert ClaimType.ACCOUNT_MODIFICATION in unsupported
        assert ClaimType.PROCESS_EXECUTION in unsupported

    def test_unsupported_claim_types_produce_insufficient_evidence(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        claim = Claim(
            claimId="CLM_UNSUPPORTED",
            caseId=case_id,
            claimType=ClaimType.NETWORK_CONNECTION,
            statement="Outbound network connection established to 8.8.8.8 on port 53",
            action="CONNECT",
            createdAt="2026-01-15T10:00:00Z",
        )

        res = engine.verify_claim(case_id, claim)
        assert res.status == VerificationStatus.INSUFFICIENT_EVIDENCE
        assert res.rule_id == "RULE_UNSUPPORTED_NETWORK_CONNECTION_V1"
        assert "Packet Capture" in res.explanation


# ---------------------------------------------------------------------------
# 2. Four-State Verification Semantics & Refinement Tests
# ---------------------------------------------------------------------------


class TestVerificationSemantics:
    """Test SUPPORTED, CONTRADICTED, UNVERIFIED, and non-contradictory auth sequences."""

    def test_auth_success_supported(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        claim = Claim(
            claimId="CLM_SUCC",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="User admin logged in successfully from 192.168.1.50",
            subject="admin",
            action="LOGIN_SUCCESS",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(
                    evidenceId="EV_AUTH_1",
                    eventId="EVT_SUCCESS",
                    rawRecordId="REC_2",
                    role=EvidenceRole.PRIMARY_CITING,
                )
            ],
            createdAt="2026-01-15T10:02:00Z",
        )

        res = engine.verify_claim(case_id, claim)
        assert res.status == VerificationStatus.SUPPORTED
        assert res.matched_row_count == 1
        assert len(res.supporting_records) == 1
        assert res.supporting_records[0]["event_id"] == "EVT_SUCCESS"
        assert ATTRIBUTION_DISCLAIMER in res.explanation

    def test_refinement_1_failed_login_then_successful_login_is_not_contradiction(self, case_env):
        """
        Refinement 1:
        10:00 — Failed login for admin.
        10:02 — Successful login for admin.
        Both records are valid observations. The failed login must NOT contradict the successful login.
        """
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # Claim 1: asserts the 10:00 failure
        claim_fail = Claim(
            claimId="CLM_FAIL",
            caseId=case_id,
            claimType=ClaimType.AUTH_FAILURE,
            statement="Admin failed login at 10:00 from 192.168.1.50",
            subject="admin",
            action="AUTH_FAILURE",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(
                    evidenceId="EV_AUTH_1",
                    eventId="EVT_FAIL",
                    rawRecordId="REC_1",
                    role=EvidenceRole.PRIMARY_CITING,
                )
            ],
            createdAt="2026-01-15T10:00:00Z",
        )

        # Claim 2: asserts the 10:02 success
        claim_succ = Claim(
            claimId="CLM_SUCC_2",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully at 10:02 from 192.168.1.50",
            subject="admin",
            action="LOGIN_SUCCESS",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(
                    evidenceId="EV_AUTH_1",
                    eventId="EVT_SUCCESS",
                    rawRecordId="REC_2",
                    role=EvidenceRole.PRIMARY_CITING,
                )
            ],
            createdAt="2026-01-15T10:02:00Z",
        )

        res_fail = engine.verify_claim(case_id, claim_fail)
        res_succ = engine.verify_claim(case_id, claim_succ)

        # Both claims must be independently SUPPORTED without false contradiction
        assert res_fail.status == VerificationStatus.SUPPORTED
        assert res_succ.status == VerificationStatus.SUPPORTED
        assert len(res_fail.contradicting_records) == 0
        assert len(res_succ.contradicting_records) == 0

    def test_auth_contradiction_exact_attempt_failure(self, case_env):
        """
        If a claim asserts success by citing an event that is actually an authentication failure,
        it is CONTRADICTED.
        """
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # False claim asserting success on the failed event
        false_claim = Claim(
            claimId="CLM_FALSE_SUCC",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully at 10:00",
            subject="admin",
            action="LOGIN_SUCCESS",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(
                    evidenceId="EV_AUTH_1",
                    eventId="EVT_FAIL",  # Citing the failure event as proof of success!
                    rawRecordId="REC_1",
                    role=EvidenceRole.PRIMARY_CITING,
                )
            ],
            createdAt="2026-01-15T10:00:00Z",
        )

        res = engine.verify_claim(case_id, false_claim)
        assert res.status == VerificationStatus.CONTRADICTED
        assert len(res.contradicting_records) == 1
        assert "contradicted" in res.explanation.lower()

    def test_refinement_1_ambiguous_evidence_returns_unverified(self, case_env):
        """
        Refinement 1: If the relationship is ambiguous, return UNVERIFIED rather than CONTRADICTED.
        """
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # Claim citing both a failure and a success record ambiguously
        ambiguous_claim = Claim(
            claimId="CLM_AMBIGUOUS",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully",
            subject="admin",
            action="LOGIN_SUCCESS",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING),
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_FAIL", role=EvidenceRole.PRIMARY_CITING),
            ],
            createdAt="2026-01-15T10:00:00Z",
        )

        res = engine.verify_claim(case_id, ambiguous_claim)
        assert res.status == VerificationStatus.UNVERIFIED
        assert "ambiguous" in res.explanation.lower() or "conflicting" in res.explanation.lower()

    def test_refinement_2_generic_forensic_event_substring_alone_is_unverified(self, case_env):
        """
        Refinement 2: Do not mark GENERIC_FORENSIC_EVENT as SUPPORTED merely because
        matching text exists in a raw record. Require an explicit, validated predicate
        establishing the claimed semantics. Otherwise return UNVERIFIED or INSUFFICIENT_EVIDENCE.
        """
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # Claim pointing to unparsed raw record REC_RAW_UNPARSED
        claim = Claim(
            claimId="CLM_GENERIC_RAW",
            caseId=case_id,
            claimType=ClaimType.GENERIC_FORENSIC_EVENT,
            statement="kernel firewall blocked packet from 10.99.99.99",
            action="FIREWALL_BLOCK",
            evidenceReferences=[
                EvidenceReference(
                    evidenceId="EV_AUTH_1",
                    rawRecordId="REC_RAW_UNPARSED",
                    role=EvidenceRole.PRIMARY_CITING,
                    snippet="CUSTOM_AUDIT_LOG: kernel firewall blocked packet from 10.99.99.99",
                )
            ],
            createdAt="2026-01-15T10:20:00Z",
        )

        res = engine.verify_claim(case_id, claim)
        # Must NOT be marked SUPPORTED merely because substring matches
        assert res.status == VerificationStatus.UNVERIFIED
        assert "unparsed substring matching alone does not establish" in res.explanation

    def test_session_lifecycle_and_activity_verification(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # SESSION_START
        c_start = Claim(
            claimId="CLM_SESS_START",
            caseId=case_id,
            claimType=ClaimType.SESSION_START,
            statement="User session opened for admin",
            subject="admin",
            action="SESSION_OPEN",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SESS_OPEN", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:02:05Z",
        )
        assert engine.verify_claim(case_id, c_start).status == VerificationStatus.SUPPORTED

        # SESSION_END
        c_end = Claim(
            claimId="CLM_SESS_END",
            caseId=case_id,
            claimType=ClaimType.SESSION_END,
            statement="User session closed for admin",
            subject="admin",
            action="SESSION_CLOSE",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SESS_CLOSE", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:15:00Z",
        )
        assert engine.verify_claim(case_id, c_end).status == VerificationStatus.SUPPORTED

        # SESSION_ACTIVITY
        c_act = Claim(
            claimId="CLM_SESS_ACT",
            caseId=case_id,
            claimType=ClaimType.SESSION_ACTIVITY,
            statement="Admin was active in reconstructed SSH session SESS_001",
            subject="admin",
            action="SESSION_ACTIVE",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:02:00Z",
        )
        assert engine.verify_claim(case_id, c_act).status == VerificationStatus.SUPPORTED


# ---------------------------------------------------------------------------
# 3. Security & Read-Only Connection Tests
# ---------------------------------------------------------------------------


class TestVerificationSecurity:
    """Test read-only enforcement, SQL injection resilience, and cross-case isolation."""

    def test_read_only_connection_blocks_modifications(self, case_env):
        case_id, cases_dir = case_env
        db_path = get_case_db_path(cases_dir, case_id)
        ro_conn = open_case_db_readonly(db_path)

        try:
            # Querying succeeds
            assert ro_conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4

            # INSERT blocked
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute("INSERT INTO events (event_id, case_id) VALUES ('E_BAD', 'C_BAD')")

            # UPDATE blocked
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute("UPDATE events SET message = 'tampered'")

            # DELETE blocked
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute("DELETE FROM events")

            # DDL blocked
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                ro_conn.execute("DROP TABLE events")
        finally:
            close_case_db(ro_conn)

    def test_sql_injection_resistance(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        # Malicious claim attempting SQL injection in subject, sourceIp, and action
        malicious_claim = Claim(
            claimId="CLM_INJECT",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Legitimate-looking statement",
            subject="admin' OR '1'='1' --",
            action="LOGIN_SUCCESS'; DROP TABLE events; --",
            sourceIp="192.168.1.50' UNION SELECT * FROM cases --",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:00:00Z",
        )

        # Verification executes safely without executing injection
        res = engine.verify_claim(case_id, malicious_claim)
        assert res is not None

        # Confirm events table was NOT dropped
        db_path = get_case_db_path(cases_dir, case_id)
        conn = open_case_db_readonly(db_path)
        try:
            count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            assert count == 4
        finally:
            close_case_db(conn)

    def test_cross_case_isolation_rejected(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        foreign_claim = Claim(
            claimId="CLM_FOREIGN",
            caseId="CASE_DIFFERENT_EXTERNAL",  # Belongs to different case
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Foreign claim",
            action="LOGIN_SUCCESS",
            createdAt="2026-01-15T10:00:00Z",
        )

        with pytest.raises(CrossCaseViolationError, match="Security violation"):
            engine.verify_claim(case_id, foreign_claim)


# ---------------------------------------------------------------------------
# 4. Append-Only Persistence & Transaction Tests
# ---------------------------------------------------------------------------


class TestVerificationPersistence:
    """Test append-only verification persistence and Refinement 3 atomic cache updates."""

    def test_refinement_3_atomic_persistence_and_denormalized_cache(self, case_env):
        """
        Refinement 3:
        claim_verifications remains the authoritative immutable history.
        If claims.status is updated as a latest-status cache, update it in the
        same database transaction as the verification insertion.
        """
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        claim = Claim(
            claimId="CLM_PERSIST_1",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully",
            subject="admin",
            action="LOGIN_SUCCESS",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:02:00Z",
        )

        # Persist extracted claim first (UNVERIFIED)
        save_extracted_claims(case_id, [claim], data_dir=cases_dir)

        # Evaluate
        result = engine.verify_claim(case_id, claim)
        assert result.status == VerificationStatus.SUPPORTED

        # Save verification
        save_claim_verification(case_id, result, claim=claim, data_dir=cases_dir)

        # Check authoritative history
        history = get_claim_verification_history(case_id, "CLM_PERSIST_1", data_dir=cases_dir)
        assert len(history) == 1
        assert history[0].status == VerificationStatus.SUPPORTED
        assert history[0].verification_id == result.verification_id

        # Check latest status resolver
        latest_status = get_latest_claim_status(case_id, "CLM_PERSIST_1", data_dir=cases_dir)
        assert latest_status == VerificationStatus.SUPPORTED

        # Check denormalized cache in claims table
        db_path = get_case_db_path(cases_dir, case_id)
        conn = open_case_db_readonly(db_path)
        try:
            row = conn.execute("SELECT status FROM claims WHERE claim_id = 'CLM_PERSIST_1'").fetchone()
            assert row is not None
            assert row["status"] == "SUPPORTED"
        finally:
            close_case_db(conn)

    def test_append_only_triggers_prevent_update_and_delete(self, case_env):
        """Database triggers created by migration 003 must block any attempt to UPDATE or DELETE verification records."""
        case_id, cases_dir = case_env
        db_path = get_case_db_path(cases_dir, case_id)
        conn = open_case_db(db_path)
        try:
            # Insert parent claim first to satisfy foreign key
            conn.execute(
                """
                INSERT INTO claims (claim_id, case_id, claim_type, statement, action, created_at)
                VALUES ('CLM_IMMUTABLE', ?, 'AUTH_SUCCESS', 'test statement', 'LOGIN_SUCCESS', '2026-01-15T10:00:00Z')
                """,
                (case_id,),
            )

            # Insert a verification record
            conn.execute(
                """
                INSERT INTO claim_verifications (
                    verification_id, claim_id, status, rule_id, rule_version,
                    predicate_type, verified_at
                ) VALUES ('VRF_TEST_IMMUTABLE', 'CLM_IMMUTABLE', 'SUPPORTED', 'RULE_1', '1.0.0', 'MATCH', '2026-01-15T10:00:00Z')
                """
            )
            conn.commit()

            # Attempt UPDATE -> Must fail with IntegrityError from trigger
            with pytest.raises(sqlite3.IntegrityError, match="immutable"):
                conn.execute("UPDATE claim_verifications SET status = 'CONTRADICTED' WHERE verification_id = 'VRF_TEST_IMMUTABLE'")

            # Attempt DELETE -> Must fail with IntegrityError from trigger
            with pytest.raises(sqlite3.IntegrityError, match="append-only"):
                conn.execute("DELETE FROM claim_verifications WHERE verification_id = 'VRF_TEST_IMMUTABLE'")
        finally:
            close_case_db(conn)

    def test_multiple_verifications_preserve_full_history(self, case_env):
        """Repeated verification appends versioned history without overwriting earlier records."""
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        claim = Claim(
            claimId="CLM_MULTI_VERIFY",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully",
            subject="admin",
            action="LOGIN_SUCCESS",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:00:00Z",
        )

        save_extracted_claims(case_id, [claim], data_dir=cases_dir)

        res_1 = engine.verify_claim(case_id, claim)
        save_claim_verification(case_id, res_1, claim=claim, data_dir=cases_dir)

        # Second verification run (e.g. forced reverify)
        res_2 = engine.verify_claim(case_id, claim)
        save_claim_verification(case_id, res_2, claim=claim, data_dir=cases_dir)

        history = get_claim_verification_history(case_id, "CLM_MULTI_VERIFY", data_dir=cases_dir)
        assert len(history) == 2
        assert history[0].verification_id == res_2.verification_id
        assert history[1].verification_id == res_1.verification_id


# ---------------------------------------------------------------------------
# 5. Determinism & Reproducibility Tests
# ---------------------------------------------------------------------------


class TestVerificationDeterminism:
    """Test reproducibility: identical inputs yield identical decisions."""

    def test_repeated_evaluation_is_identical(self, case_env):
        case_id, cases_dir = case_env
        engine = DeterministicVerificationEngine(data_dir=cases_dir)

        claim = Claim(
            claimId="CLM_DETERMINISTIC",
            caseId=case_id,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="Admin logged in successfully",
            subject="admin",
            action="LOGIN_SUCCESS",
            sourceIp="192.168.1.50",
            evidenceReferences=[
                EvidenceReference(evidenceId="EV_AUTH_1", eventId="EVT_SUCCESS", role=EvidenceRole.PRIMARY_CITING)
            ],
            createdAt="2026-01-15T10:02:00Z",
        )

        r1 = engine.verify_claim(case_id, claim)
        r2 = engine.verify_claim(case_id, claim)

        assert r1.status == r2.status
        assert r1.rule_id == r2.rule_id
        assert r1.rule_version == r2.rule_version
        assert r1.matched_row_count == r2.matched_row_count
        assert r1.supporting_records == r2.supporting_records
        assert r1.contradicting_records == r2.contradicting_records
        assert r1.explanation == r2.explanation
