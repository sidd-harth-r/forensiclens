"""
Concurrency regression tests for request-scoped SQLite connections.

Background
----------
``get_case_connection`` / ``get_readonly_case_connection`` (app/api/deps.py) are
sync ``yield`` dependencies. FastAPI runs a sync dependency's setup, the sync
endpoint and the dependency's teardown on threadpool workers that may differ.
With sqlite3's default ``check_same_thread=True`` this raised

    sqlite3.ProgrammingError: SQLite objects created in a thread can only be
    used in that same thread.

under concurrent load (and silently leaked connections whose close() ran on
another thread). These tests drive the real ASGI app through TestClient from
many client threads at once so the server-side endpoints genuinely execute on
multiple threadpool workers.

They also verify that:
    * every affected request gets its own connection (none is shared between
      concurrent requests) and every connection is closed exactly once;
    * the default thread-affinity protection is unchanged for other callers;
    * a failed close is logged rather than silently swallowed.
"""

from __future__ import annotations

import io
import logging
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.api.deps as deps
from app.evidence.storage import get_evidence_path
from app.cases.database import (
    close_case_db,
    initialize_case_db,
    open_case_db,
    open_case_db_readonly,
)
from main import app

CASE_ID = "CASE-CONC"
WORKERS = 16


def _auth_log(tag: str, lines: int = 6) -> bytes:
    """Distinct OpenSSH log content per tag (distinct SHA-256 → no duplicate rejection)."""
    out = []
    for i in range(lines):
        out.append(
            f"Jan 15 10:{20 + i:02d}:{i:02d} host-{tag} sshd[{1000 + i}]: "
            f"Failed password for invalid user u{tag}{i} from 10.0.{i}.{len(tag)} port {40000 + i} ssh2"
        )
    out.append(
        f"Jan 15 10:59:59 host-{tag} sshd[1999]: Accepted password for root from 10.9.9.9 port 50000 ssh2"
    )
    return ("\n".join(out) + "\n").encode("utf-8")


@pytest.fixture
def case_env(tmp_path: Path, monkeypatch):
    """Isolated data directory with one initialized, empty case."""
    cases_dir = tmp_path / "cases"
    case_dir = cases_dir / CASE_ID
    case_dir.mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    conn = initialize_case_db(case_dir / "case.db", CASE_ID, "Concurrency Case", created_by="pytest")
    close_case_db(conn)
    return case_dir


@pytest.fixture
def client(case_env):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def connection_tracker(monkeypatch):
    """
    Wraps the request-scoped connection dependencies' open/close calls to record
    every connection opened for a request and every close performed on it.
    Real sqlite3 connections are used throughout; only bookkeeping is added.
    References are kept so object identities cannot be recycled during a test.
    """
    lock = threading.Lock()
    state = {"opened": [], "closed": [], "close_errors": []}

    real_open = deps.open_case_db
    real_open_ro = deps.open_case_db_readonly
    real_close = deps.close_case_db

    def tracked_open(*args, **kwargs):
        conn = real_open(*args, **kwargs)
        with lock:
            state["opened"].append((conn, kwargs.get("check_same_thread", True)))
        return conn

    def tracked_open_ro(*args, **kwargs):
        conn = real_open_ro(*args, **kwargs)
        with lock:
            state["opened"].append((conn, kwargs.get("check_same_thread", True)))
        return conn

    def tracked_close(conn):
        real_close(conn)
        # A closed connection rejects all use; anything else means close() failed.
        try:
            conn.execute("SELECT 1")
            closed_ok = False
        except sqlite3.ProgrammingError:
            closed_ok = True
        with lock:
            state["closed"].append(conn)
            if not closed_ok:
                state["close_errors"].append(conn)

    monkeypatch.setattr(deps, "open_case_db", tracked_open)
    monkeypatch.setattr(deps, "open_case_db_readonly", tracked_open_ro)
    monkeypatch.setattr(deps, "close_case_db", tracked_close)
    return state


