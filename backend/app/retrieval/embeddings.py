"""
Local Embedding Models for ForensicLens.

Provides local-only BGE embedding generation with explicit offline-loading
enforcement and deterministic test doubles for fast, hermetic testing.
"""

from __future__ import annotations

import hashlib
import logging
import math
from abc import ABC, abstractmethod
from typing import Optional

from app.config import DEFAULT_EMBEDDING_MODEL, OFFLINE_MODE

logger = logging.getLogger(__name__)


class ModelNotReadyError(Exception):
    """Raised when an offline local model's files are not available."""


class BaseEmbeddingModel(ABC):
    """Abstract protocol for local embedding models."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name or path identifier of the embedding model."""

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Embedding vector dimension."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Check whether model weights are loaded and ready."""

    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Compute embeddings for a batch of documents."""

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        """Compute an embedding vector for a single query."""


class LocalBGEEmbeddingModel(BaseEmbeddingModel):
    """
    Local BGE sentence embedding model using sentence-transformers.

    Strictly supports offline-only execution without downloading
    external weights at runtime unless explicitly configured.
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        *,
        offline: Optional[bool] = None,
    ):
        self._model_name = model_name or DEFAULT_EMBEDDING_MODEL
        self._offline = offline if offline is not None else OFFLINE_MODE
        self._model = None
        self._dimension: int = 384  # Standard BGE-small dimension

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return self._dimension

    def is_ready(self) -> bool:
        """Return True if the underlying model is loaded or accessible."""
        if self._model is not None:
            return True
        try:
            self._ensure_loaded()
            return True
        except Exception:
            return False

    def _ensure_loaded(self) -> None:
        """Lazy load the sentence transformer model."""
        if self._model is not None:
            return

        try:
            from sentence_transformers import SentenceTransformer

            # In offline mode, enforce local_files_only to prevent network egress
            logger.info(
                "Loading local embedding model '%s' (offline=%s)",
                self._model_name,
                self._offline,
            )
            self._model = SentenceTransformer(
                self._model_name,
                local_files_only=self._offline,
            )
            # Inspect actual embedding dimension
            sample = self._model.encode(["probe"], normalize_embeddings=True)
            self._dimension = len(sample[0])
        except Exception as exc:
            msg = (
                f"Local embedding model '{self._model_name}' could not be loaded "
                f"(offline_mode={self._offline}). Ensure model files exist locally in the "
                f"HuggingFace cache or models directory. Underlying error: {exc}"
            )
            logger.error(msg)
            raise ModelNotReadyError(msg) from exc

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Compute normalized dense embeddings for document texts."""
        if not texts:
            return []
        self._ensure_loaded()
        embeddings = self._model.encode(texts, normalize_embeddings=True)
        return [vec.tolist() for vec in embeddings]

    def embed_query(self, text: str) -> list[float]:
        """Compute normalized dense embedding for a query string."""
        self._ensure_loaded()
        vec = self._model.encode([text], normalize_embeddings=True)[0]
        return vec.tolist()


class FakeEmbeddingModel(BaseEmbeddingModel):
    """
    Deterministic test double embedding model.

    Generates reproducible unit-normalized 384-dimensional vectors based on
    cryptographic hashing of the input string. Requires zero external weights
    and zero network requests.
    """

    def __init__(self, model_name: str = "fake-bge-small-test", dimension: int = 384):
        self._model_name = model_name
        self._dimension = dimension

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return self._dimension

    def is_ready(self) -> bool:
        return True

    def _text_to_vector(self, text: str) -> list[float]:
        """Convert arbitrary text into a deterministic, unit-normalized float vector."""
        vec: list[float] = []
        # Generate dimension floats by rolling SHA-256 hash
        seed = text.encode("utf-8")
        current_hash = hashlib.sha256(seed).digest()

        while len(vec) < self._dimension:
            for b in current_hash:
                vec.append((float(b) / 128.0) - 1.0)
                if len(vec) == self._dimension:
                    break
            current_hash = hashlib.sha256(current_hash).digest()

        # Normalize to unit length
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._text_to_vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._text_to_vector(text)
