"""
Integration test suite for ForensicLens Claim Verification API Endpoints:
- POST /api/cases/{case_id}/claims/extract
- GET  /api/cases/{case_id}/claims
- POST /api/cases/{case_id}/claims/{claim_id}/verify
- GET  /api/cases/{case_id}/claims/{claim_id}/history
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException

import sqlite3

from app.api.claims import (
    extract_case_claims,
    get_claim_history,
    list_case_claims,
    verify_case_claim,
)
from app.cases.database import (
    close_case_db,
    initialize_case_db,
    open_case_db_readonly,
)
from app.evidence.service import ingest_evidence
from app.llm.provider import FakeLLMProvider
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result
from app.retrieval.embeddings import FakeEmbeddingModel
from app.retrieval.reranker import FakeReranker
from app.retrieval.schemas import RetrievalIndexRequest
from app.retrieval.service import RetrievalOrchestrator
from app.verification.engine import DeterministicVerificationEngine
from app.verification.extractor import ClaimExtractor
from app.verification.persistence import (
    get_case_claims,
    get_claim_by_id,
    get_claim_verification_history as helper_get_history,
    get_latest_claim_status as helper_get_latest_status,
    save_claim_verification,
    save_extracted_claims,
)
from app.verification.schemas import (
    Claim,
    ClaimExtractionRequest,
    ClaimType,
    ClaimVerificationResult,
    EvidenceReference,
    VerificationStatus,
)


@pytest.fixture
def claims_api_env(tmp_path: Path, monkeypatch):
    """
    Set up isolated test cases with evidence, events, indexed retrieval,
    and configured fake LLM and verification engine dependencies.
    """
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # --- Case 1: Alpha ---
    c1_id = "CASE-CLAIM-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Claims Test Case 1")

    log1 = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:21:05 server sshd[1235]: pam_unix(sshd:session): session opened for user root by (uid=0)\n"
    ).encode("utf-8")

    ev1 = ingest_evidence(
        conn=conn_1,
        case_dir=c1_dir,
        case_id=c1_id,
        source=io.BytesIO(log1),
        original_name="auth.log",
        format_name="OPENSSH",
    )
    parser = OpenSSHParser()
    p_res1 = parser.parse(ev1.storage_path, evidence_id=ev1.evidence_id)
    persist_parse_result(case_id=c1_id, parse_result=p_res1, conn=conn_1)

    # --- Case 2: Beta (for case isolation) ---
    c2_id = "CASE-CLAIM-2"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Claims Test Case 2")

    log2 = "Jan 16 11:00:00 server sshd[9999]: Accepted password for alice from 172.16.0.5 port 2222 ssh2\n".encode("utf-8")
    ev2 = ingest_evidence(
        conn=conn_2,
        case_dir=c2_dir,
        case_id=c2_id,
        source=io.BytesIO(log2),
        original_name="auth_beta.log",
        format_name="OPENSSH",
    )
    p_res2 = parser.parse(ev2.storage_path, evidence_id=ev2.evidence_id)
    persist_parse_result(case_id=c2_id, parse_result=p_res2, conn=conn_2)

    close_case_db(conn_1)
    close_case_db(conn_2)

    # Inject hermetic orchestrator with fake embedding & reranker
    orchestrator = RetrievalOrchestrator(
        embedding_model=FakeEmbeddingModel(),
        reranker=FakeReranker(),
    )
    orchestrator.index_case(cases_dir, c1_id, RetrievalIndexRequest())
    orchestrator.index_case(cases_dir, c2_id, RetrievalIndexRequest())

    # Create ClaimExtractor and DeterministicVerificationEngine
    extractor = ClaimExtractor(FakeLLMProvider())
    engine = DeterministicVerificationEngine(data_dir=cases_dir)

    return {
        "cases_dir": cases_dir,
        "case_1_id": c1_id,
        "case_2_id": c2_id,
        "ev1_id": ev1.evidence_id,
        "ev2_id": ev2.evidence_id,
        "orchestrator": orchestrator,
        "extractor": extractor,
        "engine": engine,
    }


# ---------------------------------------------------------------------------
# POST /api/cases/{case_id}/claims/extract
# ---------------------------------------------------------------------------


def test_extract_claims_success(claims_api_env):
    """POST /extract retrieves evidence, extracts claims, persists them as UNVERIFIED without verifying."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]
    orch = claims_api_env["orchestrator"]
    ext = claims_api_env["extractor"]

    req = ClaimExtractionRequest(
        query="Did root log in successfully?",
        retrievalMode="HYBRID",
        retrievalLimit=10,
    )
    res = extract_case_claims(c1, payload=req, orchestrator=orch, extractor=ext)

    assert res.case_id == c1
    assert res.query == "Did root log in successfully?"
    assert res.evidence_retrieved_count > 0
    assert len(res.extracted_claims) > 0

    # Verify extracted claims are returned with UNVERIFIED status
    for cl in res.extracted_claims:
        assert cl.current_status == VerificationStatus.UNVERIFIED
        assert len(cl.evidence_references) > 0

    # Verify claims are persisted in case.db with status = UNVERIFIED
    db_path = cases_dir / c1 / "case.db"
    conn = open_case_db_readonly(db_path)
    try:
        rows = conn.execute("SELECT * FROM claims WHERE case_id = ?", (c1,)).fetchall()
        assert len(rows) == len(res.extracted_claims)
        for r in rows:
            assert r["status"] == "UNVERIFIED"

        # Verify claim_evidence citations exist
        cite_rows = conn.execute("SELECT * FROM claim_evidence").fetchall()
        assert len(cite_rows) > 0

        # CRITICAL: Verify NO verifications were run during extraction
        verif_rows = conn.execute("SELECT * FROM claim_verifications").fetchall()
        assert len(verif_rows) == 0
    finally:
        close_case_db(conn)


