"""
Streaming SHA-256 hashing for forensic evidence files.

Computes SHA-256 digests using chunked reads so that arbitrarily
large evidence files are never loaded entirely into memory.

All hashes are returned as lowercase hexadecimal strings, matching
the convention in docs/DATABASE.md section 2.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import BinaryIO

# 64 KiB chunk size balances memory use and I/O throughput
HASH_CHUNK_SIZE = 65_536


def compute_sha256(source: str | Path | BinaryIO) -> str:
    """
    Compute the SHA-256 hex digest of a file or file-like object.

    Args:
        source: A filesystem path (str or Path) or an open binary
                file-like object positioned at the desired start.

    Returns:
        Lowercase hexadecimal SHA-256 digest string (64 characters).
    """
    h = hashlib.sha256()

    if isinstance(source, (str, Path)):
        with open(source, "rb") as f:
            _hash_stream(h, f)
    else:
        _hash_stream(h, source)

    return h.hexdigest()


def compute_sha256_with_size(source: str | Path | BinaryIO) -> tuple[str, int]:
    """
    Compute SHA-256 and byte size in a single pass.

    Args:
        source: A filesystem path or an open binary file-like object.

    Returns:
        Tuple of (lowercase hex digest, total byte count).
    """
    h = hashlib.sha256()
    total_bytes = 0

    if isinstance(source, (str, Path)):
        with open(source, "rb") as f:
            total_bytes = _hash_stream(h, f)
    else:
        total_bytes = _hash_stream(h, source)

    return h.hexdigest(), total_bytes


def verify_file_hash(file_path: str | Path, expected_hash: str) -> bool:
    """
    Verify that a file's SHA-256 matches an expected digest.

    Args:
        file_path: Path to the file to verify.
        expected_hash: Expected lowercase hex SHA-256 digest.

    Returns:
        True if the computed hash matches the expected hash.
    """
    actual = compute_sha256(file_path)
    return actual == expected_hash.lower()


def _hash_stream(h: "hashlib._Hash", stream: BinaryIO) -> int:
    """
    Feed a binary stream into a hash object in chunks.

    Returns:
        Total number of bytes read.
    """
    total = 0
    while True:
        chunk = stream.read(HASH_CHUNK_SIZE)
        if not chunk:
            break
        h.update(chunk)
        total += len(chunk)
    return total

