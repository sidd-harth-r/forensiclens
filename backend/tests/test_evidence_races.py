"""
Regression tests for two evidence races.

1. Duplicate evidence uploads
   ``ingest_evidence`` checked ``(case_id, object_hash)`` before storing and
   inserting, without any lock, so simultaneous uploads of identical content all
   passed the check and created one evidence identity each. The check is now
   repeated under the database write reservation (BEGIN IMMEDIATE) immediately
   before the insert; the loser rolls back, removes only the file it created and
   reports the existing duplicate (HTTP 409).

2. Same-evidence concurrent processing status
   A request that lost the race to process the same evidence was rejected by the
   persistence layer, but its error handler then marked the evidence FAILED,
   overwriting the winner's PARSED/PARTIAL status (and returned HTTP 500). It now
   surfaces a 409 without touching the status, and the PROCESSING update is
   conditional so it can never overwrite a completed result either.

Concurrency is exercised through the real ASGI app (one request-scoped database
connection per request) and through separate service-level connections.
"""

from __future__ import annotations

import hashlib
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.evidence.service as evidence_service
import app.evidence.storage as evidence_storage
from app.cases.database import close_case_db, initialize_case_db, open_case_db
from app.evidence.service import (
    DuplicateEvidenceError,
    EvidenceIngestionError,
    _discard_new_artifact,
    ingest_evidence,
)
from app.evidence.storage import EvidenceStorageError, get_evidence_dir, get_evidence_path, store_evidence
from app.parsers.persistence import AlreadyPersistedError
from app.parsers.registry import default_registry
from app.parsers.service import process_evidence
from main import app

CASE_ID = "CASE-RACE"


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def case_dir(tmp_path: Path, monkeypatch) -> Path:
    cases_dir = tmp_path / "cases"
    cdir = cases_dir / CASE_ID
    cdir.mkdir(parents=True)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    close_case_db(initialize_case_db(cdir / "case.db", CASE_ID, "Race Case", created_by="pytest"))
    return cdir


@pytest.fixture
def client(case_dir):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def _log(tag: str, lines: int = 12) -> bytes:
    return "".join(
        f"Jan 15 10:{i:02d}:00 host-{tag} sshd[{100 + i}]: Failed password for invalid user u{tag}{i} "
        f"from 10.1.{i}.{len(tag)} port {41000 + i} ssh2\n"
        for i in range(lines)
    ).encode("utf-8")


def _upload(client: TestClient, body: bytes, name: str):
    return client.post(
        f"/api/cases/{CASE_ID}/evidence",
        files={"file": (name, io.BytesIO(body), "text/plain")},
        data={"format_name": "OPENSSH"},
    )


def _stored_files(cdir: Path) -> list[Path]:
    objects = get_evidence_dir(cdir)
    return sorted(objects.iterdir()) if objects.exists() else []


def _rows(cdir: Path, sql: str, params: tuple = ()) -> list:
    conn = open_case_db(cdir / "case.db")
    try:
        return [tuple(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        close_case_db(conn)


def _assert_store_consistent(cdir: Path) -> None:
    """Every stored file has exactly one record, named by its evidence_id, whose hash matches the bytes."""
    records = {r[0]: r[1] for r in _rows(cdir, "SELECT evidence_id, object_hash FROM evidence_files")}
    files = _stored_files(cdir)
    assert sorted(p.name for p in files) == sorted(records), "stored files and records differ (orphan or missing)"
    for p in files:
        assert hashlib.sha256(p.read_bytes()).hexdigest() == records[p.name]
    dup_groups = _rows(cdir, "SELECT object_hash FROM evidence_files GROUP BY case_id, object_hash HAVING COUNT(*) > 1")
    assert dup_groups == []


# ---------------------------------------------------------------------------
# 1. Duplicate evidence uploads
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("round_no", range(10))
def test_simultaneous_identical_uploads_create_one_evidence(client, case_dir, round_no):
    body = _log(f"dup{round_no}", lines=200)  # larger body widens the race window
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda i: _upload(client, body, f"copy{i}.log"), range(8)))

    codes = sorted(r.status_code for r in responses)
    assert codes == [201] + [409] * 7, [r.text for r in responses if r.status_code not in (201, 409)]

    winner = next(r.json() for r in responses if r.status_code == 201)
    # Every 409 identifies the single surviving evidence identity.
    for r in responses:
        if r.status_code == 409:
            assert winner["evidenceId"] in r.json()["detail"]

    records = _rows(case_dir, "SELECT evidence_id, object_hash FROM evidence_files")
    assert records == [(winner["evidenceId"], hashlib.sha256(body).hexdigest())]
    assert [p.name for p in _stored_files(case_dir)] == [winner["evidenceId"]]
    _assert_store_consistent(case_dir)


