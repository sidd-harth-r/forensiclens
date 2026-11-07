"""
Unit tests for Lexical Retrieval Service (FTS5).
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest

from app.cases.database import close_case_db, initialize_case_db, open_case_db
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result
from app.retrieval.lexical import LexicalSearchService, sanitize_fts5_query
from app.retrieval.schemas import RetrievalFilters


@pytest.fixture
def lexical_test_env(tmp_path: Path, monkeypatch):
    """Set up test cases with parsed evidence and unparsed raw records."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # Case 1: Ingest log file with multiple events and an unparsed line
    c1_id = "CASE-LEX-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Lexical Case 1", created_by="Analyst L")

    log_content = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:20:45 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55434 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:21:05 server sshd[1235]: pam_unix(sshd:session): session opened for user root by (uid=0)\n"
        "UNPARSED NONSTANDARD LOG ENTRY WITHOUT SSHD MARKER WITH CUSTOM_TOKEN_ALPHA\n"
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

    # Case 2: Separate case for isolation checks
    c2_id = "CASE-LEX-2"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Lexical Case 2", created_by="Analyst L2")

    c2_log = "Jan 16 11:00:00 server sshd[9999]: Accepted password for alice from 172.16.0.5 port 2222 ssh2\n".encode("utf-8")
    ev2 = ingest_evidence(
        conn=conn_2,
        case_dir=c2_dir,
        case_id=c2_id,
        source=io.BytesIO(c2_log),
        original_name="auth2.log",
        format_name="OPENSSH",
    )
    res2 = parser.parse(ev2.storage_path, evidence_id=ev2.evidence_id)
    persist_parse_result(case_id=c2_id, parse_result=res2, conn=conn_2)

    yield {
        "cases_dir": cases_dir,
        "case_1_id": c1_id,
        "case_1_db": c1_db,
        "case_2_id": c2_id,
        "case_2_db": c2_db,
    }

    close_case_db(conn_1)
    close_case_db(conn_2)


def test_sanitize_fts5_query():
    """Verify FTS5 query sanitizer handles special characters and creates valid match queries."""
    assert sanitize_fts5_query("") == ""
    assert sanitize_fts5_query("   ") == ""
    # Single term
    assert '"hacker"*' in sanitize_fts5_query("hacker")
    # IP address should be quoted phrase
    assert '"192.168.1.100"' in sanitize_fts5_query("192.168.1.100")
    # Preserves user quotes
    sanitized = sanitize_fts5_query('"Failed password" hacker')
    assert '"Failed password"' in sanitized
    assert '"hacker"*' in sanitized
    # Special punctuation stripped or handled without error
    weird = sanitize_fts5_query("admin:root (sshd) [1234] --drop table;")
    assert "admin:root" in weird or "admin" in weird


def test_lexical_keyword_retrieval(lexical_test_env):
    """Exact keyword retrieval finds matching records with positive rank score."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "Accepted password")
        assert len(results) >= 1
        assert any("Accepted password for root" in r.document.raw_text for r in results)
        assert results[0].rank == 1
        assert results[0].score > 0
    finally:
        close_case_db(conn)


def test_lexical_username_retrieval(lexical_test_env):
    """Usernames (e.g. 'hacker') are discovered across raw lines and event fields."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "hacker")
        assert len(results) == 2
        for r in results:
            assert "hacker" in r.document.raw_text
            assert r.document.user_value == "hacker"
    finally:
        close_case_db(conn)


def test_lexical_ip_address_retrieval(lexical_test_env):
    """IP addresses (e.g. '192.168.1.100') are discovered accurately."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "192.168.1.100")
        assert len(results) == 2
        for r in results:
            assert "192.168.1.100" in r.document.raw_text
            assert r.document.src_ip == "192.168.1.100"
    finally:
        close_case_db(conn)


def test_lexical_unparsed_line_retrieval(lexical_test_env):
    """Unparsed raw source records without normalized events are retrievable via raw_records_fts."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "CUSTOM_TOKEN_ALPHA")
        assert len(results) == 1
        doc = results[0].document
        assert "CUSTOM_TOKEN_ALPHA" in doc.raw_text
        assert doc.event_id is None  # Unparsed line has no event
        assert doc.record_no == 5
    finally:
        close_case_db(conn)


def test_lexical_case_isolation(lexical_test_env):
    """Case isolation is strictly enforced; searching for Case 2 data in Case 1 yields zero results."""
    service = LexicalSearchService()
    conn1 = open_case_db(lexical_test_env["case_1_db"])
    try:
        # 'alice' exists only in Case 2
        results = service.search(conn1, lexical_test_env["case_1_id"], "alice")
        assert len(results) == 0
    finally:
        close_case_db(conn1)


def test_lexical_parameterized_query_handling(lexical_test_env):
    """Malicious SQL injection attempts or malformed queries do not execute SQL or fail."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        injection_queries = [
            "' OR '1'='1",
            "admin'; DROP TABLE raw_records; --",
            '":*^~()[]',
            "NOT OR AND",
        ]
        for bad_q in injection_queries:
            results = service.search(conn, lexical_test_env["case_1_id"], bad_q)
            # Should not raise exception; returns list (possibly empty)
            assert isinstance(results, list)
    finally:
        close_case_db(conn)


def test_lexical_empty_results(lexical_test_env):
    """Nonexistent search terms return an empty list."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "quantum_nonexistent_xyz_99")
        assert results == []
    finally:
        close_case_db(conn)


def test_lexical_candidate_limits(lexical_test_env):
    """Candidate limit strictly bounds the number of returned results."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "server", limit=2)
        assert len(results) <= 2
    finally:
        close_case_db(conn)


def test_lexical_provenance_preservation(lexical_test_env):
    """Retrieved document preserves full provenance attributes for exact source verification."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        results = service.search(conn, lexical_test_env["case_1_id"], "Accepted password")
        assert len(results) >= 1
        doc = results[0].document
        assert doc.document_id.startswith("DOC_CASE-LEX-1_RAW_")
        assert doc.raw_record_id.startswith("RAW_")
        assert doc.evidence_id.startswith("EV_")
        assert doc.original_filename == "auth.log"
        assert doc.record_no == 3
        assert doc.line_number == 3
        assert doc.raw_text.startswith("Jan 15 10:21:00")
        assert doc.event_id is not None
        assert doc.event_type == "AUTH_SUCCESS"
        assert doc.user_value == "root"
        assert doc.src_ip == "10.0.0.1"
    finally:
        close_case_db(conn)


def test_lexical_structured_filters(lexical_test_env):
    """Structured filters narrow results appropriately alongside FTS keywords."""
    service = LexicalSearchService()
    conn = open_case_db(lexical_test_env["case_1_db"])
    try:
        # Search for 'server', filter by user='root'
        filters = RetrievalFilters(user="root")
        results = service.search(conn, lexical_test_env["case_1_id"], "server", filters=filters)
        assert len(results) > 0
        for r in results:
            assert "root" in r.document.raw_text or r.document.user_value == "root"

        # Filter by event_type='AUTH_FAILURE'
        filters_fail = RetrievalFilters(eventType="AUTH_FAILURE")
        fail_results = service.search(conn, lexical_test_env["case_1_id"], "server", filters=filters_fail)
        assert len(fail_results) == 2
        for r in fail_results:
            assert r.document.event_type == "AUTH_FAILURE"
    finally:
        close_case_db(conn)