def test_extract_claims_provider_unavailable(claims_api_env):
    """POST /extract returns 503 when the LLM provider is unavailable."""
    c1 = claims_api_env["case_1_id"]
    orch = claims_api_env["orchestrator"]
    unavailable_ext = ClaimExtractor(FakeLLMProvider(is_available=False))

    req = ClaimExtractionRequest(query="Who logged in?")
    with pytest.raises(HTTPException) as exc:
        extract_case_claims(c1, payload=req, orchestrator=orch, extractor=unavailable_ext)
    assert exc.value.status_code == 503
    assert "FakeLLMProvider" in str(exc.value.detail) or "unavailable" in str(exc.value.detail).lower()


def test_extract_claims_invalid_retrieval_mode(claims_api_env):
    """POST /extract returns 400 when an invalid retrieval mode is supplied."""
    c1 = claims_api_env["case_1_id"]
    orch = claims_api_env["orchestrator"]
    ext = claims_api_env["extractor"]

    req = ClaimExtractionRequest(
        query="Who logged in?",
        retrievalMode="NONEXISTENT_MODE",
    )
    with pytest.raises(HTTPException) as exc:
        extract_case_claims(c1, payload=req, orchestrator=orch, extractor=ext)
    assert exc.value.status_code == 400
    assert "Invalid retrieval_mode" in str(exc.value.detail)


def test_extract_claims_nonexistent_case(claims_api_env):
    """POST /extract returns 404 for a non-existent case."""
    orch = claims_api_env["orchestrator"]
    ext = claims_api_env["extractor"]

    req = ClaimExtractionRequest(query="Who logged in?")
    with pytest.raises(HTTPException) as exc:
        extract_case_claims("CASE-DOES-NOT-EXIST", payload=req, orchestrator=orch, extractor=ext)
    assert exc.value.status_code == 404


def test_extract_claims_malformed_case_id(claims_api_env):
    """POST /extract returns 400 for path-traversal or malformed case ID."""
    orch = claims_api_env["orchestrator"]
    ext = claims_api_env["extractor"]

    req = ClaimExtractionRequest(query="Who logged in?")
    with pytest.raises(HTTPException) as exc:
        extract_case_claims("bad..case", payload=req, orchestrator=orch, extractor=ext)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/cases/{case_id}/claims
# ---------------------------------------------------------------------------