def test_concurrent_duplicates_never_delete_the_original(client, case_dir):
    body = _log("orig", lines=150)
    first = _upload(client, body, "original.log")
    assert first.status_code == 201
    original_id = first.json()["evidenceId"]
    original_path = get_evidence_path(case_dir, original_id)
    original_stat = original_path.stat()

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda i: _upload(client, body, f"again{i}.log"), range(8)))

    assert [r.status_code for r in responses] == [409] * 8
    assert original_path.read_bytes() == body
    assert original_path.stat().st_mtime_ns == original_stat.st_mtime_ns
    assert [p.name for p in _stored_files(case_dir)] == [original_id]
    _assert_store_consistent(case_dir)


def test_locked_recheck_path_rejects_loser_and_removes_only_its_file(case_dir, monkeypatch):
    """
    Deterministically drive both writers past the unlocked fast-path check and through
    storage before either inserts, so the duplicate is caught only by the re-check
    under the write reservation. Uses two separate database connections.
    """
    body = _log("barrier", lines=40)
    both_stored = threading.Barrier(2, timeout=10)
    real_store = evidence_service.store_evidence

    def store_then_wait(*args, **kwargs):
        path = real_store(*args, **kwargs)
        both_stored.wait()
        return path

    monkeypatch.setattr(evidence_service, "store_evidence", store_then_wait)

    results: dict = {}

    def writer(name: str):
        conn = open_case_db(case_dir / "case.db")
        try:
            results[name] = ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(body), f"{name}.log")
        except BaseException as exc:  # noqa: BLE001 - asserted below
            results[name] = exc
        finally:
            close_case_db(conn)

    threads = [threading.Thread(target=writer, args=(n,)) for n in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    winners = [v for v in results.values() if not isinstance(v, BaseException)]
    losers = [v for v in results.values() if isinstance(v, DuplicateEvidenceError)]
    assert len(winners) == 1 and len(losers) == 1, results
    assert losers[0].existing_evidence_id == winners[0].evidence_id
    assert [p.name for p in _stored_files(case_dir)] == [winners[0].evidence_id]
    _assert_store_consistent(case_dir)


def test_failure_after_storage_removes_new_artifact(case_dir, monkeypatch):
    """A failure between storage and insert (format detection) leaves no file, no row, no open transaction."""

    def boom(*args, **kwargs):
        raise RuntimeError("injected detection failure")

    monkeypatch.setattr(evidence_service, "detect_media_type_and_format", boom)
    conn = open_case_db(case_dir / "case.db")
    try:
        with pytest.raises(RuntimeError, match="injected detection failure"):
            ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("detect")), "x.log")
        assert conn.in_transaction is False
    finally:
        close_case_db(conn)
    assert _stored_files(case_dir) == []
    assert _rows(case_dir, "SELECT COUNT(*) FROM evidence_files")[0][0] == 0


def test_database_insert_failure_rolls_back_and_removes_new_artifact(case_dir):
    conn = open_case_db(case_dir / "case.db")
    try:
        existing = ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("keep")), "keep.log")
        conn.execute(
            "CREATE TRIGGER fail_insert BEFORE INSERT ON evidence_files "
            "BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;"
        )
        with pytest.raises(EvidenceIngestionError, match="Database insertion failed, cleaned up artifact"):
            ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("lost")), "lost.log")
        assert conn.in_transaction is False
        conn.execute("DROP TRIGGER fail_insert")
    finally:
        close_case_db(conn)
    assert [p.name for p in _stored_files(case_dir)] == [existing.evidence_id]
    _assert_store_consistent(case_dir)


def test_storage_hash_failure_leaves_nothing(case_dir, monkeypatch):
    monkeypatch.setattr(evidence_storage, "compute_sha256", lambda path: "0" * 64)
    conn = open_case_db(case_dir / "case.db")
    try:
        with pytest.raises(EvidenceIngestionError, match="hash mismatch"):
            ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("hash")), "h.log")
    finally:
        close_case_db(conn)
    assert _stored_files(case_dir) == []
    assert _rows(case_dir, "SELECT COUNT(*) FROM evidence_files")[0][0] == 0


