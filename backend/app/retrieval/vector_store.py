"""
Case-Isolated Vector Store using ChromaDB.

Manages persistent embedding indices for individual forensic cases located at:
    data/cases/<case_id>/chroma/

Security & Privacy Constraints:
- Explicit precomputed embeddings only (no automatic model downloads).
- Telemetry explicitly disabled.
- Case isolation strictly enforced (each case has its own client/storage directory).
- Native encryption notice: ChromaDB does not provide native table-level encryption;
  it relies on underlying filesystem volume protection and OS-level access control.
"""

from __future__ import annotations

import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import chromadb
from chromadb.config import Settings

from app.retrieval.documents import RetrievalDocument

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SemanticSearchResult:
    """A ranked candidate returned by semantic vector search."""
    document_id: str
    rank: int  # 1-based rank
    score: float  # Similarity score (1.0 / (1.0 + distance))
    distance: float  # Cosine distance
    metadata: dict[str, Any]
    document: Optional[RetrievalDocument] = None


def sanitize_collection_name(case_id: str) -> str:
    """
    Format a compliant ChromaDB collection name.
    Chroma requirements: 3-63 chars, alphanumeric, underscores, hyphens, starts/ends with alphanumeric.
    """
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", case_id).strip("_")
    name = f"case_{safe}_records"
    if len(name) > 63:
        name = name[:63]
    return name


class CaseVectorStore:
    """
    Encapsulates a ChromaDB persistent client isolated to a single case.
    """

    def __init__(self, case_dir: str | Path, case_id: str):
        self._case_dir = Path(case_dir)
        self._case_id = case_id
        self._chroma_dir = self._case_dir / "chroma"
        self._collection_name = sanitize_collection_name(case_id)
        self._client: Optional[chromadb.PersistentClient] = None
        self._collection = None

    @property
    def chroma_dir(self) -> Path:
        return self._chroma_dir

    def _get_client(self) -> chromadb.PersistentClient:
        """Initialize or return the persistent Chroma client with telemetry disabled."""
        if self._client is None:
            self._chroma_dir.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(
                path=str(self._chroma_dir),
                settings=Settings(
                    anonymized_telemetry=False,
                    is_persistent=True,
                ),
            )
        return self._client

    def _get_collection(self):
        """Retrieve or create the case-isolated collection without default embedding function."""
        if self._collection is None:
            client = self._get_client()
            # embedding_function=None ensures Chroma never attempts to download models
            self._collection = client.get_or_create_collection(
                name=self._collection_name,
                metadata={"case_id": self._case_id, "hnsw:space": "cosine"},
                embedding_function=None,
            )
        return self._collection

    def get_indexed_count(self) -> int:
        """Return the number of documents indexed in the case's vector store."""
        try:
            coll = self._get_collection()
            return coll.count()
        except Exception:
            return 0

    def get_indexed_document_ids(self) -> set[str]:
        """Return the set of document IDs currently stored in the collection."""
        try:
            coll = self._get_collection()
            # Fetch all stored IDs without loading embeddings or documents
            res = coll.get(include=[])
            return set(res["ids"]) if res and "ids" in res else set()
        except Exception:
            return set()

    def add_documents(
        self,
        documents: list[RetrievalDocument],
        embeddings: list[list[float]],
    ) -> int:
        """
        Insert or update documents and precomputed embeddings into ChromaDB.

        Args:
            documents: List of RetrievalDocument instances.
            embeddings: Corresponding list of precomputed dense embedding vectors.

        Returns:
            Number of documents added.
        """
        if not documents:
            return 0

        if len(documents) != len(embeddings):
            raise ValueError(
                f"Mismatch: {len(documents)} documents but {len(embeddings)} embeddings provided."
            )

        coll = self._get_collection()

        ids = [doc.document_id for doc in documents]
        metadatas = [doc.to_metadata() for doc in documents]
        texts = [doc.raw_text for doc in documents]

        coll.upsert(
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=texts,
        )
        return len(ids)

    def query(
        self,
        query_embedding: list[float],
        *,
        n_results: int = 50,
        where: Optional[dict[str, Any]] = None,
    ) -> list[SemanticSearchResult]:
        """
        Query the case collection using an explicit precomputed query embedding.

        Args:
            query_embedding: The precomputed vector for the user query.
            n_results: Number of nearest neighbors to retrieve.
            where: Optional Chroma metadata filter.

        Returns:
            Ranked list of SemanticSearchResult objects.
        """
        coll = self._get_collection()
        total = coll.count()
        if total == 0:
            return []

        limit = min(n_results, total)

        kwargs: dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": limit,
            "include": ["metadatas", "distances", "documents"],
        }
        if where:
            kwargs["where"] = where

        res = coll.query(**kwargs)

        results: list[SemanticSearchResult] = []
        if not res or not res["ids"] or not res["ids"][0]:
            return results

        ids = res["ids"][0]
        distances = res["distances"][0] if res["distances"] else [0.0] * len(ids)
        metadatas = res["metadatas"][0] if res["metadatas"] else [{}] * len(ids)

        for rank_idx, (doc_id, dist, meta) in enumerate(zip(ids, distances, metadatas), start=1):
            # Cosine distance to similarity: similarity = 1.0 / (1.0 + max(0.0, dist))
            score = 1.0 / (1.0 + max(0.0, float(dist)))
            results.append(
                SemanticSearchResult(
                    document_id=doc_id,
                    rank=rank_idx,
                    score=score,
                    distance=float(dist),
                    metadata=meta,
                )
            )

        return results

    def delete_documents(self, document_ids: list[str]) -> int:
        """Remove documents and their embeddings from the ChromaDB collection."""
        if not document_ids:
            return 0
        coll = self._get_collection()
        coll.delete(ids=document_ids)
        return len(document_ids)

    def rebuild(self) -> None:
        """Drop the existing collection and clear vector storage to force complete rebuild."""
        try:
            client = self._get_client()
            client.delete_collection(self._collection_name)
        except Exception as exc:
            logger.debug("Collection deletion note during rebuild: %s", exc)

        self._collection = None
