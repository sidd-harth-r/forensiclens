"""
Unit and integration test suite for ForensicLens Cases, Evidence, and Events API endpoints.

Tests verify:
    - Cases: listing, retrieval, creation, duplicate prevention, and validation
    - Evidence: listing, retrieval, ingestion, hash verification, deduplication, and isolation
    - Events: query, pagination, event_type/severity filtering, FTS5 lexical search, and byte provenance
    - Case isolation across all endpoints
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException, UploadFile

from app.api.cases import (
    CreateCaseRequest,
    create_new_case,
    get_all_cases,
    get_case_by_id,
)
from app.api.evidence import (
    get_case_evidence_by_id,
    list_case_evidence,
    upload_case_evidence,
)
from app.api.events import (
    get_case_event_by_id,
    list_case_events,
)
from app.cases.database import close_case_db, initialize_case_db, open_case_db
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result


@pytest.fixture
def api_test_data(tmp_path: Path, monkeypatch):
    """
    Set up isolated test cases with evidence and events in temporary storage.
    """
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # Initialize Case 1: Alpha
    c1_id = "CASE-ALPHA"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Operation Alpha", created_by="Analyst A")

    # Ingest evidence into Case 1
    log_content = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
    ).encode("utf-8")

    ev_record = ingest_evidence(
        conn=conn_1,
        case_dir=c1_dir,
        case_id=c1_id,
        source=io.BytesIO(log_content),
        original_name="auth.log",
        format_name="OPENSSH",
    )

    # Parse and persist events in Case 1
    parser = OpenSSHParser()
    parse_result = parser.parse(ev_record.storage_path, evidence_id=ev_record.evidence_id)
    persist_parse_result(case_id=c1_id, parse_result=parse_result, conn=conn_1)

    # Initialize Case 2: Beta (empty case for isolation checks)
    c2_id = "CASE-BETA"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Operation Beta", created_by="Analyst B")

    close_case_db(conn_1)
    close_case_db(conn_2)

    return {
        "cases_dir": cases_dir,
        "case_1_id": c1_id,
        "case_2_id": c2_id,
        "case_1_dir": c1_dir,
        "case_2_dir": c2_dir,
        "case_1_db": c1_db,
        "case_2_db": c2_db,
        "evidence_id": ev_record.evidence_id,
    }


# ---------------------------------------------------------------------------
# Cases Endpoints Tests
# ---------------------------------------------------------------------------

def test_get_all_cases(api_test_data):
    cases = get_all_cases()
    assert len(cases) == 2
    case_ids = {c["caseId"] for c in cases}
    assert "CASE-ALPHA" in case_ids
    assert "CASE-BETA" in case_ids

    c1 = next(c for c in cases if c["caseId"] == "CASE-ALPHA")
    assert c1["name"] == "Operation Alpha"
    assert c1["evidenceCount"] == 1
    assert c1["eventsCount"] == 2
    assert c1["leadInvestigator"] == "Analyst A"

    c2 = next(c for c in cases if c["caseId"] == "CASE-BETA")
    assert c2["evidenceCount"] == 0
    assert c2["eventsCount"] == 0


def test_get_case_by_id_success(api_test_data):
    case = get_case_by_id(api_test_data["case_1_id"])
    assert case["caseId"] == "CASE-ALPHA"
    assert case["name"] == "Operation Alpha"
    assert case["status"] == "OPEN"
    assert case["evidenceCount"] == 1
    assert case["eventsCount"] == 2


def test_get_case_by_id_not_found(api_test_data):
    with pytest.raises(HTTPException) as exc_info:
        get_case_by_id("CASE-NONEXISTENT")
    assert exc_info.value.status_code == 404


def test_get_case_by_id_invalid_traversal(api_test_data):
    with pytest.raises(HTTPException) as exc_info:
        get_case_by_id(".._traversal")
    assert exc_info.value.status_code == 400


def test_create_new_case_success(api_test_data):
    req = CreateCaseRequest(
        caseId="CASE-GAMMA",
        name="Operation Gamma",
        description="Newly initiated test case",
        leadInvestigator="Examiner X",
    )
    created = create_new_case(req)
    assert created["caseId"] == "CASE-GAMMA"
    assert created["name"] == "Operation Gamma"
    assert created["description"] == "Newly initiated test case"
    assert created["leadInvestigator"] == "Examiner X"
    assert created["evidenceCount"] == 0
    assert created["eventsCount"] == 0

    # Ensure listed in repository
    all_cases = get_all_cases()
    assert any(c["caseId"] == "CASE-GAMMA" for c in all_cases)


def test_create_new_case_duplicate_conflict(api_test_data):
    req = CreateCaseRequest(
        caseId=api_test_data["case_1_id"],
        name="Duplicate Case",
    )
    with pytest.raises(HTTPException) as exc_info:
        create_new_case(req)
    assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# Evidence Endpoints Tests
# ---------------------------------------------------------------------------

def test_list_case_evidence(api_test_data):
    conn = open_case_db(api_test_data["case_1_db"])
    try:
        evidence_list = list_case_evidence(api_test_data["case_1_id"], conn=conn)
        assert len(evidence_list) == 1
        ev = evidence_list[0]
        assert ev.evidenceId == api_test_data["evidence_id"]
        assert ev.originalName == "auth.log"
        assert ev.format == "OPENSSH"
        assert ev.parserStatus == "PARSED"
        assert ev.totalLines == 2
        assert ev.parsedLines == 2
        assert len(ev.objectHash) == 64
    finally:
        close_case_db(conn)


def test_get_case_evidence_by_id(api_test_data):
    conn = open_case_db(api_test_data["case_1_db"])
    try:
        ev = get_case_evidence_by_id(
            api_test_data["case_1_id"],
            api_test_data["evidence_id"],
            conn=conn,
        )
        assert ev.evidenceId == api_test_data["evidence_id"]
        assert ev.caseId == api_test_data["case_1_id"]
        assert ev.format == "OPENSSH"
    finally:
        close_case_db(conn)


def test_evidence_case_isolation(api_test_data):
    """Evidence in Case 1 must not be accessible via Case 2 connection."""
    conn_2 = open_case_db(api_test_data["case_2_db"])
    try:
        # Case 2 evidence list must be empty
        list_2 = list_case_evidence(api_test_data["case_2_id"], conn=conn_2)
        assert len(list_2) == 0

        # Attempting to fetch Case 1 evidence via Case 2 must 404
        with pytest.raises(HTTPException) as exc_info:
            get_case_evidence_by_id(
                api_test_data["case_2_id"],
                api_test_data["evidence_id"],
                conn=conn_2,
            )
        assert exc_info.value.status_code == 404
    finally:
        close_case_db(conn_2)


def test_upload_case_evidence_and_auto_parse(api_test_data):
    conn_2 = open_case_db(api_test_data["case_2_db"])
    try:
        new_log = (
            "Jan 16 11:00:00 server sshd[9999]: Accepted password for analyst from 172.16.0.5 port 44321 ssh2\n"
        ).encode("utf-8")

        upload = UploadFile(
            filename="new_auth.log",
            file=io.BytesIO(new_log),
            headers={"content-type": "text/plain"},
        )

        res = upload_case_evidence(
            case_id=api_test_data["case_2_id"],
            file=upload,
            format_name="OPENSSH",
            auto_process=True,
            conn=conn_2,
        )

        assert res.caseId == api_test_data["case_2_id"]
        assert res.originalName == "new_auth.log"
        assert res.format == "OPENSSH"
        assert res.parserStatus == "PARSED"
        assert res.totalLines == 1
        assert res.parsedLines == 1

        # Check evidence list reflects new upload
        evidence_list = list_case_evidence(api_test_data["case_2_id"], conn=conn_2)
        assert len(evidence_list) == 1

        # Check events were auto-persisted
        events_res = list_case_events(api_test_data["case_2_id"], conn=conn_2)
        assert events_res.total == 1
        assert events_res.items[0].eventType == "AUTH_SUCCESS"
        assert events_res.items[0].userValue == "analyst"
    finally:
        close_case_db(conn_2)


def test_upload_duplicate_evidence_conflict(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        existing_log = (
            "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
            "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        ).encode("utf-8")

        upload = UploadFile(
            filename="duplicate.log",
            file=io.BytesIO(existing_log),
        )

        with pytest.raises(HTTPException) as exc_info:
            upload_case_evidence(
                case_id=api_test_data["case_1_id"],
                file=upload,
                conn=conn_1,
            )
        assert exc_info.value.status_code == 409
    finally:
        close_case_db(conn_1)


# ---------------------------------------------------------------------------
# Events Endpoints Tests
# ---------------------------------------------------------------------------

def test_list_case_events(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res = list_case_events(api_test_data["case_1_id"], conn=conn_1)
        assert res.total == 2
        assert len(res.items) == 2
        assert res.page == 1
        assert res.pageSize == 50

        types = {ev.eventType for ev in res.items}
        assert "AUTH_FAILURE" in types
        assert "AUTH_SUCCESS" in types
    finally:
        close_case_db(conn_1)


def test_events_case_isolation(api_test_data):
    """Case 2 must have 0 events initially, strictly isolated from Case 1."""
    conn_2 = open_case_db(api_test_data["case_2_db"])
    try:
        res = list_case_events(api_test_data["case_2_id"], conn=conn_2)
        assert res.total == 0
        assert len(res.items) == 0
    finally:
        close_case_db(conn_2)


def test_events_pagination(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        # Page 1 of size 1
        page1 = list_case_events(api_test_data["case_1_id"], page=1, page_size=1, conn=conn_1)
        assert page1.total == 2
        assert len(page1.items) == 1
        assert page1.totalPages == 2

        # Page 2 of size 1
        page2 = list_case_events(api_test_data["case_1_id"], page=2, page_size=1, conn=conn_1)
        assert page2.total == 2
        assert len(page2.items) == 1
        assert page2.items[0].eventId != page1.items[0].eventId
    finally:
        close_case_db(conn_1)


def test_events_filter_type(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res = list_case_events(
            api_test_data["case_1_id"],
            event_type="AUTH_FAILURE",
            conn=conn_1,
        )
        assert res.total == 1
        assert res.items[0].eventType == "AUTH_FAILURE"
        assert res.items[0].userValue == "hacker"
    finally:
        close_case_db(conn_1)


def test_events_filter_severity(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res = list_case_events(
            api_test_data["case_1_id"],
            severity="WARNING",
            conn=conn_1,
        )
        assert res.total == 1
        assert res.items[0].severity == "WARNING"
    finally:
        close_case_db(conn_1)


def test_events_filter_user(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res_hacker = list_case_events(
            api_test_data["case_1_id"],
            user="hacker",
            conn=conn_1,
        )
        assert res_hacker.total == 1
        assert res_hacker.items[0].userValue == "hacker"

        res_none = list_case_events(
            api_test_data["case_1_id"],
            user="nonexistent_user",
            conn=conn_1,
        )
        assert res_none.total == 0
    finally:
        close_case_db(conn_1)


def test_events_filter_src_ip(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res_ip = list_case_events(
            api_test_data["case_1_id"],
            src_ip="192.168.1.100",
            conn=conn_1,
        )
        assert res_ip.total == 1
        assert res_ip.items[0].srcIp == "192.168.1.100"

        res_none = list_case_events(
            api_test_data["case_1_id"],
            src_ip="203.0.113.99",
            conn=conn_1,
        )
        assert res_none.total == 0
    finally:
        close_case_db(conn_1)


def test_events_filter_time_range(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        res_window = list_case_events(
            api_test_data["case_1_id"],
            from_time="Jan 15 10:20:00",
            to_time="Jan 15 10:20:45",
            conn=conn_1,
        )
        assert res_window.total == 1
        assert res_window.items[0].timestampOriginal == "Jan 15 10:20:30"
    finally:
        close_case_db(conn_1)


def test_events_search_fts5_and_like(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        # Search by message text via FTS5
        res_hacker = list_case_events(
            api_test_data["case_1_id"],
            search="hacker",
            conn=conn_1,
        )
        assert res_hacker.total == 1
        assert "hacker" in res_hacker.items[0].message

        # Search by IP
        res_ip = list_case_events(
            api_test_data["case_1_id"],
            search="10.0.0.1",
            conn=conn_1,
        )
        assert res_ip.total == 1
        assert res_ip.items[0].srcIp == "10.0.0.1"

        # Search non-matching term
        res_none = list_case_events(
            api_test_data["case_1_id"],
            search="nonexistent_needle_xyz",
            conn=conn_1,
        )
        assert res_none.total == 0
    finally:
        close_case_db(conn_1)


def test_get_case_event_by_id_success(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        list_res = list_case_events(api_test_data["case_1_id"], conn=conn_1)
        target_event = list_res.items[0]

        ev = get_case_event_by_id(
            api_test_data["case_1_id"],
            target_event.eventId,
            conn=conn_1,
        )
        assert ev.eventId == target_event.eventId
        assert ev.caseId == api_test_data["case_1_id"]
        assert ev.eventHash == target_event.eventHash
        assert ev.lineNumber is not None
        assert ev.byteStart is not None
        assert ev.byteEnd is not None
        # Provenance and raw evidence line checks
        assert ev.evidenceId == api_test_data["evidence_id"]
        assert ev.rawRecordId is not None
        assert ev.recordNo is not None
        assert ev.rawText is not None
        assert "sshd" in ev.rawText
        assert ev.evidenceOriginalName == "auth.log"
        assert ev.evidenceFormat == "OPENSSH"
    finally:
        close_case_db(conn_1)


def test_get_case_event_by_id_not_found(api_test_data):
    conn_1 = open_case_db(api_test_data["case_1_db"])
    try:
        with pytest.raises(HTTPException) as exc_info:
            get_case_event_by_id(
                api_test_data["case_1_id"],
                "EVT_NONEXISTENT",
                conn=conn_1,
            )
        assert exc_info.value.status_code == 404
    finally:
        close_case_db(conn_1)
