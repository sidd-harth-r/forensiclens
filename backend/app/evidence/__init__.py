"""
Evidence ingestion module.

Provides SHA-256 hashing, immutable artifact storage, and evidence
record management for per-case forensic evidence files.
"""

from app.evidence.hashing import (
    compute_sha256,
    compute_sha256_with_size,
    verify_file_hash,
)
from app.evidence.service import (
    DuplicateEvidenceError,
    EvidenceIngestionError,
    EvidenceIntegrityError,
    EvidenceNotFoundError,
    EvidenceRecord,
    generate_evidence_id,
    get_evidence,
    ingest_evidence,
    list_evidence,
    verify_evidence_integrity,
)
from app.evidence.storage import (
    EvidenceStorageError,
    get_evidence_dir,
    get_evidence_path,
    remove_evidence,
    store_evidence,
)

__all__ = [
    "DuplicateEvidenceError",
    "EvidenceIngestionError",
    "EvidenceIntegrityError",
    "EvidenceNotFoundError",
    "EvidenceRecord",
    "EvidenceStorageError",
    "compute_sha256",
    "compute_sha256_with_size",
    "generate_evidence_id",
    "get_evidence",
    "get_evidence_dir",
    "get_evidence_path",
    "ingest_evidence",
    "list_evidence",
    "remove_evidence",
    "store_evidence",
    "verify_evidence_integrity",
    "verify_file_hash",
]