def test_store_creation_race_never_overwrites_or_deletes_existing_file(case_dir, monkeypatch):
    """
    If another writer creates the same artifact path after the exists() check, the
    exclusive create fails and the existing file is neither overwritten nor removed.
    """
    target_id = "EV_RACE_TARGET"
    target = get_evidence_path(case_dir, target_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"existing evidence bytes")

    real_exists = Path.exists
    monkeypatch.setattr(Path, "exists", lambda self: False if self == target else real_exists(self))

    with pytest.raises(EvidenceStorageError, match="already exists"):
        store_evidence(io.BytesIO(b"other bytes"), case_dir, target_id, hashlib.sha256(b"other bytes").hexdigest())
    monkeypatch.undo()
    assert target.read_bytes() == b"existing evidence bytes"


def test_caller_supplied_existing_id_is_rejected_before_storage(case_dir):
    conn = open_case_db(case_dir / "case.db")
    try:
        existing = ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("id1")), "a.log")
        before = get_evidence_path(case_dir, existing.evidence_id).read_bytes()
        with pytest.raises(EvidenceIngestionError, match="Evidence ID already exists"):
            ingest_evidence(
                conn, case_dir, CASE_ID, io.BytesIO(_log("id2")), "b.log", evidence_id=existing.evidence_id
            )
    finally:
        close_case_db(conn)
    assert get_evidence_path(case_dir, existing.evidence_id).read_bytes() == before
    _assert_store_consistent(case_dir)


def test_discard_never_removes_artifact_of_committed_record(case_dir):
    conn = open_case_db(case_dir / "case.db")
    try:
        existing = ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("guard")), "g.log")
        _discard_new_artifact(conn, case_dir, existing.evidence_id)
    finally:
        close_case_db(conn)
    assert get_evidence_path(case_dir, existing.evidence_id).exists()
    _assert_store_consistent(case_dir)


# ---------------------------------------------------------------------------
# 2. Same-evidence concurrent processing
# ---------------------------------------------------------------------------


def _counts(cdir: Path, evidence_id: str) -> tuple[int, int, str]:
    raw = _rows(cdir, "SELECT COUNT(*) FROM raw_records WHERE evidence_id = ?", (evidence_id,))[0][0]
    ev = _rows(cdir, "SELECT COUNT(*) FROM events WHERE evidence_id = ?", (evidence_id,))[0][0]
    status = _rows(cdir, "SELECT parser_status FROM evidence_files WHERE evidence_id = ?", (evidence_id,))[0][0]
    return raw, ev, status


def _assert_fts_consistent(cdir: Path) -> None:
    conn = open_case_db(cdir / "case.db")
    try:
        conn.execute("INSERT INTO events_fts(events_fts) VALUES('integrity-check')")
        conn.execute("INSERT INTO raw_records_fts(raw_records_fts) VALUES('integrity-check')")
        conn.rollback()
    finally:
        close_case_db(conn)


@pytest.mark.parametrize("round_no", range(10))
def test_simultaneous_processing_of_same_evidence(client, case_dir, round_no):
    up = _upload(client, _log(f"same{round_no}", lines=60), "same.log")
    assert up.status_code == 201
    eid = up.json()["evidenceId"]
    url = f"/api/cases/{CASE_ID}/evidence/{eid}/process"

    start = threading.Barrier(4)

    def go(_):
        start.wait()
        return client.post(url, json={})

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(go, range(4)))

    codes = sorted(r.status_code for r in responses)
    assert codes == [200, 409, 409, 409], [r.text for r in responses]
    winner = next(r.json() for r in responses if r.status_code == 200)

    raw, ev, status = _counts(case_dir, eid)
    assert status == winner["status"] and status in {"PARSED", "PARTIAL"}
    assert ev == winner["eventsCount"] and ev > 0
    assert raw > 0
    _assert_fts_consistent(case_dir)


class _BlockingRegistry:
    """Delegates to the default registry but blocks inside get() until released."""

    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    def get(self, name):
        self.entered.set()
        assert self.release.wait(timeout=10)
        return default_registry.get(name)


