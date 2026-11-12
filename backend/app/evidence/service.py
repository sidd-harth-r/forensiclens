"""
Evidence ingestion service.

Orchestrates the validation, hashing, immutable artifact storage,
and database record creation for forensic evidence files.

Enforces:
    - Streaming SHA-256 verification (before and after storage)
    - Per-case duplicate detection (by object_hash)
    - Atomic ingestion (rollback storage if database insertion fails)
    - Case-scoped data isolation
    - Untrusted input sanitization (path traversal protection)
    - Full provenance tracking without logging evidence contents
"""

from __future__ import annotations

import logging
import mimetypes
import os
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Optional

from app.evidence.hashing import compute_sha256_with_size, compute_sha256
from app.evidence.storage import (
    EvidenceStorageError,
    _sanitize_original_name,
    get_evidence_path,
    remove_evidence,
    store_evidence,
)

logger = logging.getLogger(__name__)


class EvidenceIngestionError(Exception):
    """Raised when evidence ingestion fails."""


class DuplicateEvidenceError(EvidenceIngestionError):
    """Raised when identical evidence (same SHA-256) already exists in the case."""

    def __init__(self, case_id: str, object_hash: str, existing_evidence_id: str):
        self.case_id = case_id
        self.object_hash = object_hash
        self.existing_evidence_id = existing_evidence_id
        super().__init__(
            f"Duplicate evidence in case {case_id}: object with SHA-256 "
            f"{object_hash} already exists as evidence_id {existing_evidence_id}."
        )


class EvidenceNotFoundError(EvidenceIngestionError):
    """Raised when requested evidence record is not found."""


class EvidenceIntegrityError(EvidenceIngestionError):
    """Raised when an evidence artifact fails cryptographic integrity verification."""


@dataclass(frozen=True)
class EvidenceRecord:
    """Immutable representation of an ingested evidence file record."""

    evidence_id: str
    case_id: str
    object_hash: str
    object_size_bytes: int
    original_name: str
    media_type: Optional[str]
    format: str
    parser_version: Optional[str]
    parser_status: str
    total_lines: Optional[int]
    parsed_lines: Optional[int]
    hash_verified_at: Optional[str]
    created_at: str
    storage_path: str


def generate_evidence_id() -> str:
    """Generate a unique, trusted evidence ID using UUIDv4 hex."""
    return f"EV_{uuid.uuid4().hex[:16].upper()}"


def detect_media_type_and_format(
    filename: str,
    explicit_format: Optional[str] = None,
    explicit_media_type: Optional[str] = None,
) -> tuple[Optional[str], str]:
    """
    Detect media type and parser format from filename and optional overrides.

    Args:
        filename: Original display name of the evidence file.
        explicit_format: Explicit format override if specified by caller.
        explicit_media_type: Explicit media type override if specified.

    Returns:
        Tuple of (media_type, format).
    """
    if explicit_format and explicit_media_type:
        return explicit_media_type, explicit_format.upper()

    ext = Path(filename).suffix.lower()
    guessed_type, _ = mimetypes.guess_type(filename)

    if explicit_format:
        fmt = explicit_format.upper()
    elif ext in (".log", ".txt"):
        fmt = "TXT"
        guessed_type = guessed_type or "text/plain"
    elif ext == ".json":
        fmt = "JSON"
        guessed_type = guessed_type or "application/json"
    elif ext == ".csv":
        fmt = "CSV"
        guessed_type = guessed_type or "text/csv"
    else:
        fmt = "TXT" if guessed_type and guessed_type.startswith("text/") else "UNKNOWN"

    media_type = explicit_media_type or guessed_type or "application/octet-stream"
    return media_type, fmt


def _count_lines_safe(file_path: Path) -> Optional[int]:
    """
    Count newline characters in a file without loading it all into memory.

    Returns line count if readable as text/utf-8/ascii, or None if binary.
    """
    try:
        lines = 0
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65_536), b""):
                lines += chunk.count(b"\n")
        return lines
    except Exception:
        return None


