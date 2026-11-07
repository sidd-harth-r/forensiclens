"""
Cross-Encoder Reranker for ForensicLens.

Provides local query-document pair scoring over bounded RRF candidate sets
using local cross-encoder models (e.g., BAAI/bge-reranker-base) with
offline-loading enforcement and deterministic testing doubles.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

from app.config import DEFAULT_RERANKER_MODEL, OFFLINE_MODE
from app.retrieval.embeddings import ModelNotReadyError
from app.retrieval.fusion import FusedSearchResult

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RerankedSearchResult:
    """A search result scored and ordered by the cross-encoder reranker."""
    document_id: str
    final_rank: int
    rerank_score: Optional[float]
    fused_result: FusedSearchResult


class BaseReranker(ABC):
    """Abstract protocol for local cross-encoder rerankers."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name or path identifier of the reranker model."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Check whether the model weights are available locally."""

    @abstractmethod
    def rerank(self, query: str, documents: list[str]) -> list[float]:
        """Compute relevance scores for (query, document) pairs."""


class LocalCrossEncoderReranker(BaseReranker):
    """
    Local cross-encoder reranker using sentence-transformers CrossEncoder.

    Executes 100% locally with offline mode support, scoring query-document
    pairs directly through transformer cross-attention.
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        *,
        offline: Optional[bool] = None,
    ):
        self._model_name = model_name or DEFAULT_RERANKER_MODEL
        self._offline = offline if offline is not None else OFFLINE_MODE
        self._model = None

    @property
    def model_name(self) -> str:
        return self._model_name

    def is_ready(self) -> bool:
        """Check whether model weights can be loaded."""
        if self._model is not None:
            return True
        try:
            self._ensure_loaded()
            return True
        except Exception:
            return False

    def _ensure_loaded(self) -> None:
        """Lazy load the cross-encoder model."""
        if self._model is not None:
            return

        try:
            from sentence_transformers import CrossEncoder

            logger.info(
                "Loading local cross-encoder reranker '%s' (offline=%s)",
                self._model_name,
                self._offline,
            )
            self._model = CrossEncoder(
                self._model_name,
                local_files_only=self._offline,
            )
        except Exception as exc:
            msg = (
                f"Local reranker model '{self._model_name}' could not be loaded "
                f"(offline_mode={self._offline}). Ensure model files exist locally in the "
                f"cache or models directory. Underlying error: {exc}"
            )
            logger.error(msg)
            raise ModelNotReadyError(msg) from exc

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        """Score (query, doc) pairs locally."""
        if not documents:
            return []

        self._ensure_loaded()
        pairs = [[query, doc] for doc in documents]
        scores = self._model.predict(pairs)
        return [float(s) for s in scores]


class FakeReranker(BaseReranker):
    """
    Deterministic test double for cross-encoder reranking.

    Computes deterministic relevance scores based on token overlap
    and query term occurrences without downloading model weights.
    """

    def __init__(self, model_name: str = "fake-bge-reranker-test"):
        self._model_name = model_name

    @property
    def model_name(self) -> str:
        return self._model_name

    def is_ready(self) -> bool:
        return True

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        """Compute deterministic pseudo-relevance scores."""
        query_words = set(query.lower().split())
        scores: list[float] = []

        for doc in documents:
            doc_lower = doc.lower()
            doc_words = set(doc_lower.split())
            if not query_words:
                scores.append(0.5)
                continue

            # Token overlap score + bonus for exact substring occurrences
            overlap = len(query_words & doc_words) / len(query_words)
            bonus = 0.2 if query.lower() in doc_lower else 0.0
            score = round(min(1.0, overlap * 0.8 + bonus), 4)
            scores.append(score)

        return scores


def rerank_candidates(
    reranker: BaseReranker,
    query: str,
    candidates: list[FusedSearchResult],
    *,
    candidate_limit: int = 30,
) -> list[RerankedSearchResult]:
    """
    Rerank a bounded candidate set using the provided cross-encoder reranker.

    Candidates beyond candidate_limit retain their relative RRF order.
    """
    if not candidates:
        return []

    rerank_pool = candidates[:candidate_limit]
    remaining = candidates[candidate_limit:]

    doc_texts = [cand.document.to_embedding_text() for cand in rerank_pool]
    scores = reranker.rerank(query, doc_texts)

    scored_items: list[tuple[float, FusedSearchResult]] = []
    for score, cand in zip(scores, rerank_pool):
        scored_items.append((score, cand))

    # Deterministic sorting:
    # 1. Rerank score descending (-score)
    # 2. RRF fusion rank ascending (earlier fusion rank wins ties)
    # 3. Document ID ascending (stable string tie-break)
    def rerank_sort_key(item: tuple[float, FusedSearchResult]):
        score, cand = item
        return (
            -score,
            cand.fusion_rank,
            cand.document_id,
        )

    scored_items.sort(key=rerank_sort_key)

    results: list[RerankedSearchResult] = []
    current_rank = 1

    # Reranked candidates
    for score, cand in scored_items:
        results.append(
            RerankedSearchResult(
                document_id=cand.document_id,
                final_rank=current_rank,
                rerank_score=score,
                fused_result=cand,
            )
        )
        current_rank += 1

    # Remaining candidates past cutoff retain relative RRF ordering
    for cand in remaining:
        results.append(
            RerankedSearchResult(
                document_id=cand.document_id,
                final_rank=current_rank,
                rerank_score=None,
                fused_result=cand,
            )
        )
        current_rank += 1

    return results
