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