def test_loser_passing_early_check_never_overwrites_completed_status(case_dir):
    """
    Request B passes the early idempotency check, then request A processes the same
    evidence completely before B reaches its PROCESSING update. B must be rejected as
    already persisted and leave A's status and rows untouched.
    """
    conn_seed = open_case_db(case_dir / "case.db")
    try:
        eid = ingest_evidence(conn_seed, case_dir, CASE_ID, io.BytesIO(_log("cond")), "auth.log").evidence_id
    finally:
        close_case_db(conn_seed)

    blocking = _BlockingRegistry()
    outcome: dict = {}

    def request_b():
        conn = open_case_db(case_dir / "case.db")
        try:
            outcome["b"] = process_evidence(case_dir, CASE_ID, eid, conn=conn, registry=blocking)
        except BaseException as exc:  # noqa: BLE001 - asserted below
            outcome["b"] = exc
        finally:
            close_case_db(conn)

    tb = threading.Thread(target=request_b)
    tb.start()
    assert blocking.entered.wait(timeout=10)  # B is past the early check

    conn_a = open_case_db(case_dir / "case.db")
    try:
        result_a = process_evidence(case_dir, CASE_ID, eid, conn=conn_a)
    finally:
        close_case_db(conn_a)
    after_a = _counts(case_dir, eid)

    blocking.release.set()
    tb.join(timeout=20)

    assert isinstance(outcome["b"], AlreadyPersistedError), outcome["b"]
    assert after_a[2] == result_a.status
    assert _counts(case_dir, eid) == after_a  # status, raw and event counts untouched
    _assert_fts_consistent(case_dir)


def test_loser_rejected_by_persistence_layer_does_not_mark_failed(case_dir, monkeypatch):
    """
    Both requests pass the early check and the PROCESSING update and parse in
    parallel; the persistence layer rejects the loser. The loser must surface
    AlreadyPersistedError and must not set FAILED.
    """
    conn_seed = open_case_db(case_dir / "case.db")
    try:
        eid = ingest_evidence(conn_seed, case_dir, CASE_ID, io.BytesIO(_log("persist")), "auth.log").evidence_id
    finally:
        close_case_db(conn_seed)

    parser = default_registry.get("OPENSSH")
    both_parsed = threading.Barrier(2, timeout=10)
    real_parse = type(parser).parse

    def parse_then_wait(self, *args, **kwargs):
        result = real_parse(self, *args, **kwargs)
        both_parsed.wait()
        return result

    monkeypatch.setattr(type(parser), "parse", parse_then_wait)

    outcomes = []

    def worker():
        conn = open_case_db(case_dir / "case.db")
        try:
            outcomes.append(process_evidence(case_dir, CASE_ID, eid, conn=conn))
        except BaseException as exc:  # noqa: BLE001 - asserted below
            outcomes.append(exc)
        finally:
            close_case_db(conn)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    successes = [o for o in outcomes if not isinstance(o, BaseException)]
    rejected = [o for o in outcomes if isinstance(o, AlreadyPersistedError)]
    assert len(successes) == 1 and len(rejected) == 1, outcomes
    raw, ev, status = _counts(case_dir, eid)
    assert status == successes[0].status and status != "FAILED"
    assert ev == successes[0].events_count
    _assert_fts_consistent(case_dir)


# ---------------------------------------------------------------------------
# Final-audit regressions: remaining failure paths
# ---------------------------------------------------------------------------


def _ingest_one(cdir: Path, tag: str) -> str:
    conn = open_case_db(cdir / "case.db")
    try:
        return ingest_evidence(conn, cdir, CASE_ID, io.BytesIO(_log(tag)), "auth.log").evidence_id
    finally:
        close_case_db(conn)


class _GateBeforeGet:
    """Holds a request after its early idempotency check (inside parser lookup)."""

    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    def get(self, name):
        self.entered.set()
        assert self.release.wait(timeout=10)
        return default_registry.get(name)


class _GateInCrashingParse:
    """Returns a parser that holds the request after its PROCESSING update, then crashes."""

    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        gate = self

        class _CrashingParser:
            parser_name = "crashing"
            parser_version = "0"

            def parse(self, *args, **kwargs):
                gate.entered.set()
                assert gate.release.wait(timeout=10)
                raise RuntimeError("injected parser crash")

        self._parser = _CrashingParser()

    def get(self, name):
        return self._parser


