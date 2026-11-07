"""
Hybrid Forensic Retrieval Orchestration Service.

Connects Lexical Search (FTS5), Dense Semantic Search (BGE + ChromaDB),
Reciprocal Rank Fusion (RRF), and Cross-Encoder Reranking into an end-to-end,
case-isolated forensic search pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.cases.database import close_case_db, open_case_db
from app.config import (
    DEFAULT_EMBEDDING_BATCH_SIZE,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_LEXICAL_CANDIDATES,
    DEFAULT_RERANK_CANDIDATES,
    DEFAULT_RERANKER_MODEL,
    DEFAULT_RRF_K,
    DEFAULT_SEMANTIC_CANDIDATES,
    DEFAULT_TOP_K,
    OFFLINE_MODE,
)
from app.retrieval.documents import (
    RetrievalDocument,
    count_case_source_records,
    fetch_retrieval_documents,
)
from app.retrieval.embeddings import (
    BaseEmbeddingModel,
    LocalBGEEmbeddingModel,
)
from app.retrieval.fusion import FusedSearchResult, reciprocal_rank_fusion
from app.retrieval.lexical import LexicalSearchResult, LexicalSearchService
from app.retrieval.reranker import (
    BaseReranker,
    LocalCrossEncoderReranker,
    rerank_candidates,
)
from app.retrieval.schemas import (
    RetrievalIndexRequest,
    RetrievalIndexResponse,
    RetrievalMode,
    RetrievalResultItem,
    RetrievalSearchRequest,
    RetrievalSearchResponse,
    RetrievalStatusResponse,
)
from app.retrieval.vector_store import CaseVectorStore, SemanticSearchResult

logger = logging.getLogger(__name__)


class RetrievalOrchestrator:
    """
    Main retrieval orchestrator coordinating indexing, search, fusion, and reranking.
    """

    def __init__(
        self,
        embedding_model: Optional[BaseEmbeddingModel] = None,
        reranker: Optional[BaseReranker] = None,
        lexical_service: Optional[LexicalSearchService] = None,
    ):
        self._embedding_model = embedding_model or LocalBGEEmbeddingModel()
        self._reranker = reranker or LocalCrossEncoderReranker()
        self._lexical_service = lexical_service or LexicalSearchService()

    @property
    def embedding_model(self) -> BaseEmbeddingModel:
        return self._embedding_model

    @property
    def reranker(self) -> BaseReranker:
        return self._reranker

    def _get_case_dir(self, cases_dir: str | Path, case_id: str) -> Path:
        return Path(cases_dir) / case_id

    def _get_case_db_path(self, cases_dir: str | Path, case_id: str) -> Path:
        return self._get_case_dir(cases_dir, case_id) / "case.db"

    def get_status(
        self,
        cases_dir: str | Path,
        case_id: str,
    ) -> RetrievalStatusResponse:
        """
        Inspect the indexing and model status for a case.
        """
        db_path = self._get_case_db_path(cases_dir, case_id)
        if not db_path.is_file():
            raise FileNotFoundError(f"Case database '{case_id}' not found.")

        case_dir = self._get_case_dir(cases_dir, case_id)
        vector_store = CaseVectorStore(case_dir, case_id)

        conn = open_case_db(db_path)
        try:
            total_records = count_case_source_records(conn, case_id)
        finally:
            close_case_db(conn)

        indexed_records = vector_store.get_indexed_count()
        is_indexed = indexed_records > 0 and indexed_records == total_records

        if total_records == 0 and indexed_records == 0:
            index_status = "EMPTY"
        elif total_records == 0 and indexed_records > 0:
            index_status = "STALE"
        elif indexed_records == 0:
            index_status = "UNINDEXED"
        elif indexed_records < total_records:
            index_status = "PARTIAL"
        elif indexed_records > total_records:
            index_status = "STALE"
        else:
            index_status = "READY"

        emb_ready = self._embedding_model.is_ready()
        rerank_ready = self._reranker.is_ready()

        return RetrievalStatusResponse(
            caseId=case_id,
            totalRecords=total_records,
            indexedRecords=indexed_records,
            isIndexed=is_indexed,
            indexStatus=index_status,
            embeddingModel=self._embedding_model.model_name,
            rerankerModel=self._reranker.model_name,
            embeddingModelReady=emb_ready,
            rerankerModelReady=rerank_ready,
            offlineMode=OFFLINE_MODE,
            lastIndexedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if is_indexed else None,
        )

    def index_case(
        self,
        cases_dir: str | Path,
        case_id: str,
        request: Optional[RetrievalIndexRequest] = None,
    ) -> RetrievalIndexResponse:
        """
        Index or re-index a case's source records into ChromaDB.
        """
        req = request or RetrievalIndexRequest()
        db_path = self._get_case_db_path(cases_dir, case_id)
        if not db_path.is_file():
            raise FileNotFoundError(f"Case database '{case_id}' not found.")

        case_dir = self._get_case_dir(cases_dir, case_id)
        vector_store = CaseVectorStore(case_dir, case_id)

        if req.rebuild:
            logger.info("Rebuilding vector store index for case '%s'", case_id)
            vector_store.rebuild()

        conn = open_case_db(db_path)
        try:
            total_records = count_case_source_records(conn, case_id)
            if total_records == 0:
                return RetrievalIndexResponse(
                    caseId=case_id,
                    indexedCount=0,
                    totalIndexed=0,
                    status="UP_TO_DATE",
                    message="Case contains zero source records to index.",
                )

            # Detect valid current document IDs in SQLite
            all_valid_docs = fetch_retrieval_documents(conn, case_id)
            valid_doc_ids = {d.document_id for d in all_valid_docs}

            # Detect which records are already indexed in Chroma
            existing_ids = vector_store.get_indexed_document_ids()

            # Prune any deleted or orphaned records from Chroma
            orphaned_ids = existing_ids - valid_doc_ids
            if orphaned_ids:
                vector_store.delete_documents(list(orphaned_ids))
                existing_ids = existing_ids - orphaned_ids

            # Stream records in batches from SQLite to avoid RAM bloat
            batch_size = req.batch_size or DEFAULT_EMBEDDING_BATCH_SIZE
            offset = 0
            indexed_now = 0

            while True:
                docs = fetch_retrieval_documents(
                    conn,
                    case_id,
                    limit=batch_size,
                    offset=offset,
                )
                if not docs:
                    break

                # Filter unindexed documents
                unindexed_docs = [d for d in docs if d.document_id not in existing_ids]

                if unindexed_docs:
                    # Generate embeddings locally
                    texts = [d.to_embedding_text() for d in unindexed_docs]
                    embeddings = self._embedding_model.embed_documents(texts)
                    vector_store.add_documents(unindexed_docs, embeddings)
                    indexed_now += len(unindexed_docs)

                offset += len(docs)

            total_indexed = vector_store.get_indexed_count()
            return RetrievalIndexResponse(
                caseId=case_id,
                indexedCount=indexed_now,
                totalIndexed=total_indexed,
                status="COMPLETED" if indexed_now > 0 else "UP_TO_DATE",
                message=f"Successfully indexed {indexed_now} new records. Total indexed: {total_indexed}.",
            )
        finally:
            close_case_db(conn)

    def search(
        self,
        cases_dir: str | Path,
        case_id: str,
        request: RetrievalSearchRequest,
    ) -> RetrievalSearchResponse:
        """
        Execute end-to-end forensic evidence retrieval under the selected mode.
        """
        db_path = self._get_case_db_path(cases_dir, case_id)
        if not db_path.is_file():
            raise FileNotFoundError(f"Case database '{case_id}' not found.")

        case_dir = self._get_case_dir(cases_dir, case_id)
        vector_store = CaseVectorStore(case_dir, case_id)

        conn = open_case_db(db_path)
        try:
            mode = request.mode
            top_k = request.top_k or DEFAULT_TOP_K
            lex_limit = request.lexical_candidates or DEFAULT_LEXICAL_CANDIDATES
            sem_limit = request.semantic_candidates or DEFAULT_SEMANTIC_CANDIDATES
            rerank_limit = request.rerank_candidates or DEFAULT_RERANK_CANDIDATES

            # -------------------------------------------------------------
            # Branch A: Lexical Retrieval
            # -------------------------------------------------------------
            lexical_results: list[LexicalSearchResult] = []
            if mode in (RetrievalMode.KEYWORD_ONLY, RetrievalMode.HYBRID, RetrievalMode.HYBRID_RERANKED):
                lexical_results = self._lexical_service.search(
                    conn,
                    case_id,
                    request.query,
                    limit=lex_limit,
                    filters=request.filters,
                )

            # Short-circuit KEYWORD_ONLY
            if mode == RetrievalMode.KEYWORD_ONLY:
                items: list[RetrievalResultItem] = []
                for rank_idx, lex in enumerate(lexical_results[:top_k], start=1):
                    doc = lex.document
                    items.append(
                        RetrievalResultItem(
                            documentId=doc.document_id,
                            rawRecordId=doc.raw_record_id,
                            eventId=doc.event_id,
                            evidenceId=doc.evidence_id,
                            originalFilename=doc.original_filename,
                            recordNo=doc.record_no,
                            lineNumber=doc.line_number,
                            byteStart=doc.byte_start,
                            byteEnd=doc.byte_end,
                            text=doc.raw_text,
                            timestamp=doc.timestamp,
                            eventType=doc.event_type,
                            severity=doc.severity,
                            user=doc.user_value,
                            srcIp=doc.src_ip,
                            lexicalRank=lex.rank,
                            semanticRank=None,
                            rrfScore=None,
                            rerankScore=None,
                            finalRank=rank_idx,
                        )
                    )
                return RetrievalSearchResponse(
                    items=items,
                    total=len(items),
                    retrievalMode=mode,
                    query=request.query,
                    caseId=case_id,
                )

            # -------------------------------------------------------------
            # Branch B: Semantic Retrieval
            # -------------------------------------------------------------
            semantic_results: list[SemanticSearchResult] = []
            if mode in (RetrievalMode.SEMANTIC_ONLY, RetrievalMode.HYBRID, RetrievalMode.HYBRID_RERANKED):
                # Ensure vector index contains records
                if vector_store.get_indexed_count() == 0:
                    # Auto-index if vector store is empty to provide seamless first-time search
                    self.index_case(cases_dir, case_id)

                query_vec = self._embedding_model.embed_query(request.query)

                # Optional metadata filters for Chroma
                where_filter = None
                if request.filters:
                    clauses: list[dict] = []
                    if request.filters.event_type:
                        clauses.append({"event_type": request.filters.event_type})
                    if request.filters.severity:
                        clauses.append({"severity": request.filters.severity})
                    if request.filters.user:
                        clauses.append({"user_value": request.filters.user})
                    if request.filters.src_ip:
                        clauses.append({"src_ip": request.filters.src_ip})
                    if request.filters.evidence_id:
                        clauses.append({"evidence_id": request.filters.evidence_id})

                    if len(clauses) == 1:
                        where_filter = clauses[0]
                    elif len(clauses) > 1:
                        where_filter = {"$and": clauses}

                raw_sem = vector_store.query(
                    query_vec,
                    n_results=sem_limit,
                    where=where_filter,
                )

                # Enrich semantic candidates with full SQLite RetrievalDocument provenance
                if raw_sem:
                    sem_raw_ids = [s.metadata.get("raw_record_id") for s in raw_sem if "raw_record_id" in s.metadata]
                    valid_raw_ids = [rid for rid in sem_raw_ids if rid]
                    loaded_docs = fetch_retrieval_documents(conn, case_id, raw_record_ids=valid_raw_ids)
                    doc_map = {d.raw_record_id: d for d in loaded_docs}

                    for s in raw_sem:
                        rid = s.metadata.get("raw_record_id")
                        doc = doc_map.get(rid) if rid else None
                        if doc:
                            # Apply time range filters if requested
                            if request.filters:
                                if request.filters.from_time and doc.timestamp and doc.timestamp < request.filters.from_time:
                                    continue
                                if request.filters.to_time and doc.timestamp and doc.timestamp > request.filters.to_time:
                                    continue
                            semantic_results.append(
                                SemanticSearchResult(
                                    document_id=s.document_id,
                                    rank=s.rank,
                                    score=s.score,
                                    distance=s.distance,
                                    metadata=s.metadata,
                                    document=doc,
                                )
                            )

            # Short-circuit SEMANTIC_ONLY
            if mode == RetrievalMode.SEMANTIC_ONLY:
                items = []
                for rank_idx, sem in enumerate(semantic_results[:top_k], start=1):
                    doc = sem.document
                    if not doc:
                        continue
                    items.append(
                        RetrievalResultItem(
                            documentId=doc.document_id,
                            rawRecordId=doc.raw_record_id,
                            eventId=doc.event_id,
                            evidenceId=doc.evidence_id,
                            originalFilename=doc.original_filename,
                            recordNo=doc.record_no,
                            lineNumber=doc.line_number,
                            byteStart=doc.byte_start,
                            byteEnd=doc.byte_end,
                            text=doc.raw_text,
                            timestamp=doc.timestamp,
                            eventType=doc.event_type,
                            severity=doc.severity,
                            user=doc.user_value,
                            srcIp=doc.src_ip,
                            lexicalRank=None,
                            semanticRank=sem.rank,
                            rrfScore=None,
                            rerankScore=None,
                            finalRank=rank_idx,
                        )
                    )
                return RetrievalSearchResponse(
                    items=items,
                    total=len(items),
                    retrievalMode=mode,
                    query=request.query,
                    caseId=case_id,
                )

            # -------------------------------------------------------------
            # Branch C: Reciprocal Rank Fusion (HYBRID & HYBRID_RERANKED)
            # -------------------------------------------------------------
            fused_candidates = reciprocal_rank_fusion(
                lexical_results,
                semantic_results,
                k=DEFAULT_RRF_K,
                limit=rerank_limit if mode == RetrievalMode.HYBRID_RERANKED else top_k,
            )

            # Short-circuit HYBRID (without reranker)
            if mode == RetrievalMode.HYBRID:
                items = []
                for rank_idx, fused in enumerate(fused_candidates[:top_k], start=1):
                    doc = fused.document
                    items.append(
                        RetrievalResultItem(
                            documentId=doc.document_id,
                            rawRecordId=doc.raw_record_id,
                            eventId=doc.event_id,
                            evidenceId=doc.evidence_id,
                            originalFilename=doc.original_filename,
                            recordNo=doc.record_no,
                            lineNumber=doc.line_number,
                            byteStart=doc.byte_start,
                            byteEnd=doc.byte_end,
                            text=doc.raw_text,
                            timestamp=doc.timestamp,
                            eventType=doc.event_type,
                            severity=doc.severity,
                            user=doc.user_value,
                            srcIp=doc.src_ip,
                            lexicalRank=fused.lexical_rank,
                            semanticRank=fused.semantic_rank,
                            rrfScore=fused.rrf_score,
                            rerankScore=None,
                            finalRank=rank_idx,
                        )
                    )
                return RetrievalSearchResponse(
                    items=items,
                    total=len(items),
                    retrievalMode=mode,
                    query=request.query,
                    caseId=case_id,
                )

            # -------------------------------------------------------------
            # Branch D: Cross-Encoder Reranking (HYBRID_RERANKED)
            # -------------------------------------------------------------
            reranked = rerank_candidates(
                self._reranker,
                request.query,
                fused_candidates,
                candidate_limit=rerank_limit,
            )

            items = []
            for item in reranked[:top_k]:
                doc = item.fused_result.document
                items.append(
                    RetrievalResultItem(
                        documentId=doc.document_id,
                        rawRecordId=doc.raw_record_id,
                        eventId=doc.event_id,
                        evidenceId=doc.evidence_id,
                        originalFilename=doc.original_filename,
                        recordNo=doc.record_no,
                        lineNumber=doc.line_number,
                        byteStart=doc.byte_start,
                        byteEnd=doc.byte_end,
                        text=doc.raw_text,
                        timestamp=doc.timestamp,
                        eventType=doc.event_type,
                        severity=doc.severity,
                        user=doc.user_value,
                        srcIp=doc.src_ip,
                        lexicalRank=item.fused_result.lexical_rank,
                        semanticRank=item.fused_result.semantic_rank,
                        rrfScore=item.fused_result.rrf_score,
                        rerankScore=item.rerank_score,
                        finalRank=item.final_rank,
                    )
                )

            return RetrievalSearchResponse(
                items=items,
                total=len(items),
                retrievalMode=mode,
                query=request.query,
                caseId=case_id,
            )
        finally:
            close_case_db(conn)
