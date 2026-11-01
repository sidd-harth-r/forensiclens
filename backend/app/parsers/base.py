"""
Base parser interface, data structures, and utilities for ForensicLens.

Defines the pluggable parser contract, provenance-tracking data classes,
and safe parsing utilities. All parsers in ForensicLens must implement
the BaseParser interface.

Schema alignment:
    - Raw records map to the `raw_records` table (docs/DATABASE.md section 4.3).
    - Normalized events map to the `events` table (docs/DATABASE.md section 4.4).
    - Format and parser version map to `evidence_files` (section 4.2).
"""

from __future__ import annotations

import io
import ipaddress
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Iterator, Optional


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RawRecord:
    """
    Represents an unnormalized, raw evidence record with exact provenance.

    Corresponds directly to the `raw_records` database table.
    """

    record_no: int
    line_number: int
    byte_start: int
    byte_end: int
    raw_text: str
    parse_status: str  # 'PARSED', 'PARTIAL', 'UNPARSED'
    parse_error: Optional[str] = None


@dataclass(frozen=True)
class ParsedEvent:
    """
    Canonical normalized forensic event extracted from a raw record.

    Corresponds directly to the `events` database table.
    """

    timestamp_original: Optional[str] = None
    timestamp_utc: Optional[str] = None
    tz_assumed: Optional[str] = None
    timestamp_confidence: Optional[str] = None
    source: Optional[str] = None
    host: Optional[str] = None
    event_type: Optional[str] = None
    severity: Optional[str] = None
    user_value: Optional[str] = None
    src_ip: Optional[str] = None
    src_ip_scope: Optional[str] = None  # 'PUBLIC', 'PRIVATE', 'LOOPBACK', 'LINK_LOCAL', 'UNKNOWN'
    src_port: Optional[int] = None
    process: Optional[str] = None
    pid: Optional[int] = None
    command_value: Optional[str] = None
    resource: Optional[str] = None
    message: Optional[str] = None
    parse_status: str = "PARSED"  # 'PARSED', 'PARTIAL', 'UNPARSED'
    line_number: Optional[int] = None
    byte_start: Optional[int] = None
    byte_end: Optional[int] = None


@dataclass(frozen=True)
class ParsedRecord:
    """
    Pairing of a RawRecord (unparsed provenance) and its optional derived ParsedEvent.
    """

    raw_record: RawRecord
    event: Optional[ParsedEvent]
    parser_name: str
    parser_version: str
    evidence_id: str


@dataclass(frozen=True)
class ParseResult:
    """
    Complete output of a parser run across an evidence artifact.
    """

    evidence_id: str
    parser_name: str
    parser_version: str
    supported_format: str
    records: list[ParsedRecord]
    total_lines: int
    parsed_lines: int
    partial_lines: int
    unparsed_lines: int


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------


def classify_ip_scope(ip_str: Optional[str]) -> Optional[str]:
    """
    Classify an IP address string into a standard scope.

    Returns one of: 'PUBLIC', 'PRIVATE', 'LOOPBACK', 'LINK_LOCAL', 'UNKNOWN'
    or None if ip_str is empty. Matches SQLite check constraint on events.src_ip_scope.
    """
    if not ip_str:
        return None
    try:
        ip = ipaddress.ip_address(ip_str.strip())
        if ip.is_loopback:
            return "LOOPBACK"
        if ip.is_private:
            return "PRIVATE"
        if ip.is_link_local:
            return "LINK_LOCAL"
        if ip.is_global:
            return "PUBLIC"
        return "UNKNOWN"
    except ValueError:
        return "UNKNOWN"


