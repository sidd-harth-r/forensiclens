"""
Unit and integration tests for deterministic forensic session reconstruction.
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException

from app.api.sessions import get_case_session_by_id, list_case_sessions
from app.cases.database import (
    close_case_db,
    initialize_case_db,
    open_case_db,
)
from app.correlation.sessions import (
    DEFAULT_SESSION_GAP_SECONDS,
    reconstruct_sessions,
)
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result


@pytest.fixture
def session_test_data(tmp_path: Path, monkeypatch):
    """Set up test cases with multi-user, multi-IP events for session correlation."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    c1_id = "CASE-SES-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Session Case", created_by="Analyst S")

    # Ingest logs containing:
    # 1. Attacker 'hacker' from 192.168.1.100 (2 failed attempts)
    # 2. Legitimate user 'admin' from 10.0.0.1 (login -> open -> closed within 2 mins)
    # 3. Later user 'admin' from 10.0.0.1 after 15 mins (new session, open without close)
    log_content = (
        "Jan 15 10:00:00 server sshd[1001]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:00:20 server sshd[1001]: Failed password for invalid user hacker from 192.168.1.100 port 55434 ssh2\n"
        "Jan 15 10:01:00 server sshd[1002]: Accepted password for admin from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:01:05 server sshd[1002]: pam_unix(sshd:session): session opened for user admin by (uid=0)\n"
        "Jan 15 10:03:00 server sshd[1002]: pam_unix(sshd:session): session closed for user admin\n"
        "Jan 15 10:30:00 server sshd[2001]: Accepted password for admin from 10.0.0.1 port 55450 ssh2\n"
        "Jan 15 10:30:05 server sshd[2001]: pam_unix(sshd:session): session opened for user admin by (uid=0)\n"
    ).encode("utf-8")

    ev_record = ingest_evidence(
        conn=conn_1,
        case_dir=c1_dir,
        case_id=c1_id,
        source=io.BytesIO(log_content),
        original_name="auth.log",
        format_name="OPENSSH",
    )

    parser = OpenSSHParser()
    parse_result = parser.parse(ev_record.storage_path, evidence_id=ev_record.evidence_id)
    persist_parse_result(case_id=c1_id, parse_result=parse_result, conn=conn_1)

    # Empty case for isolation checks
    c2_id = "CASE-SES-2"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Empty Case", created_by="Analyst E")

    close_case_db(conn_1)
    close_case_db(conn_2)

    return {
        "case_1_id": c1_id,
        "case_2_id": c2_id,
        "case_1_db": c1_db,
        "case_2_db": c2_db,
        "evidence_id": ev_record.evidence_id,
    }


def test_session_reconstruction_groups_same_user_and_ip(session_test_data):
    """Events with same user + IP + temporal proximity must form a single session."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        # Should have 3 sessions:
        # 1. hacker from 192.168.1.100 (2 events, INCOMPLETE)
        # 2. admin from 10.0.0.1 (3 events, CLOSED)
        # 3. admin from 10.0.0.1 at 10:30 (2 events, OPEN)
        assert res.total == 3
        assert len(res.items) == 3

        # Verify hacker session
        hacker_ses = next(s for s in res.items if s.user == "hacker")
        assert hacker_ses.eventCount == 2
        assert hacker_ses.srcIp == "192.168.1.100"
        assert hacker_ses.status == "INCOMPLETE"

        # Verify first admin session (closed)
        closed_admin = next(s for s in res.items if s.user == "admin" and s.status == "CLOSED")
        assert closed_admin.eventCount == 3
        assert closed_admin.srcIp == "10.0.0.1"
        assert closed_admin.durationSeconds == 120  # 10:01:00 to 10:03:00 = 120s
        assert any("SESSION_CLOSED" in b for b in closed_admin.correlationBasis)
    finally:
        close_case_db(conn)


def test_different_users_do_not_merge(session_test_data):
    """Events from different users at similar times must NOT be merged into one session."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        for s in res.items:
            # Each session must belong to only one actor
            users = {ev.user for ev in s.events if ev.user}
            assert len(users) <= 1
    finally:
        close_case_db(conn)


