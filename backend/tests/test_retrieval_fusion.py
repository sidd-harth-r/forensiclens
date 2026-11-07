"""
Unit tests for Reciprocal Rank Fusion (RRF).
"""

from __future__ import annotations

import pytest

from app.retrieval.documents import RetrievalDocument
from app.retrieval.fusion import reciprocal_rank_fusion
from app.retrieval.lexical import LexicalSearchResult
from app.retrieval.vector_store import SemanticSearchResult


def make_test_doc(doc_id: str, text: str) -> RetrievalDocument:
    return RetrievalDocument(
        document_id=doc_id,
        raw_record_id=f"RAW_{doc_id}",
        case_id="CASE-TEST",
        evidence_id="EV_1",
        record_no=1,
        line_number=1,
        byte_start=0,
        byte_end=len(text),
        raw_text=text,
        original_filename="test.log",
    )


def test_rrf_mathematical_calculation():
    """Verify exact formula calculation: RRF(d) = sum(1 / (k + rank_i))."""
    doc_a = make_test_doc("DOC_A", "doc A text")
    doc_b = make_test_doc("DOC_B", "doc B text")

    # doc_a: lexical rank 1, semantic rank 2
    # doc_b: lexical rank 2, semantic rank 1
    k = 60
    expected_score_a = (1.0 / (60 + 1)) + (1.0 / (60 + 2))
    expected_score_b = (1.0 / (60 + 2)) + (1.0 / (60 + 1))

    lexical = [
        LexicalSearchResult(document_id="DOC_A", rank=1, score=1.0, document=doc_a),
        LexicalSearchResult(document_id="DOC_B", rank=2, score=0.5, document=doc_b),
    ]
    semantic = [
        SemanticSearchResult(document_id="DOC_B", rank=1, score=0.9, distance=0.1, metadata={}, document=doc_b),
        SemanticSearchResult(document_id="DOC_A", rank=2, score=0.8, distance=0.2, metadata={}, document=doc_a),
    ]

    results = reciprocal_rank_fusion(lexical, semantic, k=k)
    assert len(results) == 2
    assert pytest.approx(results[0].rrf_score, rel=1e-6) == expected_score_a
    assert pytest.approx(results[1].rrf_score, rel=1e-6) == expected_score_b


def test_rrf_duplicate_merging():
    """Documents appearing in both rankings merge into a single item with both ranks preserved."""
    doc_shared = make_test_doc("DOC_SHARED", "shared doc")

    lexical = [LexicalSearchResult(document_id="DOC_SHARED", rank=1, score=1.0, document=doc_shared)]
    semantic = [SemanticSearchResult(document_id="DOC_SHARED", rank=3, score=0.7, distance=0.3, metadata={}, document=doc_shared)]

    results = reciprocal_rank_fusion(lexical, semantic, k=60)
    assert len(results) == 1
    res = results[0]
    assert res.document_id == "DOC_SHARED"
    assert res.lexical_rank == 1
    assert res.semantic_rank == 3
    assert res.fusion_rank == 1
    assert pytest.approx(res.rrf_score) == (1.0 / 61) + (1.0 / 63)


def test_rrf_lexical_only_candidate():
    """Document appearing only in lexical ranking has semantic_rank=None and score from lexical only."""
    doc = make_test_doc("DOC_LEX_ONLY", "lexical only")
    lexical = [LexicalSearchResult(document_id="DOC_LEX_ONLY", rank=1, score=1.0, document=doc)]
    semantic: list[SemanticSearchResult] = []

    results = reciprocal_rank_fusion(lexical, semantic, k=60)
    assert len(results) == 1
    res = results[0]
    assert res.document_id == "DOC_LEX_ONLY"
    assert res.lexical_rank == 1
    assert res.semantic_rank is None
    assert pytest.approx(res.rrf_score) == 1.0 / 61


def test_rrf_semantic_only_candidate():
    """Document appearing only in semantic ranking has lexical_rank=None and score from semantic only."""
    doc = make_test_doc("DOC_SEM_ONLY", "semantic only")
    lexical: list[LexicalSearchResult] = []
    semantic = [SemanticSearchResult(document_id="DOC_SEM_ONLY", rank=2, score=0.8, distance=0.2, metadata={}, document=doc)]

    results = reciprocal_rank_fusion(lexical, semantic, k=60)
    assert len(results) == 1
    res = results[0]
    assert res.document_id == "DOC_SEM_ONLY"
    assert res.lexical_rank is None
    assert res.semantic_rank == 2
    assert pytest.approx(res.rrf_score) == 1.0 / 62


def test_rrf_stable_tie_breaking():
    """
    Ties in RRF score are broken deterministically by:
    1. Lexical rank
    2. Semantic rank
    3. Document ID
    """
    doc_1 = make_test_doc("DOC_1", "text 1")
    doc_2 = make_test_doc("DOC_2", "text 2")

    # doc_1: lex 1, sem 2 => 1/61 + 1/62
    # doc_2: lex 2, sem 1 => 1/62 + 1/61
    # Scores are mathematically identical!
    # doc_1 has earlier lexical rank (1 < 2), so doc_1 must win!
    lexical = [
        LexicalSearchResult(document_id="DOC_1", rank=1, score=1.0, document=doc_1),
        LexicalSearchResult(document_id="DOC_2", rank=2, score=0.9, document=doc_2),
    ]
    semantic = [
        SemanticSearchResult(document_id="DOC_2", rank=1, score=0.9, distance=0.1, metadata={}, document=doc_2),
        SemanticSearchResult(document_id="DOC_1", rank=2, score=0.8, distance=0.2, metadata={}, document=doc_1),
    ]

    results = reciprocal_rank_fusion(lexical, semantic, k=60)
    assert results[0].document_id == "DOC_1"
    assert results[1].document_id == "DOC_2"


def test_rrf_deterministic_ordering():
    """Multiple invocations produce deterministic ranking regardless of initial list state."""
    docs = [make_test_doc(f"DOC_{i}", f"text {i}") for i in range(5)]
    lexical = [LexicalSearchResult(document_id=f"DOC_{i}", rank=i + 1, score=1.0 / (i + 1), document=docs[i]) for i in range(5)]
    semantic = [SemanticSearchResult(document_id=f"DOC_{4 - i}", rank=i + 1, score=1.0 / (i + 1), distance=0.1 * i, metadata={}, document=docs[4 - i]) for i in range(5)]

    r1 = reciprocal_rank_fusion(lexical, semantic, k=60)
    r2 = reciprocal_rank_fusion(lexical, semantic, k=60)

    assert [x.document_id for x in r1] == [x.document_id for x in r2]
    assert [x.rrf_score for x in r1] == [x.rrf_score for x in r2]


def test_rrf_candidate_limit():
    """Specifying candidate limit truncates the fused output accurately."""
    docs = [make_test_doc(f"DOC_{i}", f"text {i}") for i in range(10)]
    lexical = [LexicalSearchResult(document_id=f"DOC_{i}", rank=i + 1, score=1.0, document=docs[i]) for i in range(10)]
    semantic: list[SemanticSearchResult] = []

    results = reciprocal_rank_fusion(lexical, semantic, k=60, limit=3)
    assert len(results) == 3
    assert [r.fusion_rank for r in results] == [1, 2, 3]