def _discard_new_artifact(conn: sqlite3.Connection, case_dir: Path, evidence_id: str) -> None:
    """
    Remove an artifact stored by the current ingestion call after a failure.

    Only called for an `evidence_id` whose file this call created exclusively.
    Guard: never remove the artifact of a committed evidence record. If that cannot
    be confirmed (database error), the file is kept and the condition is logged —
    an orphaned file is recoverable, a deleted evidence artifact is not.
    """
    try:
        committed = conn.execute(
            "SELECT 1 FROM evidence_files WHERE evidence_id = ?", (evidence_id,)
        ).fetchone()
    except sqlite3.Error:
        logger.exception(
            "Could not confirm evidence %s is unreferenced; keeping stored artifact", evidence_id
        )
        return
    if committed:
        logger.error(
            "Not removing artifact for evidence %s: a committed record references it", evidence_id
        )
        return
    if not remove_evidence(case_dir, evidence_id) and get_evidence_path(case_dir, evidence_id).exists():
        logger.error("Orphaned evidence artifact could not be removed: evidence %s", evidence_id)


def ingest_evidence(
    conn: sqlite3.Connection,
    case_dir: str | Path,
    case_id: str,
    source: str | Path | BinaryIO,
    original_name: str,
    *,
    evidence_id: Optional[str] = None,
    format_name: Optional[str] = None,
    media_type: Optional[str] = None,
    max_bytes: Optional[int] = None,
) -> EvidenceRecord:
    """
    Ingest a forensic evidence artifact into a case.

    Full ingestion pipeline:
    1. Validate input and ensure case directory / connection validity.
    2. Stream-hash the input file to compute initial SHA-256 and byte size.
    3. Enforce maximum byte size limit if configured.
    4. Check for duplicates within the case by object_hash.
    5. Allocate a unique, trusted evidence_id.
    6. Copy the artifact immutably to <case_dir>/evidence/objects/<evidence_id>.
    7. Re-hash the stored artifact to verify byte-for-byte integrity.
    8. Insert the evidence_files database record.
    9. If database insertion fails, roll back by removing the stored file.

    Args:
        conn: Active sqlite3 connection to the case database.
        case_dir: Root directory of the case (where case.db lives).
        case_id: Unique case identifier.
        source: File path or open binary stream containing raw evidence.
        original_name: User-provided filename (stored as sanitized metadata).
        evidence_id: Optional pre-assigned evidence ID (generated if None).
        format_name: Optional format override (e.g. 'OPENSSH', 'TXT').
        media_type: Optional MIME type override.
        max_bytes: Optional upload size limit in bytes.

    Returns:
        EvidenceRecord representing the newly ingested evidence.

    Raises:
        DuplicateEvidenceError: If identical evidence already exists in this case.
        EvidenceIngestionError: If validation, hashing, storage, or DB fails.
    """
    case_dir = Path(case_dir)

    # 1. Sanitize the display name (metadata only, never used as filesystem path)
    safe_original_name = _sanitize_original_name(original_name)

    # 2. Check source validity if given as path
    if isinstance(source, (str, Path)):
        source_path = Path(source)
        if not source_path.exists():
            raise EvidenceIngestionError(f"Source file not found: {source_path}")
        if source_path.is_symlink():
            raise EvidenceIngestionError("Symbolic links are not accepted as evidence")

    # 3. Compute initial SHA-256 hash and size
    try:
        object_hash, object_size = compute_sha256_with_size(source)
    except Exception as e:
        raise EvidenceIngestionError(f"Failed to hash source evidence: {e}") from e

    # 4. Enforce upload size limit if specified
    if max_bytes is not None and object_size > max_bytes:
        raise EvidenceIngestionError(
            f"Evidence size ({object_size} bytes) exceeds configured limit ({max_bytes} bytes)"
        )

    # 5. Fast-path duplicate check (case-scoped deduplication). This avoids storing
    #    an obvious duplicate, but it is NOT authoritative: concurrent uploads of the
    #    same content can all pass it. The authoritative re-check runs in step 9
    #    under the database write reservation.
    row = conn.execute(
        "SELECT evidence_id FROM evidence_files WHERE case_id = ? AND object_hash = ?",
        (case_id, object_hash),
    ).fetchone()
    if row:
        raise DuplicateEvidenceError(
            case_id=case_id,
            object_hash=object_hash,
            existing_evidence_id=row[0],
        )

    # 6. Assign unique evidence_id. A caller-supplied ID that already has a record
    #    is rejected before anything is written, so this call can never store a new
    #    file under (or later remove) the storage path of an existing record.
    eid = evidence_id or generate_evidence_id()
    if evidence_id is not None and conn.execute(
        "SELECT 1 FROM evidence_files WHERE evidence_id = ?", (eid,)
    ).fetchone():
        raise EvidenceIngestionError(f"Evidence ID already exists: {eid}")

    # Reset stream pointer if source was a file-like object
    if hasattr(source, "seek"):
        try:
            source.seek(0)
        except Exception:
            pass

    # 7. Store the immutable artifact and verify post-storage SHA-256.
    #    store_evidence creates the file exclusively, so on success the artifact at
    #    `eid` was created by this call and is owned by it until the record commits.
    #    On failure it never removes a file it did not create.
    try:
        artifact_path = store_evidence(
            source=source,
            case_dir=case_dir,
            evidence_id=eid,
            expected_hash=object_hash,
        )
    except EvidenceStorageError as e:
        raise EvidenceIngestionError(f"Storage failed: {e}") from e

    # From here until commit, every failure path must discard the new artifact.
    owns_transaction = False
    try:
        # 8. Detect format, media type, and line count
        detected_media_type, detected_format = detect_media_type_and_format(
            safe_original_name,
            explicit_format=format_name,
            explicit_media_type=media_type,
        )
        total_lines = _count_lines_safe(artifact_path)

        # 9. Take the write reservation, re-check for a duplicate and insert, so the
        #    check and the insert are atomic with respect to every other writer
        #    (including other processes). If the caller already holds a transaction,
        #    the caller owns locking (pre-existing behaviour) and the re-check runs
        #    inside the caller's transaction.
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
            owns_transaction = True

        row = conn.execute(
            "SELECT evidence_id FROM evidence_files WHERE case_id = ? AND object_hash = ?",
            (case_id, object_hash),
        ).fetchone()
        if row:
            # A concurrent upload of the same content won the race.
            raise DuplicateEvidenceError(
                case_id=case_id,
                object_hash=object_hash,
                existing_evidence_id=row[0],
            )
    except BaseException:
        if owns_transaction and conn.in_transaction:
            conn.rollback()
        _discard_new_artifact(conn, case_dir, eid)
        raise

    # Insert database record (atomic with removal of the new file on error)
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        conn.execute(
            """
            INSERT INTO evidence_files (
                evidence_id,
                case_id,
                object_hash,
                object_size_bytes,
                original_name,
                media_type,
                format,
                parser_version,
                parser_status,
                total_lines,
                parsed_lines,
                hash_verified_at,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, 0, ?, ?)
            """,
            (
                eid,
                case_id,
                object_hash,
                object_size,
                safe_original_name,
                detected_media_type,
                detected_format,
                total_lines,
                now_utc,
                now_utc,
            ),
        )
        conn.commit()
    except BaseException as e:
        # Atomic cleanup: end the failed transaction, then remove the artifact this
        # call stored so no orphan file remains.
        if owns_transaction and conn.in_transaction:
            conn.rollback()
        _discard_new_artifact(conn, case_dir, eid)
        if not isinstance(e, Exception):
            raise
        raise EvidenceIngestionError(
            f"Database insertion failed, cleaned up artifact: {e}"
        ) from e

    return EvidenceRecord(
        evidence_id=eid,
        case_id=case_id,
        object_hash=object_hash,
        object_size_bytes=object_size,
        original_name=safe_original_name,
        media_type=detected_media_type,
        format=detected_format,
        parser_version=None,
        parser_status="PENDING",
        total_lines=total_lines,
        parsed_lines=0,
        hash_verified_at=now_utc,
        created_at=now_utc,
        storage_path=str(artifact_path),
    )