def test_list_claims_empty(claims_api_env):
    """GET /claims returns empty list when no claims exist for the case."""
    c2 = claims_api_env["case_2_id"]

    res = list_case_claims(c2)
    assert res.case_id == c2
    assert res.total == 0
    assert res.claims == []
    assert res.summary["UNVERIFIED"] == 0


def test_list_claims_case_isolation_and_pagination(claims_api_env):
    """GET /claims enforces strict case isolation, pagination, and status summaries."""
    c1 = claims_api_env["case_1_id"]
    c2 = claims_api_env["case_2_id"]
    ev1_id = claims_api_env["ev1_id"]
    ev2_id = claims_api_env["ev2_id"]
    cases_dir = claims_api_env["cases_dir"]

    # Insert 3 claims into Case 1
    c1_claims = [
        Claim(
            claimId="CLM_C1_1",
            caseId=c1,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="root logged in successfully",
            action="LOGIN_SUCCESS",
            subject="root",
            createdAt="2026-01-15T10:21:00Z",
            evidenceReferences=[
                EvidenceReference(evidenceId=ev1_id, snippet="Accepted password for root")
            ],
        ),
        Claim(
            claimId="CLM_C1_2",
            caseId=c1,
            claimType=ClaimType.AUTH_FAILURE,
            statement="hacker failed login",
            action="AUTH_FAILURE",
            subject="hacker",
            createdAt="2026-01-15T10:20:30Z",
            evidenceReferences=[
                EvidenceReference(evidenceId=ev1_id, snippet="Failed password for invalid user hacker")
            ],
        ),
        Claim(
            claimId="CLM_C1_3",
            caseId=c1,
            claimType=ClaimType.SESSION_START,
            statement="session opened for root",
            action="SESSION_OPEN",
            subject="root",
            createdAt="2026-01-15T10:21:05Z",
            evidenceReferences=[
                EvidenceReference(evidenceId=ev1_id, snippet="session opened for user root")
            ],
        ),
    ]
    save_extracted_claims(c1, c1_claims, data_dir=cases_dir)

    # Insert 1 claim into Case 2
    c2_claims = [
        Claim(
            claimId="CLM_C2_1",
            caseId=c2,
            claimType=ClaimType.AUTH_SUCCESS,
            statement="alice logged in",
            action="LOGIN_SUCCESS",
            subject="alice",
            createdAt="2026-01-16T11:00:00Z",
            evidenceReferences=[
                EvidenceReference(evidenceId=ev2_id, snippet="Accepted password for alice")
            ],
        )
    ]
    save_extracted_claims(c2, c2_claims, data_dir=cases_dir)

    # 1. Verify Case 1 pagination (page 1, pageSize 2)
    res_p1 = list_case_claims(c1, page=1, page_size=2)
    assert res_p1.case_id == c1
    assert res_p1.total == 3
    assert res_p1.total_pages == 2
    assert res_p1.page == 1
    assert res_p1.page_size == 2
    assert len(res_p1.claims) == 2
    assert res_p1.summary["UNVERIFIED"] == 3

    # 2. Verify Case 1 page 2
    res_p2 = list_case_claims(c1, page=2, page_size=2)
    assert len(res_p2.claims) == 1
    assert res_p2.page == 2

    # 3. Verify Case 2 has only its own claim
    res_c2 = list_case_claims(c2)
    assert res_c2.total == 1
    assert res_c2.claims[0].claim_id == "CLM_C2_1"

    # 4. Verify claimType filter on Case 1
    res_filter = list_case_claims(c1, claim_type=ClaimType.AUTH_FAILURE)
    assert res_filter.total == 1
    assert res_filter.claims[0].claim_id == "CLM_C1_2"
    assert res_filter.summary["UNVERIFIED"] == 3


def test_list_claims_nonexistent_case(claims_api_env):
    """GET /claims returns 404 for non-existent case."""
    with pytest.raises(HTTPException) as exc:
        list_case_claims("DOES_NOT_EXIST")
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/cases/{case_id}/claims/{claim_id}/verify
# ---------------------------------------------------------------------------