def _ingest(client: TestClient, tag: str, auto_process: bool = False):
    return client.post(
        f"/api/cases/{CASE_ID}/evidence",
        files={"file": (f"auth-{tag}.log", io.BytesIO(_auth_log(tag)), "text/plain")},
        data={"format_name": "OPENSSH", "auto_process": "true" if auto_process else "false"},
    )


def _assert_cleanup(tracker: dict, expected_requests: int) -> None:
    opened = [c for c, _ in tracker["opened"]]
    # One fresh connection per request that used an affected dependency.
    assert len(opened) == expected_requests
    # No connection object was handed to more than one request.
    assert len({id(c) for c in opened}) == len(opened)
    # Every request-scoped connection relaxed the check (and only those did).
    assert all(flag is False for _, flag in tracker["opened"])
    # Every connection was closed exactly once, and the close actually succeeded.
    assert len(tracker["closed"]) == len(opened)
    assert {id(c) for c in tracker["closed"]} == {id(c) for c in opened}
    assert tracker["close_errors"] == []


# ---------------------------------------------------------------------------
# Concurrent reads across every route that uses the affected dependencies
# ---------------------------------------------------------------------------


def test_concurrent_reads_across_affected_routes(client, connection_tracker):
    # Seed: two processed evidence artifacts (sequential, setup only).
    seeded = []
    for tag in ("seed-a", "seed-b"):
        resp = _ingest(client, tag, auto_process=True)
        assert resp.status_code == 201, resp.text
        seeded.append(resp.json()["evidenceId"])

    events = client.get(f"/api/cases/{CASE_ID}/events", params={"pageSize": 5}).json()["items"]
    sessions = client.get(f"/api/cases/{CASE_ID}/sessions", params={"pageSize": 5}).json()["items"]
    assert events, "seed data produced no events"
    assert sessions, "seed data produced no sessions"

    base = f"/api/cases/{CASE_ID}"
    paths = [
        f"{base}/evidence",
        f"{base}/evidence/{seeded[0]}",
        f"{base}/events?page=1&pageSize=10",
        f"{base}/events/{events[0]['eventId']}",
        f"{base}/timeline?page=1&pageSize=10",
        f"{base}/sessions?page=1&pageSize=10",
        f"{base}/sessions/{sessions[0]['sessionId']}",
    ]
    # Reset bookkeeping so only the concurrent phase is measured.
    connection_tracker["opened"].clear()
    connection_tracker["closed"].clear()

    requests_to_send = paths * 12  # 84 concurrent requests
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda p: (p, client.get(p)), requests_to_send))

    failures = [(p, r.status_code, r.text[:200]) for p, r in results if r.status_code != 200]
    assert failures == []
    _assert_cleanup(connection_tracker, expected_requests=len(requests_to_send))


# ---------------------------------------------------------------------------
# Concurrent writes: evidence ingestion and evidence processing
# ---------------------------------------------------------------------------