def get_evidence(
    conn: sqlite3.Connection,
    case_dir: str | Path,
    evidence_id: str,
) -> Optional[EvidenceRecord]:
    """
    Retrieve an evidence record by ID.

    Returns None if not found.
    """
    row = conn.execute(
        """
        SELECT
            evidence_id,
            case_id,
            object_hash,
            object_size_bytes,
            original_name,
            media_type,
            format,
            parser_version,
            parser_status,
            total_lines,
            parsed_lines,
            hash_verified_at,
            created_at
        FROM evidence_files
        WHERE evidence_id = ?
        """,
        (evidence_id,),
    ).fetchone()

    if not row:
        return None

    artifact_path = get_evidence_path(case_dir, evidence_id)

    return EvidenceRecord(
        evidence_id=row[0],
        case_id=row[1],
        object_hash=row[2],
        object_size_bytes=row[3],
        original_name=row[4],
        media_type=row[5],
        format=row[6],
        parser_version=row[7],
        parser_status=row[8],
        total_lines=row[9],
        parsed_lines=row[10],
        hash_verified_at=row[11],
        created_at=row[12],
        storage_path=str(artifact_path),
    )


def list_evidence(
    conn: sqlite3.Connection,
    case_dir: str | Path,
    case_id: str,
) -> list[EvidenceRecord]:
    """
    List all evidence records for a given case.
    """
    rows = conn.execute(
        """
        SELECT
            evidence_id,
            case_id,
            object_hash,
            object_size_bytes,
            original_name,
            media_type,
            format,
            parser_version,
            parser_status,
            total_lines,
            parsed_lines,
            hash_verified_at,
            created_at
        FROM evidence_files
        WHERE case_id = ?
        ORDER BY created_at ASC
        """,
        (case_id,),
    ).fetchall()

    records = []
    for row in rows:
        eid = row[0]
        artifact_path = get_evidence_path(case_dir, eid)
        records.append(
            EvidenceRecord(
                evidence_id=eid,
                case_id=row[1],
                object_hash=row[2],
                object_size_bytes=row[3],
                original_name=row[4],
                media_type=row[5],
                format=row[6],
                parser_version=row[7],
                parser_status=row[8],
                total_lines=row[9],
                parsed_lines=row[10],
                hash_verified_at=row[11],
                created_at=row[12],
                storage_path=str(artifact_path),
            )
        )
    return records