def test_verify_claim_supported(claims_api_env):
    """POST /verify verifies an AUTH_SUCCESS claim, returns SUPPORTED, and updates DB cache."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]
    ev1_id = claims_api_env["ev1_id"]
    engine = claims_api_env["engine"]

    # Locate event_id from case.db for root login
    db_path = cases_dir / c1 / "case.db"
    conn_ro = open_case_db_readonly(db_path)
    try:
        ev_row = conn_ro.execute(
            "SELECT event_id FROM events WHERE case_id = ? AND user_value = 'root' AND event_type = 'AUTH_SUCCESS'",
            (c1,),
        ).fetchone()
        assert ev_row is not None
        root_event_id = ev_row["event_id"]
    finally:
        close_case_db(conn_ro)

    claim = Claim(
        claimId="CLM_VERIFY_ROOT",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root logged in via ssh from 10.0.0.1",
        subject="root",
        action="LOGIN_SUCCESS",
        sourceIp="10.0.0.1",
        sourcePort=55433,
        timestampClaimed="2026-01-15T10:21:00Z",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(
                evidenceId=ev1_id,
                eventId=root_event_id,
                snippet="Accepted password for root from 10.0.0.1 port 55433 ssh2",
            )
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)

    # Execute verification via API
    res = verify_case_claim(c1, "CLM_VERIFY_ROOT", engine=engine)

    assert res.claim_id == "CLM_VERIFY_ROOT"
    assert res.status == VerificationStatus.SUPPORTED
    assert res.rule_id == "RULE_AUTH_SUCCESS_V1"
    assert res.matched_row_count >= 1
    assert len(res.supporting_records) >= 1

    # Verify that claims.status denormalized cache was updated in DB
    conn = open_case_db_readonly(db_path)
    try:
        claim_row = conn.execute("SELECT status FROM claims WHERE claim_id = ?", ("CLM_VERIFY_ROOT",)).fetchone()
        assert claim_row["status"] == "SUPPORTED"

        # Verify claim_verifications has the immutable audit record
        v_rows = conn.execute("SELECT * FROM claim_verifications WHERE claim_id = ?", ("CLM_VERIFY_ROOT",)).fetchall()
        assert len(v_rows) == 1
        assert v_rows[0]["status"] == "SUPPORTED"
    finally:
        close_case_db(conn)


def test_verify_claim_cross_case_isolation(claims_api_env):
    """POST /verify returns 404 when attempting to verify Case 1's claim inside Case 2."""
    c1 = claims_api_env["case_1_id"]
    c2 = claims_api_env["case_2_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]
    engine = claims_api_env["engine"]

    claim = Claim(
        claimId="CLM_ISOLATED_C1",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root logged in",
        action="LOGIN_SUCCESS",
        subject="root",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Accepted password for root")
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)

    # Cross-case verification attempt: c2 route with c1 claim
    with pytest.raises(HTTPException) as exc:
        verify_case_claim(c2, "CLM_ISOLATED_C1", engine=engine)
    assert exc.value.status_code == 404
    assert "not found in case" in str(exc.value.detail)


def test_verify_claim_nonexistent_claim(claims_api_env):
    """POST /verify returns 404 when claim does not exist."""
    c1 = claims_api_env["case_1_id"]
    engine = claims_api_env["engine"]

    with pytest.raises(HTTPException) as exc:
        verify_case_claim(c1, "DOES_NOT_EXIST", engine=engine)
    assert exc.value.status_code == 404


def test_verify_claim_malformed_identifier(claims_api_env):
    """POST /verify returns 400 for path-traversal claim ID."""
    c1 = claims_api_env["case_1_id"]
    engine = claims_api_env["engine"]

    with pytest.raises(HTTPException) as exc:
        verify_case_claim(c1, "bad..claim", engine=engine)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/cases/{case_id}/claims/{claim_id}/history
# ---------------------------------------------------------------------------


def test_claim_history_reverse_chronological(claims_api_env):
    """GET /history returns verification audit history ordered reverse chronologically."""
    c1 = claims_api_env["case_1_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]
    engine = claims_api_env["engine"]

    claim = Claim(
        claimId="CLM_HIST_TEST",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root logged in",
        action="LOGIN_SUCCESS",
        subject="root",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Accepted password for root")
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)

    # Run verification twice
    v1 = verify_case_claim(c1, "CLM_HIST_TEST", engine=engine)
    v2 = verify_case_claim(c1, "CLM_HIST_TEST", engine=engine)

    # Query history
    history = get_claim_history(c1, "CLM_HIST_TEST")

    assert len(history) == 2
    # Ensure reverse chronological order: history[0] verified_at >= history[1] verified_at
    assert history[0].verified_at >= history[1].verified_at
    assert history[0].verification_id != history[1].verification_id


def test_claim_history_nonexistent_claim(claims_api_env):
    """GET /history returns 404 for a non-existent claim."""
    c1 = claims_api_env["case_1_id"]

    with pytest.raises(HTTPException) as exc:
        get_claim_history(c1, "CLM_NOT_FOUND")
    assert exc.value.status_code == 404


def test_claim_history_cross_case(claims_api_env):
    """GET /history returns 404 when querying a claim under a different case."""
    c1 = claims_api_env["case_1_id"]
    c2 = claims_api_env["case_2_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]

    claim = Claim(
        claimId="CLM_C1_HIST",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root login",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Accepted password for root")
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)

    # Query under Case 2
    with pytest.raises(HTTPException) as exc:
        get_claim_history(c2, "CLM_C1_HIST")
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Phase E Security & Data Integrity Pass Tests
# ---------------------------------------------------------------------------


def test_duplicate_claim_id_collision_raises_integrity_error(claims_api_env):
    """save_extracted_claims raises IntegrityError on collision without attaching new citations."""
    c1 = claims_api_env["case_1_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]

    claim1 = Claim(
        claimId="CLM_COLLISION_TEST",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="Original statement",
        action="LOGIN_SUCCESS",
        confidence=0.9,
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Original snippet 1")
        ],
    )
    save_extracted_claims(c1, [claim1], data_dir=cases_dir)

    # Attempt to insert colliding claim with duplicate ID and different citations
    claim_duplicate = Claim(
        claimId="CLM_COLLISION_TEST",
        caseId=c1,
        claimType=ClaimType.AUTH_FAILURE,
        statement="Colliding statement attempt",
        action="AUTH_FAILURE",
        confidence=0.4,
        createdAt="2026-01-15T10:22:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Colliding snippet that must not be attached")
        ],
    )
    with pytest.raises(sqlite3.IntegrityError):
        save_extracted_claims(c1, [claim_duplicate], data_dir=cases_dir)

    # Confirm original claim and citations remain unchanged
    persisted = get_claim_by_id(c1, "CLM_COLLISION_TEST", data_dir=cases_dir)
    assert persisted is not None
    assert persisted.statement == "Original statement"
    assert len(persisted.evidence_references) == 1
    assert persisted.evidence_references[0].snippet == "Original snippet 1"