def normalize_timestamp(
    ts_str: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Safely inspect and normalize a timestamp string.

    Behavior (per docs/DATABASE.md and architecture guidelines):
    1. If the timestamp is ISO-8601 with an explicit timezone offset (e.g. '2026-01-15T10:20:30Z'
       or '2026-01-15T10:20:30+05:30'), it is converted to UTC RFC3339 format with confidence 'EXACT'.
    2. If the timestamp lacks a year and/or timezone (such as traditional BSD syslog 'Jan 15 10:20:30'),
       no year or timezone is invented. `timestamp_utc` is set to None, and confidence is set to None.
    3. If the timestamp is ISO-8601 without a timezone offset, `timestamp_utc` is set to None because
       UTC conversion cannot be reliably established without assuming a timezone.

    Returns:
        (timestamp_original, timestamp_utc, timestamp_confidence)
    """
    if not ts_str:
        return None, None, None

    cleaned = ts_str.strip()

    # Try ISO-8601 parsing with timezone
    try:
        iso_compat = cleaned.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso_compat)
        if dt.tzinfo is not None:
            utc_dt = dt.astimezone(timezone.utc)
            return cleaned, utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "EXACT"
        # Has date/time but no timezone info -> do not invent timezone
        return cleaned, None, None
    except (ValueError, TypeError):
        pass

    # Traditional syslog format (e.g. 'Jan 15 10:20:30') has no year and no timezone
    return cleaned, None, None


def iter_lines_with_offsets(
    source: str | bytes | Path | BinaryIO,
    encoding: str = "utf-8",
) -> Iterator[tuple[int, int, int, int, str]]:
    """
    Stream lines from a source while calculating exact byte offsets and line numbers.

    Yields:
        (record_no, line_number, byte_start, byte_end, line_text)
        - record_no: 1-based sequential record index
        - line_number: 1-based source line number
        - byte_start: 0-based byte offset where this line starts
        - byte_end: exclusive 0-based byte offset where this line ends (including line terminators)
        - line_text: the line string with trailing \r and \n removed, preserving all internal content
    """
    if isinstance(source, (str, Path)) and (isinstance(source, Path) or Path(source).exists()):
        with open(source, "rb") as f:
            yield from _iter_stream(f, encoding)
    elif isinstance(source, str):
        # In-memory string: encode to bytes to track exact byte offsets
        raw_bytes = source.encode(encoding)
        yield from _iter_stream(io.BytesIO(raw_bytes), encoding)
    elif isinstance(source, bytes):
        yield from _iter_stream(io.BytesIO(source), encoding)
    else:
        # BinaryIO stream
        yield from _iter_stream(source, encoding)


def _iter_stream(
    stream: BinaryIO,
    encoding: str,
) -> Iterator[tuple[int, int, int, int, str]]:
    """Internal helper to stream from an open binary file-like object."""
    offset = 0
    line_number = 1
    record_no = 1

    while True:
        line_bytes = stream.readline()
        if not line_bytes:
            break

        byte_start = offset
        byte_end = offset + len(line_bytes)
        offset = byte_end

        # Decode safely with replacement to ensure invalid encodings never crash the parser
        line_text = line_bytes.decode(encoding, errors="replace").rstrip("\r\n")

        yield (record_no, line_number, byte_start, byte_end, line_text)

        line_number += 1
        record_no += 1


# ---------------------------------------------------------------------------
# Abstract Parser Interface
# ---------------------------------------------------------------------------


class BaseParser(ABC):
    """
    Abstract interface for all ForensicLens log and artifact parsers.

    Every concrete parser must define its metadata (name, version, supported format)
    and provide the `parse` operation.
    """

    @property
    @abstractmethod
    def parser_name(self) -> str:
        """Unique identifier for this parser (e.g. 'openssh')."""
        ...

    @property
    @abstractmethod
    def parser_version(self) -> str:
        """SemVer version string for this parser implementation (e.g. '1.0.0')."""
        ...

    @property
    @abstractmethod
    def supported_format(self) -> str:
        """Canonical format family handled by this parser (e.g. 'OPENSSH')."""
        ...

    @abstractmethod
    def parse(
        self,
        source: str | bytes | Path | BinaryIO,
        evidence_id: str,
        *,
        encoding: str = "utf-8",
    ) -> ParseResult:
        """
        Parse raw evidence into structured RawRecords and ParsedEvents.

        Args:
            source: Raw file path, bytes, string, or open stream.
            evidence_id: Provenance identifier linking records to the source evidence file.
            encoding: Text encoding to use when decoding bytes (default: utf-8).

        Returns:
            ParseResult containing all parsed records and summary statistics.
        """
        ...

