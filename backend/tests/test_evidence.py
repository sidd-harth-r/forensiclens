"""
Test suite for the ForensicLens evidence ingestion foundation.

Tests cover:
    - Streaming SHA-256 hashing (empty, known, large)
    - Evidence ingestion and storage layout
    - Byte-for-byte immutability verification
    - Database record creation and provenance tracking
    - Case isolation (per-case database and filesystem)
    - Duplicate detection within the same case
    - Path traversal and security protections (symlinks, sanitization)
    - Rollback and orphan prevention on failures
    - Cryptographic evidence re-verification

All tests use temporary directories and temporary databases.
No real forensic evidence or persistent databases are used.
"""

from __future__ import annotations

import hashlib
import io
import os
import sqlite3
import sys
from pathlib import Path

import pytest

# Ensure imports resolve from backend directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.cases.database import close_case_db, get_case_db_path, initialize_case_db
from app.evidence.hashing import (
    HASH_CHUNK_SIZE,
    compute_sha256,
    compute_sha256_with_size,
    verify_file_hash,
)
from app.evidence.service import (
    DuplicateEvidenceError,
    EvidenceIngestionError,
    EvidenceIntegrityError,
    get_evidence,
    ingest_evidence,
    list_evidence,
    verify_evidence_integrity,
)
from app.evidence.storage import (
    EvidenceStorageError,
    get_evidence_path,
    store_evidence,
)


# ---------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------


@pytest.fixture
def test_env(tmp_path: Path):
    """
    Set up a temporary case environment.

    Yields a tuple of (case_dir, case_id, db_conn).
    """
    case_id = "CASE_TEST_001"
    case_dir = tmp_path / "cases" / case_id
    case_dir.mkdir(parents=True)
    db_path = case_dir / "case.db"

    conn = initialize_case_db(db_path, case_id, "Test Case 001")
    yield case_dir, case_id, conn
    close_case_db(conn)


@pytest.fixture
def sample_file(tmp_path: Path) -> Path:
    """Create a sample synthetic forensic log file."""
    file_path = tmp_path / "auth.log"
    content = (
        "Jan 15 10:20:30 server sshd[1234]: Accepted publickey for analyst from 10.0.0.5 port 54321 ssh2\n"
        "Jan 15 10:21:00 server sudo: analyst : TTY=pts/0 ; COMMAND=/usr/bin/id\n"
        "Jan 15 10:22:00 server sshd[1234]: Received disconnect from 10.0.0.5: 11: Disconnected\n"
    )
    file_path.write_text(content, encoding="utf-8")
    return file_path


# ---------------------------------------------------------------
# 1. Hashing Tests
# ---------------------------------------------------------------


class TestHashing:
    """Tests for streaming SHA-256 calculation."""

    def test_empty_file_hash(self, tmp_path: Path):
        """Empty file produces the standard SHA-256 digest."""
        empty_file = tmp_path / "empty.txt"
        empty_file.write_bytes(b"")

        expected = hashlib.sha256(b"").hexdigest()
        assert expected == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

        digest = compute_sha256(empty_file)
        assert digest == expected

        digest2, size = compute_sha256_with_size(empty_file)
        assert digest2 == expected
        assert size == 0

    def test_known_content_hash(self, tmp_path: Path):
        """Known content produces the exact expected SHA-256 hash."""
        file_path = tmp_path / "test.txt"
        content = b"ForensicLens Test Evidence Payload 2026\n"
        file_path.write_bytes(content)

        expected = hashlib.sha256(content).hexdigest()
        assert compute_sha256(file_path) == expected
        assert verify_file_hash(file_path, expected) is True
        assert verify_file_hash(file_path, "0" * 64) is False

    def test_streaming_chunked_hash_large_file(self, tmp_path: Path):
        """Large file exceeding the chunk size is hashed correctly via streaming."""
        file_path = tmp_path / "large.bin"
        # Create a file with multiple chunks (> 64 KiB)
        pattern = b"0123456789ABCDEF" * 1024  # 16 KiB
        num_blocks = 8  # 128 KiB > 64 KiB chunk size
        with open(file_path, "wb") as f:
            for _ in range(num_blocks):
                f.write(pattern)

        expected_size = len(pattern) * num_blocks
        expected_hash = hashlib.sha256(pattern * num_blocks).hexdigest()

        digest, size = compute_sha256_with_size(file_path)
        assert size == expected_size
        assert digest == expected_hash

    def test_stream_input_hashing(self):
        """BinaryIO streams can be hashed directly."""
        data = b"Streamed evidence data buffer"
        stream = io.BytesIO(data)
        expected = hashlib.sha256(data).hexdigest()

        digest = compute_sha256(stream)
        assert digest == expected