def test_cross_case_persistence_prevention(claims_api_env):
    """save_extracted_claims and save_claim_verification reject cross-case claims."""
    c1 = claims_api_env["case_1_id"]
    c2 = claims_api_env["case_2_id"]
    ev2_id = claims_api_env["ev2_id"]
    cases_dir = claims_api_env["cases_dir"]

    # Claim tagged with Case 2
    claim_c2 = Claim(
        claimId="CLM_CROSS_CASE",
        caseId=c2,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="alice logged in",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-16T11:00:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev2_id, snippet="Accepted password for alice")
        ],
    )

    # Attempt to persist claim_c2 into Case 1
    with pytest.raises(ValueError) as exc:
        save_extracted_claims(c1, [claim_c2], data_dir=cases_dir)
    assert "Cross-case integrity violation" in str(exc.value)

    # Verify not inserted in Case 1
    assert get_claim_by_id(c1, "CLM_CROSS_CASE", data_dir=cases_dir) is None

    # Attempt to save verification for claim_c2 under Case 1
    res = ClaimVerificationResult(
        verificationId="VRF_CROSS",
        claimId="CLM_CROSS_CASE",
        status=VerificationStatus.SUPPORTED,
        ruleId="RULE_TEST",
        ruleVersion="1.0.0",
        predicateType="TEST",
        verifierVersion="1.0.0",
        verifiedAt="2026-01-16T11:00:00Z",
    )
    with pytest.raises(ValueError) as exc2:
        save_claim_verification(c1, res, claim=claim_c2, data_dir=cases_dir)
    assert "Cross-case integrity violation" in str(exc2.value)