def test_concurrent_ingestion_and_processing(client, connection_tracker, case_env):
    tags = [f"w{i}" for i in range(8)]
    base = f"/api/cases/{CASE_ID}"

    # Phase 1 — concurrent ingestion interleaved with concurrent reads.
    def ingest_task(tag):
        return ("ingest", tag, _ingest(client, tag))

    def read_task(_):
        return ("read", None, client.get(f"{base}/evidence"))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(ingest_task, t) for t in tags] + [pool.submit(read_task, i) for i in range(16)]
        phase1 = [f.result() for f in futures]

    ingest_results = [r for kind, _, r in phase1 if kind == "ingest"]
    read_results = [r for kind, _, r in phase1 if kind == "read"]
    assert [r.status_code for r in ingest_results] == [201] * len(tags), [r.text for r in ingest_results]
    assert all(r.status_code == 200 for r in read_results), [r.text for r in read_results if r.status_code != 200]
    evidence_ids = [r.json()["evidenceId"] for r in ingest_results]
    assert len(set(evidence_ids)) == len(tags)

    # Phase 2 — evidence processing (writes) running concurrently with a read storm.
    # Processing requests are issued from one client thread so that only one
    # parse-persistence writer is active at a time (concurrent *writers* hit a
    # separate, pre-existing persistence defect — see the xfail test below);
    # every request still executes on server threadpool workers concurrently
    # with the readers, which is what the thread-affinity fix must survive.
    def process_all():
        return [("process", eid, client.post(f"{base}/evidence/{eid}/process", json={})) for eid in evidence_ids]

    read_paths = [f"{base}/events?page=1&pageSize=20", f"{base}/timeline?page=1&pageSize=20", f"{base}/evidence"]

    def read_storm(i):
        return ("read", None, client.get(read_paths[i % len(read_paths)]))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        writer = pool.submit(process_all)
        readers = [pool.submit(read_storm, i) for i in range(48)]
        phase2 = writer.result() + [f.result() for f in readers]

    process_results = {eid: r for kind, eid, r in phase2 if kind == "process"}
    for eid, r in process_results.items():
        assert r.status_code == 200, (eid, r.text)
        body = r.json()
        assert body["evidenceId"] == eid
        assert body["eventsCount"] > 0
    assert all(r.status_code == 200 for kind, _, r in phase2 if kind == "read")

    # Every request (ingest, process, reads) used its own connection, all closed.
    _assert_cleanup(connection_tracker, expected_requests=len(phase1) + len(phase2))

    # Persisted state is complete and consistent after concurrent writes.
    conn = open_case_db(case_env / "case.db")
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM evidence_files").fetchone()[0] == len(tags)
        statuses = {row[0] for row in conn.execute("SELECT parser_status FROM evidence_files")}
        assert statuses <= {"PARSED", "PARTIAL"}
        per_evidence = dict(
            conn.execute("SELECT evidence_id, COUNT(*) FROM events GROUP BY evidence_id").fetchall()
        )
        for eid, r in process_results.items():
            assert per_evidence.get(eid) == r.json()["eventsCount"]
    finally:
        close_case_db(conn)


# ---------------------------------------------------------------------------
# Concurrent evidence processing (parse persistence write lock)
#
# Regression for: persist_parse_result opened a *deferred* transaction via
# SAVEPOINT. Its validation reads and the raw_records FTS5 trigger's config reads
# fixed a WAL read snapshot before the first INSERT; if another writer committed
# in between, the read->write upgrade failed with SQLITE_BUSY immediately (stale
# snapshot), bypassing busy_timeout. Persistence now takes the write reservation
# up front (BEGIN IMMEDIATE) when it owns the transaction.
# ---------------------------------------------------------------------------


