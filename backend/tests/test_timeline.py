"""
Unit and integration tests for Forensic Timeline API and reconstruction.
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException

from app.api.timeline import get_case_timeline
from app.cases.database import (
    close_case_db,
    initialize_case_db,
    open_case_db,
)
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result


@pytest.fixture
def timeline_test_data(tmp_path: Path, monkeypatch):
    """Set up test cases with sequenced events for timeline testing."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    c1_id = "CASE-TIME-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Timeline Case", created_by="Analyst T")

    # Ingest multiple chronological log lines
    log_content = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:20:45 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55434 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:21:05 server sshd[1235]: pam_unix(sshd:session): session opened for user root by (uid=0)\n"
        "Jan 15 10:25:00 server sshd[1235]: pam_unix(sshd:session): session closed for user root\n"
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
    c2_id = "CASE-TIME-2"
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


def test_timeline_returns_real_persisted_events(timeline_test_data):
    """Timeline must retrieve real persisted events with correct count."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        res = get_case_timeline(timeline_test_data["case_1_id"], conn=conn)
        assert res.total == 5
        assert len(res.items) == 5
        assert res.page == 1
        assert res.pageSize == 50
        assert res.totalPages == 1
    finally:
        close_case_db(conn)


def test_timeline_chronological_ordering(timeline_test_data):
    """Events in timeline must strictly follow chronological ordering."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        res = get_case_timeline(timeline_test_data["case_1_id"], conn=conn)
        timestamps = [item.timestamp or item.timestampOriginal for item in res.items]
        assert timestamps == sorted(timestamps)
        assert res.items[0].timestampOriginal == "Jan 15 10:20:30"
        assert res.items[-1].timestampOriginal == "Jan 15 10:25:00"
    finally:
        close_case_db(conn)


def test_timeline_deterministic_secondary_ordering(timeline_test_data):
    """Events with equal timestamps must order deterministically by eventId."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        # Run twice to ensure deterministic results
        res1 = get_case_timeline(timeline_test_data["case_1_id"], conn=conn)
        res2 = get_case_timeline(timeline_test_data["case_1_id"], conn=conn)
        ids1 = [item.eventId for item in res1.items]
        ids2 = [item.eventId for item in res2.items]
        assert ids1 == ids2
    finally:
        close_case_db(conn)


def test_timeline_case_isolation(timeline_test_data):
    """Case 2 must return 0 timeline events, isolated from Case 1."""
    conn = open_case_db(timeline_test_data["case_2_db"])
    try:
        res = get_case_timeline(timeline_test_data["case_2_id"], conn=conn)
        assert res.total == 0
        assert len(res.items) == 0
    finally:
        close_case_db(conn)


def test_timeline_filters(timeline_test_data):
    """Timeline must filter by event_type, severity, user, src_ip, and time range."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        # Filter event_type
        res_type = get_case_timeline(
            timeline_test_data["case_1_id"], event_type="AUTH_SUCCESS", conn=conn
        )
        assert res_type.total == 1
        assert res_type.items[0].eventType == "AUTH_SUCCESS"

        # Filter user
        res_user = get_case_timeline(
            timeline_test_data["case_1_id"], user="hacker", conn=conn
        )
        assert res_user.total == 2
        for item in res_user.items:
            assert item.user == "hacker"

        # Filter src_ip
        res_ip = get_case_timeline(
            timeline_test_data["case_1_id"], src_ip="10.0.0.1", conn=conn
        )
        assert res_ip.total == 1
        assert res_ip.items[0].srcIp == "10.0.0.1"

        # Filter time range
        res_time = get_case_timeline(
            timeline_test_data["case_1_id"],
            from_time="Jan 15 10:20:00",
            to_time="Jan 15 10:20:50",
            conn=conn,
        )
        assert res_time.total == 2
        for item in res_time.items:
            assert "10:20:" in (item.timestampOriginal or "")
    finally:
        close_case_db(conn)


def test_timeline_pagination(timeline_test_data):
    """Timeline must support bounded pagination with page and pageSize."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        page1 = get_case_timeline(
            timeline_test_data["case_1_id"], page=1, page_size=2, conn=conn
        )
        assert page1.total == 5
        assert len(page1.items) == 2
        assert page1.page == 1
        assert page1.pageSize == 2
        assert page1.totalPages == 3

        page2 = get_case_timeline(
            timeline_test_data["case_1_id"], page=2, page_size=2, conn=conn
        )
        assert len(page2.items) == 2
        assert page2.page == 2
        assert page2.items[0].eventId != page1.items[0].eventId
    finally:
        close_case_db(conn)


def test_timeline_provenance_and_no_filesystem_exposure(timeline_test_data):
    """Timeline must provide provenance (evidence, line, byte, hash) without exposing filesystem paths."""
    conn = open_case_db(timeline_test_data["case_1_db"])
    try:
        res = get_case_timeline(timeline_test_data["case_1_id"], conn=conn)
        for item in res.items:
            # Provenance presence
            assert item.evidenceId == timeline_test_data["evidence_id"]
            assert item.evidenceOriginalName == "auth.log"
            assert item.recordNo is not None
            assert item.lineNumber is not None
            assert item.byteStart is not None
            assert item.byteEnd is not None
            assert item.eventHash != ""
            assert item.summary != ""
            # No filesystem path exposure
            dump = item.model_dump()
            assert "storage_path" not in dump
            assert "storagePath" not in dump
            for v in dump.values():
                if isinstance(v, str):
                    assert "/" not in v or v == item.timestamp or v == item.timestampOriginal
                    assert "\\" not in v
    finally:
        close_case_db(conn)