def test_atomic_rollback_on_failed_citation(claims_api_env):
    """A batch rolls back entirely if any citation fails foreign key validation."""
    c1 = claims_api_env["case_1_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]

    bad_claim = Claim(
        claimId="CLM_FAIL_BATCH",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root login with corrupted citations",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Valid citation"),
            # Non-existent evidence_id triggers FK constraint failure
            EvidenceReference(evidenceId="EV_NONEXISTENT_FK", snippet="Invalid citation"),
        ],
    )

    with pytest.raises(sqlite3.IntegrityError):
        save_extracted_claims(c1, [bad_claim], data_dir=cases_dir)

    # Invariant: Claim itself must have been completely rolled back
    db_path = cases_dir / c1 / "case.db"
    conn = open_case_db_readonly(db_path)
    try:
        row = conn.execute("SELECT * FROM claims WHERE claim_id = 'CLM_FAIL_BATCH'").fetchone()
        assert row is None
        cite_rows = conn.execute("SELECT * FROM claim_evidence WHERE claim_id = 'CLM_FAIL_BATCH'").fetchall()
        assert len(cite_rows) == 0
    finally:
        close_case_db(conn)


def test_confidence_round_trip_and_null_preservation(claims_api_env):
    """Actual extractor confidence is persisted and retrieved without defaulting to 1.0."""
    c1 = claims_api_env["case_1_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]

    # 1. Claim with specific confidence 0.85
    claim_with_conf = Claim(
        claimId="CLM_CONF_85",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root logged in with 0.85 confidence",
        action="LOGIN_SUCCESS",
        confidence=0.85,
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Accepted password")
        ],
    )

    # 2. Claim with None confidence (must NOT become 1.0)
    claim_none_conf = Claim(
        claimId="CLM_CONF_NONE",
        caseId=c1,
        claimType=ClaimType.AUTH_FAILURE,
        statement="failed login with unknown confidence",
        action="AUTH_FAILURE",
        confidence=None,
        createdAt="2026-01-15T10:20:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Failed password")
        ],
    )

    save_extracted_claims(c1, [claim_with_conf, claim_none_conf], data_dir=cases_dir)

    # Verify get_claim_by_id round-trip
    r1 = get_claim_by_id(c1, "CLM_CONF_85", data_dir=cases_dir)
    assert r1 is not None
    assert r1.confidence == 0.85

    r2 = get_claim_by_id(c1, "CLM_CONF_NONE", data_dir=cases_dir)
    assert r2 is not None
    assert r2.confidence is None

    # Verify list_case_claims round-trip
    list_res = list_case_claims(c1)
    retrieved_map = {c.claim_id: c for c in list_res.claims}
    assert retrieved_map["CLM_CONF_85"].confidence == 0.85
    assert retrieved_map["CLM_CONF_NONE"].confidence is None


def test_api_error_handling_sanitizes_500_details(claims_api_env):
    """HTTP 500 error responses return safe generic messages without internal exception text or paths."""
    c1 = claims_api_env["case_1_id"]
    orch = claims_api_env["orchestrator"]

    # Class that raises an internal error with sensitive path details
    class FaultyExtractor:
        def extract_claims(self, *args, **kwargs):
            raise RuntimeError("Database corruption at D:\\secure_cases\\internal\\vault.db. Secret key: 12345")

    req = ClaimExtractionRequest(query="Who logged in?")
    with pytest.raises(HTTPException) as exc:
        extract_case_claims(c1, payload=req, orchestrator=orch, extractor=FaultyExtractor())

    assert exc.value.status_code == 500
    # Must NOT leak internal paths or exception class names
    assert "D:\\secure_cases" not in exc.value.detail
    assert "vault.db" not in exc.value.detail
    assert "RuntimeError" not in exc.value.detail
    assert "Secret key" not in exc.value.detail
    assert exc.value.detail == "An internal error occurred while extracting claims."


