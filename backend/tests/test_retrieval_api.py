"""
API integration tests for ForensicLens Hybrid Retrieval Endpoints:
- GET  /api/cases/{case_id}/retrieval/status
- POST /api/cases/{case_id}/retrieval/index
- POST /api/cases/{case_id}/retrieval/search
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from fastapi import HTTPException

from app.api.retrieval import (
    get_retrieval_status,
    index_case_records,
    search_case_evidence,
)
from app.cases.database import close_case_db, initialize_case_db
from app.evidence.service import ingest_evidence
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import persist_parse_result
from app.retrieval.embeddings import FakeEmbeddingModel
from app.retrieval.reranker import FakeReranker
from app.retrieval.schemas import (
    RetrievalIndexRequest,
    RetrievalMode,
    RetrievalSearchRequest,
)
from app.retrieval.service import RetrievalOrchestrator


@pytest.fixture
def retrieval_api_env(tmp_path: Path, monkeypatch):
    """Set up test cases with parsed evidence and inject test orchestrator."""
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True)
    monkeypatch.setenv("CASES_DIR", str(cases_dir))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    # Case 1
    c1_id = "CASE-RET-1"
    c1_dir = cases_dir / c1_id
    c1_dir.mkdir(parents=True)
    c1_db = c1_dir / "case.db"
    conn_1 = initialize_case_db(c1_db, c1_id, "Retrieval API Case 1")

    log1 = (
        "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2\n"
        "Jan 15 10:20:45 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55434 ssh2\n"
        "Jan 15 10:21:00 server sshd[1235]: Accepted password for root from 10.0.0.1 port 55433 ssh2\n"
        "Jan 15 10:21:05 server sshd[1235]: pam_unix(sshd:session): session opened for user root by (uid=0)\n"
        "CUSTOM_UNPARSED_SOURCE_LINE_ALPHA\n"
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

    # Case 2 for isolation tests
    c2_id = "CASE-RET-2"
    c2_dir = cases_dir / c2_id
    c2_dir.mkdir(parents=True)
    c2_db = c2_dir / "case.db"
    conn_2 = initialize_case_db(c2_db, c2_id, "Retrieval API Case 2")

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

    close_case_db(conn_1)
    close_case_db(conn_2)

    # Inject hermetic test orchestrator with fake embedding and reranker models
    test_orchestrator = RetrievalOrchestrator(
        embedding_model=FakeEmbeddingModel(),
        reranker=FakeReranker(),
    )

    return {
        "orchestrator": test_orchestrator,
        "cases_dir": cases_dir,
        "case_1_id": c1_id,
        "case_2_id": c2_id,
    }


def test_api_retrieval_status(retrieval_api_env):
    """GET /api/cases/{case_id}/retrieval/status returns indexing counts and model readiness."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    data = get_retrieval_status(c1, orchestrator=orch)
    assert data.case_id == c1
    assert data.total_records == 5
    assert data.embedding_model_ready is True
    assert data.reranker_model_ready is True
    assert data.offline_mode is True


def test_api_retrieval_index_endpoint(retrieval_api_env):
    """POST /api/cases/{case_id}/retrieval/index triggers local dense embedding and Chroma indexing."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    data = index_case_records(c1, payload=RetrievalIndexRequest(rebuild=False, batch_size=10), orchestrator=orch)
    assert data.case_id == c1
    assert data.indexed_count == 5
    assert data.total_indexed == 5
    assert data.status == "COMPLETED"


def test_api_retrieval_keyword_only_mode(retrieval_api_env):
    """POST /api/cases/{case_id}/retrieval/search with mode=KEYWORD_ONLY."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(query="Accepted password", mode=RetrievalMode.KEYWORD_ONLY, top_k=5)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert data.retrieval_mode == RetrievalMode.KEYWORD_ONLY
    assert data.total >= 1
    item = data.items[0]
    assert item.lexical_rank == 1
    assert item.semantic_rank is None
    assert item.rrf_score is None
    assert item.rerank_score is None
    assert "Accepted password" in item.text


