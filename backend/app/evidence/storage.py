"""
Immutable evidence artifact storage.

Manages the filesystem layout for storing forensic evidence files
within each case's isolated directory. Evidence artifacts are stored
as immutable originals and are never modified after ingestion.

Storage layout per ARCHITECTURE.md:

    data/cases/<case_id>/
    ├── case.db
    └── evidence/
        └── objects/
            └── <evidence_id>       # immutable original bytes

The original filename is preserved only as database metadata. The
actual storage path is derived from trusted identifiers (case_id
and evidence_id) to prevent path traversal attacks.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import BinaryIO

from app.evidence.hashing import compute_sha256


class EvidenceStorageError(Exception):
    """Raised when evidence storage operations fail."""


def get_evidence_dir(case_dir: str | Path) -> Path:
    """
    Return the evidence objects directory for a case.

    Structure: <case_dir>/evidence/objects/

    Args:
        case_dir: Path to the case directory (contains case.db).

    Returns:
        Path to the evidence objects directory.
    """
    return Path(case_dir) / "evidence" / "objects"


def get_evidence_path(case_dir: str | Path, evidence_id: str) -> Path:
    """
    Return the path to a stored evidence artifact file.

    Structure: <case_dir>/evidence/objects/<evidence_id>

    Args:
        case_dir: Path to the case directory.
        evidence_id: Unique evidence identifier.

    Returns:
        Path to the immutable original evidence file.
    """
    return get_evidence_dir(case_dir) / evidence_id


def _sanitize_evidence_id(evidence_id: str) -> str:
    """
    Validate that an evidence ID does not contain path traversal components.

    Raises:
        EvidenceStorageError: If the evidence ID contains unsafe characters.
    """
    # Reject empty IDs
    if not evidence_id or not evidence_id.strip():
        raise EvidenceStorageError("Evidence ID must not be empty")

    # Reject path separators and traversal sequences
    for dangerous in ("..", "/", "\\", "\x00"):
        if dangerous in evidence_id:
            raise EvidenceStorageError(
                f"Evidence ID contains unsafe characters: {evidence_id!r}"
            )

    return evidence_id


def _sanitize_original_name(original_name: str) -> str:
    """
    Sanitize an original filename for metadata storage only.

    The original name is NEVER used as a filesystem path. This function
    extracts just the basename to strip any path traversal attempts,
    and ensures it is non-empty.

    Args:
        original_name: The user-provided original filename.

    Returns:
        A safe basename string for metadata storage.
    """
    if not original_name:
        return "unnamed"

    # Strip any path components — take only the filename
    basename = os.path.basename(original_name)

    # Handle Windows-style paths that os.path.basename might not fully strip
    basename = basename.replace("\\", "/").split("/")[-1]

    # Strip null bytes and leading/trailing whitespace
    basename = basename.replace("\x00", "").strip()

    if not basename or basename in (".", ".."):
        return "unnamed"

    return basename


def store_evidence(
    source: str | Path | BinaryIO,
    case_dir: str | Path,
    evidence_id: str,
    expected_hash: str,
) -> Path:
    """
    Store an evidence artifact immutably in the case directory.

    The evidence file is copied to:
        <case_dir>/evidence/objects/<evidence_id>

    After copying, the stored file's SHA-256 is verified against the
    expected hash. If verification fails, the stored artifact is removed
    and an error is raised.

    Args:
        source: Path to the source evidence file, or an open binary
                file-like object.
        case_dir: Path to the case directory.
        evidence_id: Unique evidence identifier (trusted, application-generated).
        expected_hash: Expected lowercase hex SHA-256 digest.

    Returns:
        Path to the stored evidence artifact.

    Raises:
        EvidenceStorageError: If storage or hash verification fails.
    """
    evidence_id = _sanitize_evidence_id(evidence_id)
    case_dir = Path(case_dir)

    objects_dir = get_evidence_dir(case_dir)
    artifact_path = get_evidence_path(case_dir, evidence_id)

    # Prevent overwriting existing evidence (immutability)
    if artifact_path.exists():
        raise EvidenceStorageError(
            f"Evidence artifact already exists: {artifact_path}. "
            "Evidence is immutable and cannot be overwritten."
        )

    # Create the objects directory
    try:
        objects_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise EvidenceStorageError(
            f"Failed to create evidence directory: {e}"
        ) from e

    # Verify the destination is actually inside the case directory
    try:
        artifact_path.resolve().relative_to(case_dir.resolve())
    except ValueError:
        raise EvidenceStorageError(
            "Evidence storage path escapes the case directory. "
            "Possible path traversal attempt."
        )

    # Copy the evidence to the artifact path
    try:
        if isinstance(source, (str, Path)):
            source_path = Path(source)
            if not source_path.exists():
                raise EvidenceStorageError(
                    f"Source evidence file not found: {source_path}"
                )

            # Reject symlinks in the source to prevent symlink attacks
            if source_path.is_symlink():
                raise EvidenceStorageError(
                    "Source evidence file is a symbolic link. "
                    "Symlinks are not followed for evidence ingestion."
                )

            shutil.copy2(str(source_path), str(artifact_path))
        else:
            # Stream from file-like object
            with open(artifact_path, "wb") as dest:
                while True:
                    chunk = source.read(65_536)
                    if not chunk:
                        break
                    dest.write(chunk)
    except EvidenceStorageError:
        raise
    except OSError as e:
        _cleanup_failed_storage(artifact_path)
        raise EvidenceStorageError(
            f"Failed to copy evidence to storage: {e}"
        ) from e

    # Verify the stored artifact hash matches the expected hash
    stored_hash = compute_sha256(artifact_path)
    if stored_hash != expected_hash.lower():
        _cleanup_failed_storage(artifact_path)
        raise EvidenceStorageError(
            f"Stored evidence hash mismatch. "
            f"Expected: {expected_hash}, Got: {stored_hash}. "
            f"Evidence artifact has been removed."
        )

    return artifact_path


def remove_evidence(case_dir: str | Path, evidence_id: str) -> bool:
    """
    Remove a stored evidence artifact.

    Used for cleanup when database insertion fails after storage.

    Args:
        case_dir: Path to the case directory.
        evidence_id: Evidence identifier.

    Returns:
        True if the evidence was removed, False if it did not exist.
    """
    artifact_path = get_evidence_path(case_dir, evidence_id)
    if artifact_path.exists():
        try:
            artifact_path.unlink()
        except OSError:
            pass
        return True
    return False


def _cleanup_failed_storage(artifact_path: Path) -> None:
    """Remove a partially-stored evidence artifact after a failure."""
    try:
        if artifact_path.exists():
            artifact_path.unlink()
    except OSError:
        pass  # best-effort cleanup
