"""
Pydantic schemas for the ForensicLens Hybrid Retrieval Engine.

Defines schemas for retrieval search, indexing, status checks,
filtering, and document representation adhering to API conventions.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class RetrievalMode(str, Enum):
    """
    Selectable retrieval modes for research evaluation and ablation studies.
    """
    KEYWORD_ONLY = "KEYWORD_ONLY"
    SEMANTIC_ONLY = "SEMANTIC_ONLY"
    HYBRID = "HYBRID"
    HYBRID_RERANKED = "HYBRID_RERANKED"


class RetrievalFilters(BaseModel):
    """
    Structured query filters applied across structured attributes.
    """
    model_config = ConfigDict(populate_by_name=True)

    event_type: Optional[str] = Field(None, alias="eventType", description="Normalized event type filter")
    severity: Optional[str] = Field(None, description="Event severity filter (INFO, WARNING, ERROR, CRITICAL)")
    user: Optional[str] = Field(None, description="Target username / actor filter")
    src_ip: Optional[str] = Field(None, alias="srcIp", description="Source IP address filter")
    from_time: Optional[str] = Field(None, alias="fromTime", description="ISO 8601 UTC lower bound")
    to_time: Optional[str] = Field(None, alias="toTime", description="ISO 8601 UTC upper bound")
    evidence_id: Optional[str] = Field(None, alias="evidenceId", description="Evidence file identifier filter")


class RetrievalSearchRequest(BaseModel):
    """
    Request payload for hybrid forensic evidence retrieval.
    """
    model_config = ConfigDict(populate_by_name=True)

    query: str = Field(..., min_length=1, max_length=1000, description="Natural-language or keyword investigation query")
    top_k: int = Field(10, alias="topK", ge=1, le=100, description="Number of final ranked results to return")
    lexical_candidates: int = Field(50, alias="lexicalCandidates", ge=1, le=200, description="Number of lexical candidates to retrieve")
    semantic_candidates: int = Field(50, alias="semanticCandidates", ge=1, le=200, description="Number of semantic candidates to retrieve")
    rerank_candidates: int = Field(30, alias="rerankCandidates", ge=1, le=100, description="Number of top candidates passed to the reranker")
    mode: RetrievalMode = Field(RetrievalMode.HYBRID, description="Retrieval evaluation mode")
    filters: Optional[RetrievalFilters] = Field(None, description="Optional structured metadata filters")


class RetrievalResultItem(BaseModel):
    """
    Single retrieved source evidence record with complete forensic provenance.
    """
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(..., alias="documentId", description="Deterministic retrieval document identifier")
    raw_record_id: str = Field(..., alias="rawRecordId", description="Underlying raw record identifier")
    event_id: Optional[str] = Field(None, alias="eventId", description="Associated normalized event ID if parsed")
    evidence_id: str = Field(..., alias="evidenceId", description="Evidence artifact identifier")
    original_filename: str = Field(..., alias="originalFilename", description="Evidence original filename")
    record_no: int = Field(..., alias="recordNo", description="1-based sequence index in original evidence")
    line_number: Optional[int] = Field(None, alias="lineNumber", description="Line number in original file")
    byte_start: Optional[int] = Field(None, alias="byteStart", description="Starting byte offset in original file")
    byte_end: Optional[int] = Field(None, alias="byteEnd", description="Ending byte offset in original file")
    text: str = Field(..., description="Original raw evidence text (escaped)")
    timestamp: Optional[str] = Field(None, description="Normalized UTC or original timestamp")
    event_type: Optional[str] = Field(None, alias="eventType", description="Normalized event type")
    severity: Optional[str] = Field(None, description="Event severity classification")
    user: Optional[str] = Field(None, description="Associated user identity")
    src_ip: Optional[str] = Field(None, alias="srcIp", description="Source IP address")
    lexical_rank: Optional[int] = Field(None, alias="lexicalRank", description="1-based rank in lexical search results")
    semantic_rank: Optional[int] = Field(None, alias="semanticRank", description="1-based rank in semantic search results")
    rrf_score: Optional[float] = Field(None, alias="rrfScore", description="Reciprocal Rank Fusion score")
    rerank_score: Optional[float] = Field(None, alias="rerankScore", description="Cross-encoder relevance score")
    final_rank: int = Field(..., alias="finalRank", description="Final 1-based output rank")


class RetrievalSearchResponse(BaseModel):
    """
    Response envelope containing ranked forensic retrieval results.
    """
    model_config = ConfigDict(populate_by_name=True)

    items: list[RetrievalResultItem] = Field(..., description="Ranked retrieved evidence records")
    total: int = Field(..., description="Total items returned")
    retrieval_mode: RetrievalMode = Field(..., alias="retrievalMode", description="Executed retrieval mode")
    query: str = Field(..., description="Original query string")
    case_id: str = Field(..., alias="caseId", description="Scoping case identifier")


class RetrievalIndexRequest(BaseModel):
    """
    Request payload to trigger incremental indexing or complete index rebuild.
    """
    model_config = ConfigDict(populate_by_name=True)

    rebuild: bool = Field(False, description="Whether to drop and rebuild the collection from scratch")
    batch_size: int = Field(32, alias="batchSize", ge=1, le=500, description="Embedding batch size")


class RetrievalIndexResponse(BaseModel):
    """
    Response returned after an indexing operation completes.
    """
    model_config = ConfigDict(populate_by_name=True)

    case_id: str = Field(..., alias="caseId")
    indexed_count: int = Field(..., alias="indexedCount", description="Number of new records embedded and indexed")
    total_indexed: int = Field(..., alias="totalIndexed", description="Total records currently in the vector index")
    status: str = Field(..., description="Status ('COMPLETED', 'UP_TO_DATE', etc.)")
    message: str = Field(..., description="Summary message of the operation")


class RetrievalStatusResponse(BaseModel):
    """
    Vector index and model readiness status for a case.
    """
    model_config = ConfigDict(populate_by_name=True)

    case_id: str = Field(..., alias="caseId")
    total_records: int = Field(..., alias="totalRecords", description="Total raw source records in the case database")
    indexed_records: int = Field(..., alias="indexedRecords", description="Total documents in the ChromaDB collection")
    is_indexed: bool = Field(..., alias="isIndexed", description="Whether the collection has indexed records")
    index_status: str = Field(..., alias="indexStatus", description="Index state ('READY', 'UNINDEXED', 'EMPTY', 'STALE')")
    embedding_model: str = Field(..., alias="embeddingModel", description="Configured embedding model identifier")
    reranker_model: str = Field(..., alias="rerankerModel", description="Configured reranker model identifier")
    embedding_model_ready: bool = Field(..., alias="embeddingModelReady", description="Whether embedding model weights are loaded/available")
    reranker_model_ready: bool = Field(..., alias="rerankerModelReady", description="Whether reranker model weights are loaded/available")
    offline_mode: bool = Field(..., alias="offlineMode", description="Whether offline mode is enforced")
    last_indexed_at: Optional[str] = Field(None, alias="lastIndexedAt", description="Timestamp of the most recent indexing operation")
