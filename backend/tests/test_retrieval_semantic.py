"""
Unit tests for Semantic Retrieval and ChromaDB vector store.
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest

from app.cases.database import close_case_db, initialize_case_db, open_case_db
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result
from app.retrieval.documents import fetch_retrieval_documents
from app.retrieval.embeddings import (
    FakeEmbeddingModel,
    LocalBGEEmbeddingModel,
    ModelNotReadyError,
)
from app.retrieval.service import RetrievalOrchestrator
from app.retrieval.vector_store import CaseVectorStore


@pytest.fixture
def semantic_test_env(tmp_path: Path, monkeypatch):
    """Set up isolated case databases with evidence for semantic indexing tests."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # Case 1
    c1_id = "CASE-SEM-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Semantic Case 1")

    log1 = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "UNPARSED NONSTANDARD LOG ENTRY WITHOUT SSHD MARKER\n"
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

    # Case 2
    c2_id = "CASE-SEM-2"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Semantic Case 2")

    log2 = "Jan 16 11:00:00 server sshd[9999]: Accepted password for alice from 172.16.0.5 port 2222 ssh2\n".encode("utf-8")
    ev2 = ingest_evidence(
        conn=conn_2,
        case_dir=c2_dir,
        case_id=c2_id,
        source=io.BytesIO(log2),
        original_name="auth2.log",
        format_name="OPENSSH",
    )
    p_res2 = parser.parse(ev2.storage_path, evidence_id=ev2.evidence_id)
    persist_parse_result(case_id=c2_id, parse_result=p_res2, conn=conn_2)

    yield {
        "cases_dir": cases_dir,
        "case_1_id": c1_id,
        "case_1_dir": c1_dir,
        "case_1_db": c1_db,
        "case_2_id": c2_id,
        "case_2_dir": c2_dir,
        "case_2_db": c2_db,
    }

    close_case_db(conn_1)
    close_case_db(conn_2)


def test_deterministic_document_ids(semantic_test_env):
    """Document IDs are deterministic: f'DOC_{case_id}_{raw_record_id}'."""
    conn = open_case_db(semantic_test_env["case_1_db"])
    try:
        docs = fetch_retrieval_documents(conn, semantic_test_env["case_1_id"])
        assert len(docs) == 3
        for d in docs:
            expected_id = f"DOC_CASE-SEM-1_{d.raw_record_id}"
            assert d.document_id == expected_id
    finally:
        close_case_db(conn)


def test_fake_embedding_model_properties():
    """Fake embedding model produces deterministic unit-normalized vectors."""
    model = FakeEmbeddingModel(dimension=384)
    assert model.is_ready()
    assert model.dimension == 384

    v1 = model.embed_query("failed password for root")
    v2 = model.embed_query("failed password for root")
    v3 = model.embed_query("completely different query text")

    assert v1 == v2  # Deterministic
    assert v1 != v3  # Distinct texts get distinct vectors
    assert len(v1) == 384


def test_chroma_vector_store_indexing_and_query(semantic_test_env):
    """Vector store indexes documents and queries with explicit precomputed embeddings."""
    case_dir = semantic_test_env["case_1_dir"]
    case_id = semantic_test_env["case_1_id"]

    vector_store = CaseVectorStore(case_dir, case_id)
    assert vector_store.get_indexed_count() == 0

    conn = open_case_db(semantic_test_env["case_1_db"])
    try:
        docs = fetch_retrieval_documents(conn, case_id)
    finally:
        close_case_db(conn)

    model = FakeEmbeddingModel()
    texts = [d.to_embedding_text() for d in docs]
    embeddings = model.embed_documents(texts)

    added = vector_store.add_documents(docs, embeddings)
    assert added == len(docs)
    assert vector_store.get_indexed_count() == len(docs)

    # Query with query vector
    query_vec = model.embed_query("failed password")
    results = vector_store.query(query_vec, n_results=5)
    assert len(results) == len(docs)
    assert results[0].rank == 1
    assert results[0].score > 0
    assert results[0].document_id in [d.document_id for d in docs]


def test_incremental_indexing_skips_existing(semantic_test_env):
    """Incremental indexing only indexes new records and skips already indexed documents."""
    orchestrator = RetrievalOrchestrator(embedding_model=FakeEmbeddingModel())
    cases_dir = semantic_test_env["cases_dir"]
    case_id = semantic_test_env["case_1_id"]

    # Initial index
    res1 = orchestrator.index_case(cases_dir, case_id)
    assert res1.indexed_count == 3
    assert res1.total_indexed == 3
    assert res1.status == "COMPLETED"

    # Second index call: should skip existing documents and return UP_TO_DATE
    res2 = orchestrator.index_case(cases_dir, case_id)
    assert res2.indexed_count == 0
    assert res2.total_indexed == 3
    assert res2.status == "UP_TO_DATE"