def test_api_retrieval_semantic_only_mode(retrieval_api_env):
    """POST /api/cases/{case_id}/retrieval/search with mode=SEMANTIC_ONLY."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(query="unauthorized access attempt", mode=RetrievalMode.SEMANTIC_ONLY, top_k=3)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert data.retrieval_mode == RetrievalMode.SEMANTIC_ONLY
    assert len(data.items) == 3
    item = data.items[0]
    assert item.semantic_rank == 1
    assert item.lexical_rank is None
    assert item.final_rank == 1


def test_api_retrieval_hybrid_mode(retrieval_api_env):
    """POST /api/cases/{case_id}/retrieval/search with mode=HYBRID fuses via RRF."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(query="failed password hacker", mode=RetrievalMode.HYBRID, top_k=5)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert data.retrieval_mode == RetrievalMode.HYBRID
    assert len(data.items) > 0
    item = data.items[0]
    assert item.rrf_score is not None
    assert item.rrf_score > 0
    assert item.rerank_score is None
    assert item.final_rank == 1


def test_api_retrieval_hybrid_reranked_mode(retrieval_api_env):
    """POST /api/cases/{case_id}/retrieval/search with mode=HYBRID_RERANKED scores with cross-encoder."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(
        query="failed password invalid user hacker",
        mode=RetrievalMode.HYBRID_RERANKED,
        top_k=3,
        rerank_candidates=5,
    )
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert data.retrieval_mode == RetrievalMode.HYBRID_RERANKED
    assert len(data.items) == 3
    item = data.items[0]
    assert item.rerank_score is not None
    assert item.rrf_score is not None
    assert item.final_rank == 1


def test_api_retrieval_provenance_preservation(retrieval_api_env):
    """Search results contain complete forensic provenance mapping back to original source record."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(query="root", mode=RetrievalMode.HYBRID, top_k=1)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert len(data.items) == 1
    item = data.items[0]

    # Verify all provenance fields
    assert item.document_id.startswith(f"DOC_{c1}_RAW_")
    assert item.raw_record_id.startswith("RAW_")
    assert item.evidence_id.startswith("EV_")
    assert item.original_filename == "auth.log"
    assert isinstance(item.record_no, int)
    assert isinstance(item.line_number, int)
    assert isinstance(item.byte_start, int)
    assert isinstance(item.byte_end, int)
    assert item.text is not None