def _race_failure_path_against_success(cdir: Path, gate, **b_kwargs):
    eid = _ingest_one(cdir, f"gate-{type(gate).__name__}")
    outcome: dict = {}

    def request_b():
        conn = open_case_db(cdir / "case.db")
        try:
            outcome["b"] = process_evidence(cdir, CASE_ID, eid, conn=conn, registry=gate, **b_kwargs)
        except BaseException as exc:  # noqa: BLE001 - asserted by caller
            outcome["b"] = exc
        finally:
            close_case_db(conn)

    tb = threading.Thread(target=request_b)
    tb.start()
    assert gate.entered.wait(timeout=10)

    conn_a = open_case_db(cdir / "case.db")
    try:
        result_a = process_evidence(cdir, CASE_ID, eid, conn=conn_a)
    finally:
        close_case_db(conn_a)
    after_a = _counts(cdir, eid)

    gate.release.set()
    tb.join(timeout=20)
    return eid, result_a, after_a, outcome["b"]


def test_unsupported_parser_request_cannot_overwrite_completed_status(case_dir):
    eid, result_a, after_a, b = _race_failure_path_against_success(
        case_dir, _GateBeforeGet(), parser_name_or_format="NO_SUCH_PARSER"
    )
    assert isinstance(b, AlreadyPersistedError), b
    assert after_a[2] == result_a.status
    assert _counts(case_dir, eid) == after_a


def test_crashing_parser_request_cannot_overwrite_completed_status(case_dir):
    eid, result_a, after_a, b = _race_failure_path_against_success(case_dir, _GateInCrashingParse())
    assert isinstance(b, AlreadyPersistedError), b
    assert after_a[2] == result_a.status
    assert _counts(case_dir, eid) == after_a


def test_failure_statuses_still_recorded_when_nothing_was_persisted(case_dir):
    """Without a concurrent success, the guarded writes behave exactly as before."""
    eid = _ingest_one(case_dir, "unsupported")
    conn = open_case_db(case_dir / "case.db")
    try:
        res = process_evidence(case_dir, CASE_ID, eid, conn=conn, parser_name_or_format="NO_SUCH_PARSER")
    finally:
        close_case_db(conn)
    assert res.status == "UNSUPPORTED" and _counts(case_dir, eid)[2] == "UNSUPPORTED"

    eid2 = _ingest_one(case_dir, "crash")
    gate = _GateInCrashingParse()
    gate.release.set()
    conn = open_case_db(case_dir / "case.db")
    try:
        res2 = process_evidence(case_dir, CASE_ID, eid2, conn=conn, registry=gate)
    finally:
        close_case_db(conn)
    assert res2.status == "FAILED" and _counts(case_dir, eid2) == (0, 0, "FAILED")


def test_post_copy_verification_failure_removes_artifact(case_dir, monkeypatch):
    monkeypatch.setattr(
        evidence_storage, "compute_sha256", lambda path: (_ for _ in ()).throw(OSError("injected read failure"))
    )
    conn = open_case_db(case_dir / "case.db")
    try:
        with pytest.raises(EvidenceIngestionError, match="Failed to verify stored evidence hash"):
            ingest_evidence(conn, case_dir, CASE_ID, io.BytesIO(_log("verify")), "v.log")
    finally:
        close_case_db(conn)
    assert _stored_files(case_dir) == []
    assert _rows(case_dir, "SELECT COUNT(*) FROM evidence_files")[0][0] == 0


class _FailsDuringCopy(io.BytesIO):
    """Readable for hashing; raises part-way through the storage copy (after rewind)."""

    def __init__(self, data: bytes):
        super().__init__(data)
        self.rewound = False
        self.copy_reads = 0

    def seek(self, *args):
        self.rewound = True
        return super().seek(*args)

    def read(self, n=-1):
        if self.rewound:
            self.copy_reads += 1
            if self.copy_reads > 1:
                raise ValueError("injected stream failure mid-copy")
        return super().read(n)


def test_stream_failure_mid_copy_leaves_no_partial_artifact(case_dir):
    conn = open_case_db(case_dir / "case.db")
    try:
        with pytest.raises(ValueError, match="mid-copy"):
            ingest_evidence(conn, case_dir, CASE_ID, _FailsDuringCopy(b"x" * 200_000), "partial.log")
    finally:
        close_case_db(conn)
    assert _stored_files(case_dir) == []
    assert _rows(case_dir, "SELECT COUNT(*) FROM evidence_files")[0][0] == 0