def test_events_outside_threshold_form_separate_sessions(session_test_data):
    """Events from the same actor separated by > 300s must split into distinct sessions."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res = list_case_sessions(
            session_test_data["case_1_id"], user="admin", conn=conn
        )
        # Admin had a session at 10:01-10:03, then another at 10:30 (>300s gap)
        assert res.total == 2
        assert res.items[0].sessionId != res.items[1].sessionId
        assert res.items[0].status == "CLOSED"
        assert res.items[1].status == "OPEN"
    finally:
        close_case_db(conn)


def test_missing_session_closed_produces_open_status(session_test_data):
    """A session with AUTH_SUCCESS and SESSION_OPENED but no closure event is marked OPEN."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res = list_case_sessions(
            session_test_data["case_1_id"], user="admin", status_filter="OPEN", conn=conn
        )
        assert res.total == 1
        assert res.items[0].status == "OPEN"
        assert res.items[0].eventCount == 2
    finally:
        close_case_db(conn)


def test_session_ids_are_deterministic(session_test_data):
    """Reconstructing sessions multiple times must produce identical deterministic IDs."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res1 = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        res2 = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        ids1 = [s.sessionId for s in res1.items]
        ids2 = [s.sessionId for s in res2.items]
        assert ids1 == ids2
        assert ids1 == [
            f"SES_{session_test_data['case_1_id']}_001",
            f"SES_{session_test_data['case_1_id']}_002",
            f"SES_{session_test_data['case_1_id']}_003",
        ]
    finally:
        close_case_db(conn)


def test_session_case_isolation(session_test_data):
    """Case 2 must have 0 sessions, strictly isolated from Case 1."""
    conn = open_case_db(session_test_data["case_2_db"])
    try:
        res = list_case_sessions(session_test_data["case_2_id"], conn=conn)
        assert res.total == 0
        assert len(res.items) == 0
    finally:
        close_case_db(conn)


def test_get_session_by_id_success(session_test_data):
    """Retrieving a single session by ID must return complete event sequence and provenance."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        list_res = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        target_id = list_res.items[1].sessionId

        s = get_case_session_by_id(
            session_test_data["case_1_id"], target_id, conn=conn
        )
        assert s.sessionId == target_id
        assert s.user == "admin"
        assert s.status == "CLOSED"
        assert len(s.events) == 3
        assert s.events[0].eventType == "AUTH_SUCCESS"
        assert s.events[1].eventType == "SESSION_OPENED"
        assert s.events[2].eventType == "SESSION_CLOSED"
        assert s.events[0].evidenceId == session_test_data["evidence_id"]
        assert s.events[0].evidenceOriginalName == "auth.log"
    finally:
        close_case_db(conn)


def test_get_session_by_id_not_found(session_test_data):
    """Requesting an invalid or non-existent session ID must raise HTTP 404."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        with pytest.raises(HTTPException) as exc_info:
            get_case_session_by_id(
                session_test_data["case_1_id"], "SES_NONEXISTENT", conn=conn
            )
        assert exc_info.value.status_code == 404
    finally:
        close_case_db(conn)


def test_unattributed_events_do_not_force_unsafe_correlation():
    """Events without user or IP must not be forcefully correlated with other events."""
    raw_events = [
        {
            "event_id": "EVT_1",
            "timestamp_utc": "2026-01-15T10:00:00Z",
            "event_type": "GENERIC_LOG",
            "message": "System check ok",
            "user_value": None,
            "src_ip": None,
        },
        {
            "event_id": "EVT_2",
            "timestamp_utc": "2026-01-15T10:00:10Z",
            "event_type": "GENERIC_LOG",
            "message": "Another system check",
            "user_value": None,
            "src_ip": None,
        },
    ]
    sessions = reconstruct_sessions(raw_events, case_id="CASE-TEST")
    assert len(sessions) == 2  # Separated, not merged
    assert sessions[0].sessionId != sessions[1].sessionId
    assert sessions[0].status == "INCOMPLETE"
    assert any("Unattributed" in b for b in sessions[0].correlationBasis)


def test_no_filesystem_paths_exposed_in_sessions(session_test_data):
    """Sessions API models must never expose internal storage_path."""
    conn = open_case_db(session_test_data["case_1_db"])
    try:
        res = list_case_sessions(session_test_data["case_1_id"], conn=conn)
        for s in res.items:
            dump = s.model_dump()
            assert "storage_path" not in dump
            assert "storagePath" not in dump
            for ev in s.events:
                ev_dump = ev.model_dump()
                assert "storage_path" not in ev_dump
                assert "storagePath" not in ev_dump
    finally:
        close_case_db(conn)

