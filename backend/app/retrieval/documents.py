"""
Retrieval Document Unit for ForensicLens.

Defines the primary evidence-backed retrieval unit, providing exact mapping:
    Retrieval Result → Raw Record → Evidence File → Original Source Line

Ensures both normalized events and unparsed raw records are first-class,
verifiable citizens in the retrieval pipeline.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class RetrievalDocument:
    """
    Evidence-backed retrieval document representing an individual raw record,
    enriched with normalized event fields if parsed.
    """
    document_id: str
    raw_record_id: str
    case_id: str
    evidence_id: str
    record_no: int
    line_number: Optional[int]
    byte_start: Optional[int]
    byte_end: Optional[int]
    raw_text: str
    original_filename: str
    event_id: Optional[str] = None
    timestamp: Optional[str] = None
    event_type: Optional[str] = None
    severity: Optional[str] = None
    user_value: Optional[str] = None
    src_ip: Optional[str] = None
    process: Optional[str] = None
    message: Optional[str] = None

    def to_embedding_text(self) -> str:
        """
        Construct a semantic representation of this source record for local embedding.

        Incorporates normalized event semantics when available to enhance dense retrieval,
        while strictly anchoring to the original raw text.
        """
        parts = [f"File: {self.original_filename}"]
        if self.line_number is not None:
            parts.append(f"Line: {self.line_number}")
        else:
            parts.append(f"Record: {self.record_no}")

        if self.event_type:
            parts.append(f"Type: {self.event_type}")
        if self.severity:
            parts.append(f"Severity: {self.severity}")
        if self.user_value:
            parts.append(f"User: {self.user_value}")
        if self.src_ip:
            parts.append(f"IP: {self.src_ip}")
        if self.process:
            parts.append(f"Process: {self.process}")
        if self.message and self.message.strip() != self.raw_text.strip():
            parts.append(f"Message: {self.message}")

        parts.append(f"Raw: {self.raw_text}")
        return " | ".join(parts)

    def to_metadata(self) -> dict[str, Any]:
        """
        Generate a ChromaDB-compatible metadata dictionary.
        ChromaDB primitive constraint: values must be str, int, float, or bool.
        """
        return {
            "document_id": self.document_id,
            "raw_record_id": self.raw_record_id,
            "case_id": self.case_id,
            "evidence_id": self.evidence_id,
            "record_no": self.record_no,
            "line_number": self.line_number if self.line_number is not None else -1,
            "byte_start": self.byte_start if self.byte_start is not None else -1,
            "byte_end": self.byte_end if self.byte_end is not None else -1,
            "original_filename": self.original_filename,
            "event_id": self.event_id or "",
            "timestamp": self.timestamp or "",
            "event_type": self.event_type or "",
            "severity": self.severity or "",
            "user_value": self.user_value or "",
            "src_ip": self.src_ip or "",
        }


def make_document_id(case_id: str, raw_record_id: str) -> str:
    """Deterministic document identifier generator."""
    return f"DOC_{case_id}_{raw_record_id}"


def build_retrieval_document_from_row(row: sqlite3.Row) -> RetrievalDocument:
    """Convert a joined SQLite row into a strongly typed RetrievalDocument."""
    case_id = row["case_id"]
    raw_record_id = row["raw_record_id"]
    doc_id = make_document_id(case_id, raw_record_id)

    # Determine best available timestamp
    ts = None
    if "timestamp" in row.keys() and row["timestamp"]:
        ts = row["timestamp"]
    elif "timestamp_utc" in row.keys() and row["timestamp_utc"]:
        ts = row["timestamp_utc"]
    elif "timestamp_original" in row.keys() and row["timestamp_original"]:
        ts = row["timestamp_original"]

    return RetrievalDocument(
        document_id=doc_id,
        raw_record_id=raw_record_id,
        case_id=case_id,
        evidence_id=row["evidence_id"],
        record_no=row["record_no"],
        line_number=row["line_number"],
        byte_start=row["byte_start"],
        byte_end=row["byte_end"],
        raw_text=row["raw_text"],
        original_filename=row["original_filename"] if "original_filename" in row.keys() else "unknown",
        event_id=row["event_id"] if "event_id" in row.keys() else None,
        timestamp=ts,
        event_type=row["event_type"] if "event_type" in row.keys() else None,
        severity=row["severity"] if "severity" in row.keys() else None,
        user_value=row["user_value"] if "user_value" in row.keys() else None,
        src_ip=row["src_ip"] if "src_ip" in row.keys() else None,
        process=row["process"] if "process" in row.keys() else None,
        message=row["message"] if "message" in row.keys() else None,
    )


def fetch_retrieval_documents(
    conn: sqlite3.Connection,
    case_id: str,
    *,
    limit: Optional[int] = None,
    offset: int = 0,
    raw_record_ids: Optional[list[str]] = None,
) -> list[RetrievalDocument]:
    """
    Fetch retrieval documents by joining raw_records, events, and evidence_files.

    Guarantees that unparsed lines (no event) are retrieved alongside parsed events.
    """
    sql = """
        SELECT
            r.raw_record_id,
            r.case_id,
            r.evidence_id,
            r.record_no,
            r.line_number,
            r.byte_start,
            r.byte_end,
            r.raw_text,
            e.event_id,
            COALESCE(e.timestamp_utc, e.timestamp_original) AS timestamp,
            e.timestamp_utc,
            e.timestamp_original,
            e.event_type,
            e.severity,
            e.user_value,
            e.src_ip,
            e.process,
            e.message,
            COALESCE(ef.original_name, 'unknown') AS original_filename
        FROM raw_records r
        LEFT JOIN events e ON r.raw_record_id = e.raw_record_id
        LEFT JOIN evidence_files ef ON r.evidence_id = ef.evidence_id
        WHERE r.case_id = ?
    """
    params: list[Any] = [case_id]

    if raw_record_ids:
        placeholders = ",".join("?" for _ in raw_record_ids)
        sql += f" AND r.raw_record_id IN ({placeholders})"
        params.extend(raw_record_ids)

    sql += " ORDER BY r.evidence_id ASC, r.record_no ASC"

    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])

    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    return [build_retrieval_document_from_row(row) for row in rows]


def count_case_source_records(conn: sqlite3.Connection, case_id: str) -> int:
    """Return total number of raw source records for a case."""
    row = conn.execute(
        "SELECT COUNT(*) FROM raw_records WHERE case_id = ?",
        (case_id,),
    ).fetchone()
    return row[0] if row else 0
