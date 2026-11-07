"""
Lexical Retrieval Service using SQLite FTS5.

Provides secure, parameterized full-text search over evidence-backed
records with support for structured filtering and safe query construction.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from typing import Any, Optional

from app.retrieval.documents import RetrievalDocument, build_retrieval_document_from_row
from app.retrieval.schemas import RetrievalFilters


@dataclass(frozen=True)
class LexicalSearchResult:
    """A ranked result produced by lexical search."""
    document_id: str
    rank: int  # 1-based rank
    score: float  # FTS score or BM25 rank score
    document: RetrievalDocument


def sanitize_fts5_query(query: str) -> str:
    """
    Safely construct an FTS5 MATCH query expression.

    Prevents SQLite FTS5 syntax errors caused by bare colons, brackets,
    unmatched quotes, or special operators, while preserving exact terms,
    IP addresses, and phrase expressions.
    """
    if not query or not query.strip():
        return ""

    text = query.strip()

    # Extract user-provided quoted phrases first
    phrase_pattern = re.compile(r'"([^"]+)"')
    phrases = phrase_pattern.findall(text)
    remaining = phrase_pattern.sub(" ", text)

    tokens: list[str] = []

    # Add preserved phrases
    for p in phrases:
        cleaned_phrase = p.strip().replace('"', "")
        if cleaned_phrase:
            tokens.append(f'"{cleaned_phrase}"')

    # Tokenize remaining unquoted text
    raw_words = remaining.split()
    for word in raw_words:
        clean = word.strip().strip("'\",;()[]{}<>^~*")
        if not clean:
            continue

        # If token contains dots (IP address) or underscores/dashes/colons
        # wrap in quotes so FTS5 treats it as a phrase/token without operator ambiguity
        if any(c in clean for c in ".:-_@/"):
            escaped = clean.replace('"', '""')
            tokens.append(f'"{escaped}"')
        else:
            # Add prefix match for flexible substring/stem discovery
            tokens.append(f'"{clean}"*')

    return " ".join(tokens)


class LexicalSearchService:
    """
    Dedicated lexical retrieval service backed by SQLite FTS5.
    """

    def search(
        self,
        conn: sqlite3.Connection,
        case_id: str,
        query: str,
        *,
        limit: int = 50,
        filters: Optional[RetrievalFilters] = None,
    ) -> list[LexicalSearchResult]:
        """
        Execute bounded lexical search over case evidence records.

        Queries both raw_records_fts and events_fts, joining with normalized
        events and evidence provenance, applying structured filters and returning
        bounded ranked results.
        """
        sanitized = sanitize_fts5_query(query)
        conn.row_factory = sqlite3.Row

        # If query sanitization produced no search tokens, check if structured filters exist
        # If no query and no filters, return empty
        if not sanitized and not (filters and any(filters.model_dump().values())):
            return []

        # Base query joining raw_records, events, and evidence_files
        sql_parts: list[str] = [
            """
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
        ]
        params: list[Any] = [case_id]

        # FTS clause: match either raw_records_fts or events_fts
        if sanitized:
            sql_parts.append(
                """
                AND (
                    r.rowid IN (SELECT rowid FROM raw_records_fts WHERE raw_records_fts MATCH ?)
                    OR (e.rowid IS NOT NULL AND e.rowid IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?))
                    OR r.raw_text LIKE ?
                )
                """
            )
            like_expr = f"%{query.strip()}%"
            params.extend([sanitized, sanitized, like_expr])

        # Structured filters
        if filters:
            if filters.event_type:
                sql_parts.append("AND e.event_type = ?")
                params.append(filters.event_type)

            if filters.severity:
                sql_parts.append("AND e.severity = ?")
                params.append(filters.severity)

            if filters.user:
                sql_parts.append("AND (e.user_value = ? OR r.raw_text LIKE ?)")
                params.extend([filters.user, f"%{filters.user}%"])

            if filters.src_ip:
                sql_parts.append("AND (e.src_ip = ? OR r.raw_text LIKE ?)")
                params.extend([filters.src_ip, f"%{filters.src_ip}%"])

            if filters.from_time:
                sql_parts.append("AND COALESCE(e.timestamp_utc, e.timestamp_original) >= ?")
                params.append(filters.from_time)

            if filters.to_time:
                sql_parts.append("AND COALESCE(e.timestamp_utc, e.timestamp_original) <= ?")
                params.append(filters.to_time)

            if filters.evidence_id:
                sql_parts.append("AND r.evidence_id = ?")
                params.append(filters.evidence_id)

        # Ordering: deterministic secondary sort on record_no and raw_record_id
        sql_parts.append(
            """
            ORDER BY
                (e.event_id IS NOT NULL) DESC,
                COALESCE(e.timestamp_utc, e.timestamp_original) ASC,
                r.record_no ASC,
                r.raw_record_id ASC
            LIMIT ?
            """
        )
        params.append(max(1, min(limit, 200)))

        full_query = " ".join(sql_parts)

        try:
            rows = conn.execute(full_query, params).fetchall()
        except sqlite3.OperationalError:
            # Fallback if FTS parser hit an unexpected syntax edge case
            # Perform fallback parameterized LIKE query
            fallback_sql = """
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
                WHERE r.case_id = ? AND r.raw_text LIKE ?
                ORDER BY r.record_no ASC
                LIMIT ?
            """
            rows = conn.execute(fallback_sql, (case_id, f"%{query.strip()}%", limit)).fetchall()

        results: list[LexicalSearchResult] = []
        seen_ids: set[str] = set()
        current_rank = 1
        for row in rows:
            doc = build_retrieval_document_from_row(row)
            if doc.document_id in seen_ids:
                continue
            seen_ids.add(doc.document_id)
            score = 1.0 / (current_rank + 0.1)
            results.append(
                LexicalSearchResult(
                    document_id=doc.document_id,
                    rank=current_rank,
                    score=score,
                    document=doc,
                )
            )
            current_rank += 1

        return results
