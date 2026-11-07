"""
Reciprocal Rank Fusion (RRF) for ForensicLens.

Implements the standard Reciprocal Rank Fusion algorithm:
    RRF(d) = Σ 1 / (k + rank_i(d))

Provides transparent, deterministic multi-system ranking between
lexical and semantic candidates without score scaling artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.config import DEFAULT_RRF_K
from app.retrieval.documents import RetrievalDocument
from app.retrieval.lexical import LexicalSearchResult
from app.retrieval.vector_store import SemanticSearchResult


@dataclass(frozen=True)
class FusedSearchResult:
    """A candidate merged and ranked via Reciprocal Rank Fusion."""
    document_id: str
    fusion_rank: int  # 1-based rank after fusion
    rrf_score: float  # Mathematical RRF score
    lexical_rank: Optional[int]  # 1-based rank in lexical results (if present)
    semantic_rank: Optional[int]  # 1-based rank in semantic results (if present)
    document: RetrievalDocument


def reciprocal_rank_fusion(
    lexical_results: list[LexicalSearchResult],
    semantic_results: list[SemanticSearchResult],
    *,
    k: int = DEFAULT_RRF_K,
    limit: Optional[int] = None,
) -> list[FusedSearchResult]:
    """
    Fuse ranked lexical and semantic search results using Reciprocal Rank Fusion.

    Args:
        lexical_results: Ranked results from lexical search.
        semantic_results: Ranked results from semantic vector search (must contain .document).
        k: Smoothing constant (default 60).
        limit: Optional candidate cutoff.

    Returns:
        Deterministically ordered list of FusedSearchResult items.
    """
    scores: dict[str, float] = {}
    lex_ranks: dict[str, int] = {}
    sem_ranks: dict[str, int] = {}
    docs: dict[str, RetrievalDocument] = {}

    # Accumulate lexical contributions (best rank per document)
    for item in lexical_results:
        doc_id = item.document_id
        if doc_id in lex_ranks:
            continue
        lex_ranks[doc_id] = item.rank
        scores[doc_id] = scores.get(doc_id, 0.0) + (1.0 / (k + item.rank))
        docs[doc_id] = item.document

    # Accumulate semantic contributions (best rank per document)
    for item in semantic_results:
        doc_id = item.document_id
        if doc_id in sem_ranks:
            continue
        sem_ranks[doc_id] = item.rank
        scores[doc_id] = scores.get(doc_id, 0.0) + (1.0 / (k + item.rank))
        if item.document is not None and doc_id not in docs:
            docs[doc_id] = item.document

    # Deterministic sorting:
    # 1. RRF score descending (-score)
    # 2. Lexical rank ascending (earlier lexical match wins ties)
    # 3. Semantic rank ascending (earlier semantic match wins ties)
    # 4. Document ID ascending (stable string tie-break)
    def sort_key(doc_id: str):
        return (
            -scores[doc_id],
            lex_ranks.get(doc_id, 999999),
            sem_ranks.get(doc_id, 999999),
            doc_id,
        )

    sorted_ids = sorted(scores.keys(), key=sort_key)

    if limit is not None and limit > 0:
        sorted_ids = sorted_ids[:limit]

    fused: list[FusedSearchResult] = []
    for rank_idx, doc_id in enumerate(sorted_ids, start=1):
        doc = docs.get(doc_id)
        if doc is None:
            continue
        fused.append(
            FusedSearchResult(
                document_id=doc_id,
                fusion_rank=rank_idx,
                rrf_score=scores[doc_id],
                lexical_rank=lex_ranks.get(doc_id),
                semantic_rank=sem_ranks.get(doc_id),
                document=doc,
            )
        )

    return fused
