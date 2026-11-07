"""
Unit tests for Cross-Encoder Reranker.
"""

from __future__ import annotations

import pytest

from app.retrieval.documents import RetrievalDocument
from app.retrieval.embeddings import ModelNotReadyError
from app.retrieval.fusion import FusedSearchResult
from app.retrieval.reranker import (
    FakeReranker,
    LocalCrossEncoderReranker,
    rerank_candidates,
)


def make_fused_candidate(doc_id: str, text: str, rank: int, rrf_score: float) -> FusedSearchResult:
    doc = RetrievalDocument(
        document_id=doc_id,
        raw_record_id=f"RAW_{doc_id}",
        case_id="CASE-RERANK",
        evidence_id="EV_1",
        record_no=rank,
        line_number=rank,
        byte_start=0,
        byte_end=len(text),
        raw_text=text,
        original_filename="auth.log",
    )
    return FusedSearchResult(
        document_id=doc_id,
        fusion_rank=rank,
        rrf_score=rrf_score,
        lexical_rank=rank,
        semantic_rank=rank,
        document=doc,
    )


def test_fake_reranker_scores_query_document_pairs():
    """Fake reranker scores query-document pairs deterministically."""
    reranker = FakeReranker()
    assert reranker.is_ready()

    scores = reranker.rerank(
        query="failed password hacker",
        documents=[
            "Failed password for invalid user hacker from 192.168.1.100",
            "Accepted password for root from 10.0.0.1",
            "Session closed for user daemon",
        ],
    )
    assert len(scores) == 3
    # First document has highest overlap with 'failed password hacker'
    assert scores[0] > scores[1]
    assert scores[1] > scores[2]


def test_rerank_candidates_reorders_fused_pool():
    """Reranking reorders candidates based on cross-encoder scores."""
    reranker = FakeReranker()

    # Candidate 1: Less relevant
    c1 = make_fused_candidate("DOC_1", "Accepted password for root", 1, 0.03)
    # Candidate 2: Highly relevant to query 'hacker attack'
    c2 = make_fused_candidate("DOC_2", "Failed password for hacker attack", 2, 0.02)

    candidates = [c1, c2]
    reranked = rerank_candidates(reranker, "hacker attack", candidates, candidate_limit=10)

    assert len(reranked) == 2
    # DOC_2 should be reranked to rank 1
    assert reranked[0].document_id == "DOC_2"
    assert reranked[0].final_rank == 1
    assert reranked[0].rerank_score is not None

    # DOC_1 should be rank 2
    assert reranked[1].document_id == "DOC_1"
    assert reranked[1].final_rank == 2


def test_rerank_candidates_bounds_pool_by_limit():
    """Only top candidates up to candidate_limit are reranked; remainder retain relative RRF rank."""
    reranker = FakeReranker()

    candidates = [
        make_fused_candidate(f"DOC_{i}", f"Log entry {i} keyword", i, 0.05 - (i * 0.005))
        for i in range(1, 6)
    ]

    # Rerank only top 2
    reranked = rerank_candidates(reranker, "keyword", candidates, candidate_limit=2)
    assert len(reranked) == 5

    # Top 2 have rerank scores
    assert reranked[0].rerank_score is not None
    assert reranked[1].rerank_score is not None

    # Candidates 3, 4, 5 were past cutoff and have rerank_score = None
    assert reranked[2].rerank_score is None
    assert reranked[3].rerank_score is None
    assert reranked[4].rerank_score is None

    # Ranks are sequential 1..5
    assert [r.final_rank for r in reranked] == [1, 2, 3, 4, 5]


def test_reranker_missing_model_offline_error():
    """LocalCrossEncoderReranker raises ModelNotReadyError in offline mode if weights missing."""
    reranker = LocalCrossEncoderReranker(
        model_name="nonexistent/fake-reranker-offline-test",
        offline=True,
    )
    assert not reranker.is_ready()
    with pytest.raises(ModelNotReadyError) as exc_info:
        reranker.rerank("query", ["doc"])
    assert "could not be loaded" in str(exc_info.value)
    assert "offline_mode=True" in str(exc_info.value)


def test_rerank_candidates_empty_input():
    """Empty candidate list yields empty result."""
    reranker = FakeReranker()
    assert rerank_candidates(reranker, "query", []) == []