def test_api_retrieval_case_isolation(retrieval_api_env):
    """Searching Case 1 never returns Case 2 evidence."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    # 'alice' exists exclusively in Case 2
    req = RetrievalSearchRequest(query="alice", mode=RetrievalMode.KEYWORD_ONLY)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    assert data.total == 0


def test_api_retrieval_nonexistent_case(retrieval_api_env):
    """Querying a nonexistent case returns 404."""
    orch = retrieval_api_env["orchestrator"]

    with pytest.raises(HTTPException) as exc_info:
        search_case_evidence("CASE-NONEXISTENT", payload=RetrievalSearchRequest(query="root"), orchestrator=orch)
    assert exc_info.value.status_code == 404
    assert "does not exist" in str(exc_info.value.detail)


def test_api_retrieval_no_filesystem_paths_leaked(retrieval_api_env):
    """Ensure no server filesystem paths are exposed in the JSON response."""
    orch = retrieval_api_env["orchestrator"]
    c1 = retrieval_api_env["case_1_id"]

    req = RetrievalSearchRequest(query="root", mode=RetrievalMode.HYBRID)
    data = search_case_evidence(c1, payload=req, orchestrator=orch)
    raw_content = data.model_dump_json()

    # Check for drive letters, .venv, or internal directories
    assert "D:\\" not in raw_content
    assert "C:\\" not in raw_content
    assert "/home/" not in raw_content
    assert ".venv" not in raw_content
    assert "data/cases" not in raw_content


def test_api_route_registration_and_openapi_contract():
    """Verify that retrieval routes and OpenAPI specifications are registered correctly."""
    from main import app
    from app.api.retrieval import router as retrieval_router
    from fastapi.routing import APIRoute

    route_map = {}
    for r in retrieval_router.routes:
        if isinstance(r, APIRoute):
            for method in r.methods:
                route_map[(method, r.path)] = r

    # Verify all 3 retrieval endpoints are registered with the Retrieval tag
    status_route = route_map.get(("GET", "/api/cases/{case_id}/retrieval/status"))
    assert status_route is not None
    assert "Retrieval" in status_route.tags

    index_route = route_map.get(("POST", "/api/cases/{case_id}/retrieval/index"))
    assert index_route is not None
    assert "Retrieval" in index_route.tags

    search_route = route_map.get(("POST", "/api/cases/{case_id}/retrieval/search"))
    assert search_route is not None
    assert "Retrieval" in search_route.tags

    # Verify OpenAPI document contains all three routes
    spec = app.openapi()
    paths = spec["paths"]
    assert "/api/cases/{case_id}/retrieval/status" in paths
    assert "/api/cases/{case_id}/retrieval/index" in paths
    assert "/api/cases/{case_id}/retrieval/search" in paths


def test_api_request_validation_rejections():
    """Verify request validation rejects invalid payload bounds and bad enums."""
    from pydantic import ValidationError

    # Invalid mode enum
    with pytest.raises(ValidationError) as exc:
        RetrievalSearchRequest(query="valid query", mode="BAD_MODE")
    assert "Input should be 'KEYWORD_ONLY', 'SEMANTIC_ONLY', 'HYBRID' or 'HYBRID_RERANKED'" in str(exc.value)

    # Empty query (< 1 char)
    with pytest.raises(ValidationError) as exc:
        RetrievalSearchRequest(query="")
    assert "at least 1 character" in str(exc.value)

    # Out of bounds top_k (> 100)
    with pytest.raises(ValidationError) as exc:
        RetrievalSearchRequest(query="valid query", top_k=500)
    assert "less than or equal to 100" in str(exc.value)

    # Out of bounds lexical candidates (> 200)
    with pytest.raises(ValidationError) as exc:
        RetrievalSearchRequest(query="valid query", lexical_candidates=999)
    assert "less than or equal to 200" in str(exc.value)


def test_api_model_not_ready_returns_503(retrieval_api_env):
    """When a local model fails to load in offline mode, endpoint converts ModelNotReadyError to HTTP 503."""
    from app.retrieval.embeddings import ModelNotReadyError

    class UnreadyEmbeddingModel:
        @property
        def model_name(self): return "unready-model"
        @property
        def dimension(self): return 384
        def is_ready(self): return False
        def embed_documents(self, texts): raise ModelNotReadyError("Weights not found on disk")
        def embed_query(self, text): raise ModelNotReadyError("Weights not found on disk")

    unready_orch = RetrievalOrchestrator(embedding_model=UnreadyEmbeddingModel())
    c1 = retrieval_api_env["case_1_id"]

    # Indexing should raise 503
    with pytest.raises(HTTPException) as exc1:
        index_case_records(c1, payload=RetrievalIndexRequest(rebuild=True), orchestrator=unready_orch)
    assert exc1.value.status_code == 503
    assert "Weights not found on disk" in str(exc1.value.detail)

    # Semantic search should raise 503
    with pytest.raises(HTTPException) as exc2:
        search_case_evidence(c1, payload=RetrievalSearchRequest(query="test", mode=RetrievalMode.SEMANTIC_ONLY), orchestrator=unready_orch)
    assert exc2.value.status_code == 503
    assert "Weights not found on disk" in str(exc2.value.detail)