def verify_evidence_integrity(
    conn: sqlite3.Connection,
    case_dir: str | Path,
    evidence_id: str,
) -> bool:
    """
    Cryptographically verify the on-disk evidence artifact against the database hash.

    If the SHA-256 matches, updates `hash_verified_at` in the database.
    If the file is missing or hash does not match, raises EvidenceIntegrityError.

    Args:
        conn: Active sqlite3 connection.
        case_dir: Root directory of the case.
        evidence_id: Identifier of evidence to verify.

    Returns:
        True if verification succeeded.

    Raises:
        EvidenceNotFoundError: If record is not in database.
        EvidenceIntegrityError: If on-disk file is missing or corrupted.
    """
    row = conn.execute(
        "SELECT object_hash FROM evidence_files WHERE evidence_id = ?",
        (evidence_id,),
    ).fetchone()
    if not row:
        raise EvidenceNotFoundError(f"Evidence record not found: {evidence_id}")

    expected_hash = row[0]
    artifact_path = get_evidence_path(case_dir, evidence_id)

    if not artifact_path.exists():
        raise EvidenceIntegrityError(
            f"Evidence file missing on disk: {artifact_path}"
        )

    current_hash = compute_sha256(artifact_path)
    if current_hash != expected_hash:
        raise EvidenceIntegrityError(
            f"Integrity check failed for {evidence_id}: "
            f"expected {expected_hash}, got {current_hash}."
        )

    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        "UPDATE evidence_files SET hash_verified_at = ? WHERE evidence_id = ?",
        (now_utc, evidence_id),
    )
    conn.commit()
    return True