# ---------------------------------------------------------------
# 2. Ingestion and Storage Tests
# ---------------------------------------------------------------


class TestIngestion:
    """Tests for evidence ingestion, storage layout, and immutability."""

    def test_evidence_stored_in_correct_directory(self, test_env, sample_file):
        """Evidence is stored under <case_dir>/evidence/objects/<evidence_id>."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

        expected_path = case_dir / "evidence" / "objects" / record.evidence_id
        assert Path(record.storage_path) == expected_path
        assert expected_path.exists()
        assert expected_path.is_file()

    def test_stored_evidence_hash_matches(self, test_env, sample_file):
        """The SHA-256 of the stored artifact matches the recorded hash."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

        stored_hash = compute_sha256(record.storage_path)
        assert stored_hash == record.object_hash
        assert record.hash_verified_at is not None

    def test_database_record_created_correctly(self, test_env, sample_file):
        """The database record contains all required fields and valid statuses."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(
            conn,
            case_dir,
            case_id,
            sample_file,
            "auth.log",
            format_name="OPENSSH",
        )

        row = conn.execute(
            """
            SELECT
                evidence_id, case_id, object_hash, object_size_bytes,
                original_name, media_type, format, parser_status,
                total_lines, parsed_lines, created_at
            FROM evidence_files
            WHERE evidence_id = ?
            """,
            (record.evidence_id,),
        ).fetchone()

        assert row is not None
        assert row["evidence_id"] == record.evidence_id
        assert row["case_id"] == case_id
        assert row["object_hash"] == record.object_hash
        assert row["object_size_bytes"] == sample_file.stat().st_size
        assert row["original_name"] == "auth.log"
        assert row["format"] == "OPENSSH"
        assert row["parser_status"] == "PENDING"
        assert row["total_lines"] == 3
        assert row["parsed_lines"] == 0

    def test_original_filename_preserved_as_metadata(self, test_env, sample_file):
        """Original filename is preserved in DB metadata only."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "original_system_auth.log")

        assert record.original_name == "original_system_auth.log"
        # Storage filename is the evidence_id, not the original filename
        assert Path(record.storage_path).name == record.evidence_id

    def test_original_bytes_unmodified(self, test_env, sample_file):
        """Original bytes are preserved exactly without line-ending conversion or alteration."""
        case_dir, case_id, conn = test_env
        original_bytes = sample_file.read_bytes()

        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")
        stored_bytes = Path(record.storage_path).read_bytes()

        assert stored_bytes == original_bytes


# ---------------------------------------------------------------
# 3. Case Isolation Tests
# ---------------------------------------------------------------