def test_history_helpers_enforce_cross_case_ownership(claims_api_env):
    """History helpers reject claims belonging to other cases with ValueError."""
    c1 = claims_api_env["case_1_id"]
    c2 = claims_api_env["case_2_id"]
    ev1_id = claims_api_env["ev1_id"]
    cases_dir = claims_api_env["cases_dir"]
    engine = claims_api_env["engine"]

    # Insert and verify claim in Case 1
    claim = Claim(
        claimId="CLM_C1_HELPER",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="root login",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:21:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Accepted password for root")
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)
    verify_case_claim(c1, "CLM_C1_HELPER", engine=engine)

    # Case 1 helper calls succeed
    h1 = helper_get_history(c1, "CLM_C1_HELPER", data_dir=cases_dir)
    assert len(h1) == 1
    s1 = helper_get_latest_status(c1, "CLM_C1_HELPER", data_dir=cases_dir)
    assert s1 == h1[0].status

    # Case 2 querying Case 1 claim must fail with ValueError
    with pytest.raises(ValueError) as exc_h:
        helper_get_history(c2, "CLM_C1_HELPER", data_dir=cases_dir)
    assert "Claim 'CLM_C1_HELPER' not found in case 'CASE-CLAIM-2'" in str(exc_h.value)

    with pytest.raises(ValueError) as exc_s:
        helper_get_latest_status(c2, "CLM_C1_HELPER", data_dir=cases_dir)
    assert "Claim 'CLM_C1_HELPER' not found in case 'CASE-CLAIM-2'" in str(exc_s.value)


# ---------------------------------------------------------------------------
# Phase E Persistence Correction Regression Tests
# ---------------------------------------------------------------------------


def test_save_claim_verification_nonexistent_claim_fails_without_inserting(claims_api_env):
    """Verifying a nonexistent claim raises ValueError and does not implicitly insert the claim."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]

    missing_claim = Claim(
        claimId="CLM_DOES_NOT_EXIST",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="Nonexistent claim statement",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:00:00Z",
    )
    res = ClaimVerificationResult(
        verificationId="VRF_NONEXISTENT",
        claimId="CLM_DOES_NOT_EXIST",
        status=VerificationStatus.SUPPORTED,
        ruleId="RULE_TEST",
        ruleVersion="1.0.0",
        predicateType="TEST",
        verifierVersion="1.0.0",
        verifiedAt="2026-01-15T10:00:00Z",
    )

    with pytest.raises(ValueError) as exc:
        save_claim_verification(c1, res, claim=missing_claim, data_dir=cases_dir)
    assert "Claim 'CLM_DOES_NOT_EXIST' does not exist in case" in str(exc.value)

    # Invariant: Claim must not have been created
    assert get_claim_by_id(c1, "CLM_DOES_NOT_EXIST", data_dir=cases_dir) is None

    # Invariant: Verification record must not exist
    db_path = cases_dir / c1 / "case.db"
    conn = open_case_db_readonly(db_path)
    try:
        vrf = conn.execute(
            "SELECT * FROM claim_verifications WHERE verification_id = 'VRF_NONEXISTENT'"
        ).fetchone()
        assert vrf is None
    finally:
        close_case_db(conn)


def test_save_claim_verification_claim_id_mismatch_rejected(claims_api_env):
    """save_claim_verification rejects mismatched claim_id between result and claim."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]

    claim = Claim(
        claimId="CLM_ID_A",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="Claim A statement",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:00:00Z",
    )
    res = ClaimVerificationResult(
        verificationId="VRF_MISMATCH",
        claimId="CLM_ID_B",
        status=VerificationStatus.SUPPORTED,
        ruleId="RULE_TEST",
        ruleVersion="1.0.0",
        predicateType="TEST",
        verifierVersion="1.0.0",
        verifiedAt="2026-01-15T10:00:00Z",
    )

    with pytest.raises(ValueError) as exc:
        save_claim_verification(c1, res, claim=claim, data_dir=cases_dir)
    assert "Claim ID mismatch" in str(exc.value)