def test_rebuild_behavior(semantic_test_env):
    """Rebuilding drops the collection and re-indexes from scratch."""
    from app.retrieval.schemas import RetrievalIndexRequest

    orchestrator = RetrievalOrchestrator(embedding_model=FakeEmbeddingModel())
    cases_dir = semantic_test_env["cases_dir"]
    case_id = semantic_test_env["case_1_id"]

    # First index
    orchestrator.index_case(cases_dir, case_id)

    # Rebuild
    rebuild_req = RetrievalIndexRequest(rebuild=True)
    res = orchestrator.index_case(cases_dir, case_id, rebuild_req)
    assert res.indexed_count == 3
    assert res.total_indexed == 3
    assert res.status == "COMPLETED"


def test_case_isolation_in_vector_store(semantic_test_env):
    """Each case has an isolated vector storage directory and collection."""
    orchestrator = RetrievalOrchestrator(embedding_model=FakeEmbeddingModel())
    cases_dir = semantic_test_env["cases_dir"]
    c1_id = semantic_test_env["case_1_id"]
    c2_id = semantic_test_env["case_2_id"]

    orchestrator.index_case(cases_dir, c1_id)
    orchestrator.index_case(cases_dir, c2_id)

    store1 = CaseVectorStore(semantic_test_env["case_1_dir"], c1_id)
    store2 = CaseVectorStore(semantic_test_env["case_2_dir"], c2_id)

    # Case 1 has 3 records, Case 2 has 1 record
    assert store1.get_indexed_count() == 3
    assert store2.get_indexed_count() == 1

    # Storage paths are distinct
    assert store1.chroma_dir != store2.chroma_dir
    assert str(c1_id) in str(store1.chroma_dir)
    assert str(c2_id) in str(store2.chroma_dir)


def test_missing_model_offline_error():
    """In offline mode, attempting to load a nonexistent model raises ModelNotReadyError."""
    model = LocalBGEEmbeddingModel(
        model_name="nonexistent/fake-bge-model-offline-test",
        offline=True,
    )
    assert not model.is_ready()
    with pytest.raises(ModelNotReadyError) as exc_info:
        model.embed_query("test query")
    assert "could not be loaded" in str(exc_info.value)
    assert "offline_mode=True" in str(exc_info.value)


def test_deleted_source_records_are_pruned_from_vector_store(semantic_test_env):
    """When a raw record is removed from SQLite, indexing prunes its vector and status reflects STALE."""
    orchestrator = RetrievalOrchestrator(embedding_model=FakeEmbeddingModel())
    cases_dir = semantic_test_env["cases_dir"]
    c1 = semantic_test_env["case_1_id"]
    c1_db = semantic_test_env["case_1_db"]

    # 1. Index all 3 records initially
    res1 = orchestrator.index_case(cases_dir, c1)
    assert res1.indexed_count == 3
    assert res1.total_indexed == 3

    # 2. Delete 1 record from SQLite directly
    conn = open_case_db(c1_db)
    try:
        conn.execute("DELETE FROM raw_records WHERE record_no = 3")
        conn.commit()
    finally:
        close_case_db(conn)

    # 3. Status should detect that index is STALE (3 indexed vs 2 active in SQLite)
    status_stale = orchestrator.get_status(cases_dir, c1)
    assert status_stale.total_records == 2
    assert status_stale.indexed_records == 3
    assert status_stale.index_status == "STALE"

    # 4. Running index_case prunes the orphaned vector
    res2 = orchestrator.index_case(cases_dir, c1)
    assert res2.total_indexed == 2
    status_ready = orchestrator.get_status(cases_dir, c1)
    assert status_ready.total_records == 2
    assert status_ready.indexed_records == 2
    assert status_ready.index_status == "READY"


def test_partial_indexing_does_not_mark_status_as_ready(semantic_test_env):
    """Partial index count results in PARTIAL status and is_indexed=False."""
    c1_dir = semantic_test_env["case_1_dir"]
    c1 = semantic_test_env["case_1_id"]
    cases_dir = semantic_test_env["cases_dir"]

    # Manually add only 1 document out of 3 into vector store
    conn = open_case_db(semantic_test_env["case_1_db"])
    try:
        docs = fetch_retrieval_documents(conn, c1, limit=1)
    finally:
        close_case_db(conn)

    model = FakeEmbeddingModel()
    store = CaseVectorStore(c1_dir, c1)
    store.add_documents(docs, model.embed_documents([d.to_embedding_text() for d in docs]))

    orchestrator = RetrievalOrchestrator(embedding_model=model)
    status = orchestrator.get_status(cases_dir, c1)
    assert status.total_records == 3
    assert status.indexed_records == 1
    assert status.index_status == "PARTIAL"
    assert status.is_indexed is False


def test_empty_case_reports_empty_status(tmp_path: Path):
    """A fresh case with zero source records reports EMPTY status."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    c_empty = "CASE-EMPTY"
    c_dir = cases_dir / c_empty
    c_dir.mkdir(parents=True, exist_ok=True)
    c_db = c_dir / "case.db"
    conn = initialize_case_db(c_db, c_empty, "Empty Case")
    close_case_db(conn)

    orchestrator = RetrievalOrchestrator(embedding_model=FakeEmbeddingModel())
    status = orchestrator.get_status(cases_dir, c_empty)
    assert status.total_records == 0
    assert status.indexed_records == 0
    assert status.index_status == "EMPTY"