class TestCaseIsolation:
    """Tests confirming strict separation across cases."""

    def test_evidence_isolated_per_case(self, tmp_path: Path, sample_file):
        """Evidence from case A does not appear in case B's database or directory."""
        cases_root = tmp_path / "cases"

        # Case A
        case_a_id = "CASE_ISOLATION_A"
        case_a_dir = cases_root / case_a_id
        conn_a = initialize_case_db(case_a_dir / "case.db", case_a_id, "Case A")

        # Case B
        case_b_id = "CASE_ISOLATION_B"
        case_b_dir = cases_root / case_b_id
        conn_b = initialize_case_db(case_b_dir / "case.db", case_b_id, "Case B")

        try:
            record_a = ingest_evidence(conn_a, case_a_dir, case_a_id, sample_file, "auth.log")

            # Case B DB must not have record A
            rec_in_b = get_evidence(conn_b, case_b_dir, record_a.evidence_id)
            assert rec_in_b is None

            # Case B directory must not have Case A's file
            assert not (case_b_dir / "evidence" / "objects" / record_a.evidence_id).exists()
        finally:
            close_case_db(conn_a)
            close_case_db(conn_b)

    def test_same_file_can_exist_in_different_cases(self, tmp_path: Path, sample_file):
        """The identical evidence file can be independently ingested into two separate cases."""
        cases_root = tmp_path / "cases"

        case_1_dir = cases_root / "CASE_001"
        conn_1 = initialize_case_db(case_1_dir / "case.db", "CASE_001", "Case 1")

        case_2_dir = cases_root / "CASE_002"
        conn_2 = initialize_case_db(case_2_dir / "case.db", "CASE_002", "Case 2")

        try:
            rec_1 = ingest_evidence(conn_1, case_1_dir, "CASE_001", sample_file, "auth.log")
            rec_2 = ingest_evidence(conn_2, case_2_dir, "CASE_002", sample_file, "auth.log")

            # Both ingestions succeed with the same hash but separate IDs
            assert rec_1.object_hash == rec_2.object_hash
            assert rec_1.evidence_id != rec_2.evidence_id
            assert Path(rec_1.storage_path).exists()
            assert Path(rec_2.storage_path).exists()
        finally:
            close_case_db(conn_1)
            close_case_db(conn_2)


# ---------------------------------------------------------------
# 4. Duplicate Evidence Tests
# ---------------------------------------------------------------