def test_verification_persistence_atomicity_rollback_on_failure(claims_api_env):
    """If verification persistence encounters a constraint failure, both history insertion and status update roll back."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]
    ev1_id = claims_api_env["ev1_id"]

    claim = Claim(
        claimId="CLM_ROLLBACK_TEST",
        caseId=c1,
        claimType=ClaimType.AUTH_SUCCESS,
        statement="Rollback atomicity test statement",
        action="LOGIN_SUCCESS",
        createdAt="2026-01-15T10:00:00Z",
        evidenceReferences=[
            EvidenceReference(evidenceId=ev1_id, snippet="Snippet")
        ],
    )
    save_extracted_claims(c1, [claim], data_dir=cases_dir)
    assert get_claim_by_id(c1, "CLM_ROLLBACK_TEST", data_dir=cases_dir).current_status == VerificationStatus.UNVERIFIED

    res1 = ClaimVerificationResult(
        verificationId="VRF_ROLLBACK_UNIQUE",
        claimId="CLM_ROLLBACK_TEST",
        status=VerificationStatus.SUPPORTED,
        ruleId="RULE_TEST",
        ruleVersion="1.0.0",
        predicateType="TEST",
        verifierVersion="1.0.0",
        verifiedAt="2026-01-15T10:00:00Z",
    )
    # First save succeeds
    save_claim_verification(c1, res1, claim=claim, data_dir=cases_dir)
    assert get_claim_by_id(c1, "CLM_ROLLBACK_TEST", data_dir=cases_dir).current_status == VerificationStatus.SUPPORTED

    # Second save with exact same verificationId violates PRIMARY KEY on claim_verifications
    res2 = ClaimVerificationResult(
        verificationId="VRF_ROLLBACK_UNIQUE",
        claimId="CLM_ROLLBACK_TEST",
        status=VerificationStatus.CONTRADICTED,
        ruleId="RULE_TEST",
        ruleVersion="1.0.0",
        predicateType="TEST",
        verifierVersion="1.0.0",
        verifiedAt="2026-01-15T10:05:00Z",
    )
    with pytest.raises(sqlite3.IntegrityError):
        save_claim_verification(c1, res2, claim=claim, data_dir=cases_dir)

    # Invariant: Status remains SUPPORTED, did not become CONTRADICTED
    persisted = get_claim_by_id(c1, "CLM_ROLLBACK_TEST", data_dir=cases_dir)
    assert persisted.current_status == VerificationStatus.SUPPORTED

    # Invariant: Verification history only has 1 record
    history = helper_get_history(c1, "CLM_ROLLBACK_TEST", data_dir=cases_dir)
    assert len(history) == 1
    assert history[0].status == VerificationStatus.SUPPORTED


def test_persistence_pagination_max_size_enforced_at_200(claims_api_env):
    """Direct invocation of get_case_claims enforces a maximum page_size of 200 and minimum of 1."""
    c1 = claims_api_env["case_1_id"]
    cases_dir = claims_api_env["cases_dir"]

    # Generate 210 claims
    claims_batch = [
        Claim(
            claimId=f"CLM_PAGE_{i:03d}",
            caseId=c1,
            claimType=ClaimType.AUTH_SUCCESS,
            statement=f"Pagination statement {i}",
            action="LOGIN_SUCCESS",
            createdAt=f"2026-01-15T10:{i % 60:02d}:00Z",
        )
        for i in range(210)
    ]
    save_extracted_claims(c1, claims_batch, data_dir=cases_dir)

    # Request page_size = 500 -> must clamp to 200
    claims, total, _ = get_case_claims(c1, page=1, page_size=500, data_dir=cases_dir)
    assert total >= 210
    assert len(claims) == 200

    # Request page_size = 0 or negative -> must clamp to 1
    claims_min, _, _ = get_case_claims(c1, page=1, page_size=0, data_dir=cases_dir)
    assert len(claims_min) == 1

    # Request page = 0 or negative -> must clamp to page 1
    claims_p0, _, _ = get_case_claims(c1, page=0, page_size=10, data_dir=cases_dir)
    assert len(claims_p0) == 10
    assert claims_p0[0].claim_id == claims[0].claim_id
