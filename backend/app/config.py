"""
ForensicLens application configuration.

Resolves storage paths, environment settings, and runtime defaults.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# Safe identifier pattern for case_id, evidence_id, event_id
SAFE_ID_REGEX = re.compile(r"^[A-Za-z0-9_\-]+$")

# Project root: directory containing 'backend' and 'data'
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def get_data_dir() -> Path:
    """Return configured data root directory."""
    raw = os.environ.get("DATA_DIR")
    if raw:
        p = Path(raw)
        if not p.is_absolute():
            return (PROJECT_ROOT / p).resolve()
        return p.resolve()
    return (PROJECT_ROOT / "data").resolve()


def get_cases_dir() -> Path:
    """Return configured cases directory containing per-case folders."""
    raw = os.environ.get("CASES_DIR")
    if raw:
        p = Path(raw)
        if not p.is_absolute():
            return (PROJECT_ROOT / p).resolve()
        return p.resolve()
    return get_data_dir() / "cases"


# ---------------------------------------------------------------------------
# Retrieval and Model Settings (Step 7)
# ---------------------------------------------------------------------------

DEFAULT_EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
DEFAULT_RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-base")
OFFLINE_MODE = os.environ.get("OFFLINE_MODE", "true").lower() in ("true", "1", "yes")

DEFAULT_RRF_K = int(os.environ.get("RRF_K", "60"))
DEFAULT_LEXICAL_CANDIDATES = int(os.environ.get("LEXICAL_CANDIDATES", "50"))
DEFAULT_SEMANTIC_CANDIDATES = int(os.environ.get("SEMANTIC_CANDIDATES", "50"))
DEFAULT_RERANK_CANDIDATES = int(os.environ.get("RERANK_CANDIDATES", "30"))
DEFAULT_TOP_K = int(os.environ.get("TOP_K", "10"))
DEFAULT_EMBEDDING_BATCH_SIZE = int(os.environ.get("EMBEDDING_BATCH_SIZE", "32"))