class TestDuplicateHandling:
    """Tests confirming duplicate detection and immutability within a case."""

    def test_duplicate_evidence_raises_error(self, test_env, sample_file):
        """Ingesting the same evidence file into the same case raises DuplicateEvidenceError."""
        case_dir, case_id, conn = test_env

        rec1 = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")
        assert rec1 is not None

        with pytest.raises(DuplicateEvidenceError) as exc_info:
            ingest_evidence(conn, case_dir, case_id, sample_file, "copy_of_auth.log")

        assert exc_info.value.case_id == case_id
        assert exc_info.value.object_hash == rec1.object_hash
        assert exc_info.value.existing_evidence_id == rec1.evidence_id

    def test_existing_artifact_cannot_be_overwritten(self, test_env, sample_file):
        """Direct call to store_evidence with an existing evidence_id raises an error."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

        # Attempt to store something over the same evidence_id
        with pytest.raises(EvidenceStorageError) as exc_info:
            store_evidence(sample_file, case_dir, record.evidence_id, record.object_hash)

        assert "already exists" in str(exc_info.value)


# ---------------------------------------------------------------
# 5. Security & Robustness Tests
# ---------------------------------------------------------------


class TestSecurity:
    """Tests for path traversal, symlinks, and atomic rollback."""

    def test_path_traversal_filename_sanitized(self, test_env, tmp_path):
        """Malicious original filenames with path traversal do not escape the case directory."""
        case_dir, case_id, conn = test_env

        traversal_names = [
            "../../etc/passwd",
            "..\\..\\windows\\system32\\cmd.exe",
            "../../../secret.log",
            "dir/subdir/../../nested.log",
        ]

        for i, bad_name in enumerate(traversal_names):
            test_file = tmp_path / f"source_{i}.log"
            test_file.write_text(f"log data for test {i}\n", encoding="utf-8")

            record = ingest_evidence(conn, case_dir, case_id, test_file, bad_name)
            # The original_name metadata is stripped to basename
            assert "/" not in record.original_name
            assert "\\" not in record.original_name
            assert ".." not in record.original_name

            # The actual file on disk is strictly inside case_dir/evidence/objects
            artifact = Path(record.storage_path)
            assert artifact.is_file()
            assert artifact.resolve().is_relative_to(case_dir.resolve())

    def test_unsafe_evidence_id_rejected(self, test_env, sample_file):
        """Unsafe evidence IDs with directory traversal sequences are rejected."""
        case_dir, case_id, conn = test_env

        with pytest.raises(EvidenceStorageError):
            store_evidence(sample_file, case_dir, "../escaped_id", "dummy")

        with pytest.raises(EvidenceStorageError):
            store_evidence(sample_file, case_dir, "nested/id", "dummy")

    def test_symlink_input_rejected(self, test_env, tmp_path, sample_file):
        """Symbolic links are rejected to avoid reading unexpected host files."""
        case_dir, case_id, conn = test_env
        symlink_file = tmp_path / "symlink_auth.log"

        try:
            symlink_file.symlink_to(sample_file)
        except (OSError, NotImplementedError):
            pytest.skip("Symlink creation not permitted or supported on this system")

        with pytest.raises(EvidenceIngestionError) as exc_info:
            ingest_evidence(conn, case_dir, case_id, symlink_file, "symlink.log")

        assert "Symbolic links are not accepted" in str(exc_info.value)

    def test_failed_db_insert_cleans_up_artifact(self, test_env, sample_file):
        """If database insertion fails, the stored artifact is cleanly rolled back."""
        case_dir, case_id, conn = test_env

        # Create a trigger to simulate a database failure during INSERT
        conn.execute(
            "CREATE TRIGGER test_fail_insert BEFORE INSERT ON evidence_files "
            "BEGIN SELECT RAISE(ABORT, 'Simulated DB Disk Failure'); END;"
        )

        try:
            with pytest.raises(EvidenceIngestionError) as exc_info:
                ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

            assert "Database insertion failed, cleaned up artifact" in str(exc_info.value)

            # Confirm no orphan file exists in the objects directory
            objects_dir = case_dir / "evidence" / "objects"
            if objects_dir.exists():
                assert len(list(objects_dir.iterdir())) == 0
        finally:
            conn.execute("DROP TRIGGER IF EXISTS test_fail_insert")

    def test_file_size_limit_enforced(self, test_env, sample_file):
        """Uploading a file exceeding max_bytes limit is rejected before storage."""
        case_dir, case_id, conn = test_env
        file_size = sample_file.stat().st_size

        with pytest.raises(EvidenceIngestionError) as exc_info:
            ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log", max_bytes=file_size - 1)

        assert "exceeds configured limit" in str(exc_info.value)


# ---------------------------------------------------------------
# 6. Cryptographic Verification & Retrieval Tests
# ---------------------------------------------------------------


class TestEvidenceVerification:
    """Tests for on-disk evidence integrity re-verification."""

    def test_verify_evidence_integrity_success(self, test_env, sample_file):
        """verify_evidence_integrity confirms matching hash and updates verification timestamp."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

        success = verify_evidence_integrity(conn, case_dir, record.evidence_id)
        assert success is True

    def test_verify_evidence_tampering_detected(self, test_env, sample_file):
        """Modifying the on-disk evidence causes verify_evidence_integrity to raise EvidenceIntegrityError."""
        case_dir, case_id, conn = test_env
        record = ingest_evidence(conn, case_dir, case_id, sample_file, "auth.log")

        # Simulate tampering on the filesystem
        with open(record.storage_path, "ab") as f:
            f.write(b"TAMPERED_CONTENT")

        with pytest.raises(EvidenceIntegrityError) as exc_info:
            verify_evidence_integrity(conn, case_dir, record.evidence_id)

        assert "Integrity check failed" in str(exc_info.value)

    def test_list_and_get_evidence(self, test_env, tmp_path):
        """list_evidence and get_evidence return accurate records."""
        case_dir, case_id, conn = test_env

        f1 = tmp_path / "log1.txt"
        f1.write_text("log 1", encoding="utf-8")
        f2 = tmp_path / "log2.txt"
        f2.write_text("log 2", encoding="utf-8")

        r1 = ingest_evidence(conn, case_dir, case_id, f1, "log1.txt")
        r2 = ingest_evidence(conn, case_dir, case_id, f2, "log2.txt")

        items = list_evidence(conn, case_dir, case_id)
        assert len(items) == 2
        assert {item.evidence_id for item in items} == {r1.evidence_id, r2.evidence_id}

        fetched = get_evidence(conn, case_dir, r1.evidence_id)
        assert fetched is not None
        assert fetched.evidence_id == r1.evidence_id
        assert fetched.object_hash == r1.object_hash
