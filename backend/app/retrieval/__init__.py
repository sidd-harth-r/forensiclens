"""
ForensicLens Hybrid Forensic Retrieval Engine.

Combines SQLite FTS5 lexical retrieval, local dense sentence embeddings
via BGE and ChromaDB, Reciprocal Rank Fusion (RRF), and Cross-Encoder
reranking into a unified, privacy-preserving, case-isolated engine.
"""

from __future__ import annotations

from app.retrieval.documents import RetrievalDocument
from app.retrieval.embeddings import (
    BaseEmbeddingModel,
    FakeEmbeddingModel,
    LocalBGEEmbeddingModel,
    ModelNotReadyError,
)
from app.retrieval.fusion import FusedSearchResult, reciprocal_rank_fusion
from app.retrieval.lexical import LexicalSearchResult, LexicalSearchService, sanitize_fts5_query
from app.retrieval.reranker import (
    BaseReranker,
    FakeReranker,
    LocalCrossEncoderReranker,
    RerankedSearchResult,
    rerank_candidates,
)
from app.retrieval.schemas import (
    RetrievalFilters,
    RetrievalIndexRequest,
    RetrievalIndexResponse,
    RetrievalMode,
    RetrievalResultItem,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievalStatusResponse,
)
from app.retrieval.service import RetrievalOrchestrator
from app.retrieval.vector_store import CaseVectorStore, SemanticSearchResult

__all__ = [
    "RetrievalDocument",
    "BaseEmbeddingModel",
    "LocalBGEEmbeddingModel",
    "FakeEmbeddingModel",
    "ModelNotReadyError",
    "CaseVectorStore",
    "SemanticSearchResult",
    "LexicalSearchResult",
    "LexicalSearchService",
    "sanitize_fts5_query",
    "FusedSearchResult",
    "reciprocal_rank_fusion",
    "BaseReranker",
    "LocalCrossEncoderReranker",
    "FakeReranker",
    "RerankedSearchResult",
    "rerank_candidates",
    "RetrievalOrchestrator",
    "RetrievalMode",
    "RetrievalFilters",
    "RetrievalSearchRequest",
    "RetrievalSearchResponse",
    "RetrievalResultItem",
    "RetrievalIndexRequest",
    "RetrievalIndexResponse",
    "RetrievalStatusResponse",
]