def _assert_case_consistent(db_path: Path, evidence_results: dict) -> None:
    """
    Full persisted-state check for processed evidence:
      * per-evidence raw record / event counts match the processing responses;
      * both external-content FTS5 indexes pass integrity-check and are complete;
      * every event links to a raw record of the same evidence with identical
        line/byte provenance, and every raw record's text equals the exact bytes
        at [byte_start, byte_end) of the stored, hash-verified artifact.
    """
    conn = open_case_db(db_path)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        conn.execute("INSERT INTO events_fts(events_fts) VALUES('integrity-check')")
        conn.execute("INSERT INTO raw_records_fts(raw_records_fts) VALUES('integrity-check')")
        conn.rollback()
        assert conn.execute("SELECT COUNT(*) FROM events_fts").fetchone()[0] == conn.execute(
            "SELECT COUNT(*) FROM events"
        ).fetchone()[0]
        assert conn.execute("SELECT COUNT(*) FROM raw_records_fts").fetchone()[0] == conn.execute(
            "SELECT COUNT(*) FROM raw_records"
        ).fetchone()[0]

        for eid, body in evidence_results.items():
            raw_count = conn.execute("SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (eid,)).fetchone()[0]
            ev_count = conn.execute("SELECT COUNT(*) FROM events WHERE evidence_id = ?", (eid,)).fetchone()[0]
            assert raw_count == body["rawRecordsCount"], eid
            assert ev_count == body["eventsCount"], eid
            assert ev_count > 0, eid

            status = conn.execute(
                "SELECT parser_status FROM evidence_files WHERE evidence_id = ?", (eid,)
            ).fetchone()[0]
            assert status == body["status"] and status in {"PARSED", "PARTIAL"}, (eid, status)
            artifact = get_evidence_path(db_path.parent, eid).read_bytes()

            for raw_text, bs, be in conn.execute(
                "SELECT raw_text, byte_start, byte_end FROM raw_records WHERE evidence_id = ?", (eid,)
            ):
                assert artifact[bs:be].decode("utf-8").rstrip("\r\n") == raw_text.rstrip("\r\n")

            mismatched = conn.execute(
                """
                SELECT COUNT(*) FROM events e
                JOIN raw_records r ON r.raw_record_id = e.raw_record_id
                WHERE e.evidence_id = ?
                  AND (r.evidence_id != e.evidence_id OR r.case_id != e.case_id
                       OR r.line_number IS NOT e.line_number
                       OR r.byte_start IS NOT e.byte_start OR r.byte_end IS NOT e.byte_end)
                """,
                (eid,),
            ).fetchone()[0]
            orphaned = conn.execute(
                "SELECT COUNT(*) FROM events WHERE evidence_id = ? AND raw_record_id NOT IN (SELECT raw_record_id FROM raw_records)",
                (eid,),
            ).fetchone()[0]
            assert mismatched == 0 and orphaned == 0, eid
    finally:
        close_case_db(conn)


def _ingest_many(client: TestClient, prefix: str, n: int) -> list[str]:
    ids = []
    for i in range(n):
        resp = _ingest(client, f"{prefix}{i}")
        assert resp.status_code == 201, resp.text
        ids.append(resp.json()["evidenceId"])
    return ids


def _process_concurrently(client: TestClient, ids: list[str]) -> dict:
    base = f"/api/cases/{CASE_ID}"
    with ThreadPoolExecutor(max_workers=len(ids)) as pool:
        results = list(pool.map(lambda e: (e, client.post(f"{base}/evidence/{e}/process", json={})), ids))
    failures = [(e, r.status_code, r.text[:200]) for e, r in results if r.status_code != 200]
    assert failures == []
    return {e: r.json() for e, r in results}


def test_concurrent_processing_of_multiple_evidence(client, case_env):
    ids = _ingest_many(client, "p", 8)
    results = _process_concurrently(client, ids)
    assert set(results) == set(ids)
    _assert_case_consistent(case_env / "case.db", results)


def test_repeated_concurrent_processing_rounds(client, case_env):
    """Several back-to-back rounds of 8 concurrent writers in the same case database."""
    all_results: dict = {}
    for rnd in range(5):
        ids = _ingest_many(client, f"r{rnd}-", 8)
        all_results.update(_process_concurrently(client, ids))
    _assert_case_consistent(case_env / "case.db", all_results)


def test_failed_processing_rolls_back_without_partial_results(client, case_env, monkeypatch):
    """
    A failure part-way through persistence (after some raw records, events and FTS
    rows were written) must leave no partial parse result, release the write
    reservation for other writers, and allow the evidence to be reprocessed cleanly.
    """
    import app.parsers.persistence as persistence

    base = f"/api/cases/{CASE_ID}"
    victim, bystander = _ingest_many(client, "fail", 2)

    real_hash = persistence.compute_event_hash
    calls = {"n": 0}

    def failing_hash(*args, **kwargs):
        if kwargs.get("evidence_id") == victim:
            calls["n"] += 1
            if calls["n"] == 3:  # rows for two records are already written
                raise RuntimeError("injected persistence failure")
        return real_hash(*args, **kwargs)

    monkeypatch.setattr(persistence, "compute_event_hash", failing_hash)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_victim = pool.submit(client.post, f"{base}/evidence/{victim}/process", json={})
        f_bystander = pool.submit(client.post, f"{base}/evidence/{bystander}/process", json={})
        r_victim, r_bystander = f_victim.result(), f_bystander.result()

    assert calls["n"] == 3
    assert r_victim.status_code == 500 and "injected persistence failure" in r_victim.text
    assert r_bystander.status_code == 200, r_bystander.text  # lock was released

    conn = open_case_db(case_env / "case.db")
    try:
        for table in ("raw_records", "events"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE evidence_id = ?", (victim,)).fetchone()[0] == 0
        assert conn.execute(
            "SELECT parser_status FROM evidence_files WHERE evidence_id = ?", (victim,)
        ).fetchone()[0] == "FAILED"
        assert conn.in_transaction is False
    finally:
        close_case_db(conn)

    # Remove the fault: the same evidence now processes completely.
    monkeypatch.setattr(persistence, "compute_event_hash", real_hash)
    retry = client.post(f"{base}/evidence/{victim}/process", json={})
    assert retry.status_code == 200, retry.text
    _assert_case_consistent(case_env / "case.db", {victim: retry.json(), bystander: r_bystander.json()})


def _parse_for(case_dir: Path, evidence_id: str):
    from app.parsers.openssh import OpenSSHParser

    return OpenSSHParser().parse(get_evidence_path(case_dir, evidence_id), evidence_id=evidence_id)


def test_idempotency_check_is_atomic_under_concurrent_persistence(client, case_env):
    """
    Two writers persisting the same parse result at once: exactly one persists, the
    other is rejected as already persisted (the duplicate check now runs under the
    write reservation instead of before it).
    """
    from app.parsers.persistence import AlreadyPersistedError, persist_parse_result

    (evidence_id,) = _ingest_many(client, "idem", 1)
    parse_result = _parse_for(case_env, evidence_id)
    barrier = threading.Barrier(2)

    def writer():
        conn = open_case_db(case_env / "case.db")
        try:
            barrier.wait()
            return persist_parse_result(CASE_ID, parse_result, conn=conn)
        finally:
            close_case_db(conn)

    outcomes = []
    for box in [_run_in_thread_async(writer) for _ in range(2)]:
        box["thread"].join()
        outcomes.append(box.get("value") or box.get("error"))

    persisted = [o for o in outcomes if not isinstance(o, BaseException) and o.persisted]
    rejected = [o for o in outcomes if isinstance(o, AlreadyPersistedError)]
    assert len(persisted) == 1 and len(rejected) == 1, outcomes

    conn = open_case_db(case_env / "case.db")
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0] == persisted[0].raw_records_count
    finally:
        close_case_db(conn)


def test_persistence_inside_caller_transaction_does_not_commit(client, case_env):
    """
    When the caller already holds a transaction, persistence must not BEGIN/COMMIT on
    its own: the caller's rollback discards everything (pre-existing contract).
    """
    from app.parsers.persistence import persist_parse_result

    (evidence_id,) = _ingest_many(client, "caller", 1)
    parse_result = _parse_for(case_env, evidence_id)

    conn = open_case_db(case_env / "case.db")
    try:
        conn.execute("BEGIN IMMEDIATE")
        result = persist_parse_result(CASE_ID, parse_result, conn=conn)
        assert result.persisted and conn.in_transaction  # still the caller's transaction
        conn.rollback()
        assert conn.execute(
            "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()[0] == 0
    finally:
        close_case_db(conn)

    # Owned-transaction path: commits and leaves no transaction open.
    conn = open_case_db(case_env / "case.db")
    try:
        result = persist_parse_result(CASE_ID, parse_result, conn=conn)
        assert result.persisted and conn.in_transaction is False
    finally:
        close_case_db(conn)
    _assert_case_consistent(
        case_env / "case.db",
        {
            evidence_id: {
                "rawRecordsCount": result.raw_records_count,
                "eventsCount": result.events_count,
                "status": result.parser_status,
            }
        },
    )


def test_single_file_processing_unchanged(client, case_env):
    (evidence_id,) = _ingest_many(client, "single", 1)
    resp = client.post(f"/api/cases/{CASE_ID}/evidence/{evidence_id}/process", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["parserName"] and body["eventsCount"] > 0
    _assert_case_consistent(case_env / "case.db", {evidence_id: body})

    # Re-processing the same evidence is still rejected (409), not duplicated.
    again = client.post(f"/api/cases/{CASE_ID}/evidence/{evidence_id}/process", json={})
    assert again.status_code == 409, again.text


# ---------------------------------------------------------------------------
# Default protection and close logging
# ---------------------------------------------------------------------------


def _run_in_thread(fn):
    box = {}

    def target():
        try:
            box["value"] = fn()
        except BaseException as exc:  # noqa: BLE001 - surfaced to the test thread
            box["error"] = exc

    t = threading.Thread(target=target)
    t.start()
    t.join()
    return box


def _run_in_thread_async(fn):
    """Start ``fn`` on a new thread; returns a box with 'thread' and later 'value'/'error'."""
    box = {}

    def target():
        try:
            box["value"] = fn()
        except BaseException as exc:  # noqa: BLE001 - surfaced to the test thread
            box["error"] = exc

    box["thread"] = threading.Thread(target=target)
    box["thread"].start()
    return box


def test_default_thread_affinity_is_preserved(case_env):
    db_path = case_env / "case.db"

    for opener in (open_case_db, open_case_db_readonly):
        conn = opener(db_path)
        try:
            box = _run_in_thread(lambda: conn.execute("SELECT 1").fetchone())
            assert isinstance(box.get("error"), sqlite3.ProgrammingError)
        finally:
            conn.close()

        relaxed = opener(db_path, check_same_thread=False)
        try:
            box = _run_in_thread(lambda: relaxed.execute("SELECT 1").fetchone()[0])
            assert box.get("value") == 1, box.get("error")
        finally:
            relaxed.close()


def test_relaxed_connection_keeps_required_pragmas(case_env):
    """Relaxing thread affinity must not change WAL, busy timeout, FK or read-only settings."""
    db_path = case_env / "case.db"
    default_conn = open_case_db(db_path)
    relaxed_conn = open_case_db(db_path, check_same_thread=False)
    ro_conn = open_case_db_readonly(db_path, check_same_thread=False)
    try:
        for pragma in ("journal_mode", "busy_timeout", "foreign_keys"):
            assert (
                relaxed_conn.execute(f"PRAGMA {pragma}").fetchone()[0]
                == default_conn.execute(f"PRAGMA {pragma}").fetchone()[0]
            )
        assert ro_conn.execute("PRAGMA query_only").fetchone()[0] == 1
        with pytest.raises(sqlite3.OperationalError):
            ro_conn.execute("CREATE TABLE should_fail (x INTEGER)")
    finally:
        for c in (default_conn, relaxed_conn, ro_conn):
            c.close()


def test_close_failure_is_logged_not_swallowed(case_env, caplog):
    conn = open_case_db(case_env / "case.db")  # default: thread-affine
    try:
        caplog.set_level(logging.ERROR, logger="app.cases.database")
        # Closing from another thread fails under thread affinity.
        box = _run_in_thread(lambda: close_case_db(conn))
        assert "error" not in box  # close_case_db must never raise
        assert any("Failed to close case database connection" in r.getMessage() for r in caplog.records)
    finally:
        conn.close()
