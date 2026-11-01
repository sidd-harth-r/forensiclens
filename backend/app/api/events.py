"""
Events API endpoints.

Provides case-scoped querying, filtering, full-text lexical search (FTS5),
and detail retrieval for normalized forensic events.
"""

from __future__ import annotations

import math
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_case_connection, validate_identifier

router = APIRouter(prefix="/api/cases/{case_id}/events", tags=["Events"])


class ForensicEventResponse(BaseModel):
    eventId: str
    caseId: str
    evidenceId: str
    rawRecordId: Optional[str] = None
    timestampUtc: Optional[str] = None
    timestampOriginal: Optional[str] = None
    timestampConfidence: Optional[str] = None
    tzAssumed: Optional[str] = None
    source: str
    host: Optional[str] = None
    eventType: str
    severity: str
    userValue: Optional[str] = None
    srcIp: Optional[str] = None
    srcIpScope: Optional[str] = None
    srcPort: Optional[int] = None
    process: Optional[str] = None
    pid: Optional[int] = None
    commandValue: Optional[str] = None
    resource: Optional[str] = None
    message: str
    parseStatus: str
    sourceFileName: Optional[str] = None
    lineNumber: Optional[int] = None
    byteStart: Optional[int] = None
    byteEnd: Optional[int] = None
    eventHash: str
    createdAt: str
    # Provenance and detail extensions
    rawText: Optional[str] = None
    evidenceOriginalName: Optional[str] = None
    evidenceFormat: Optional[str] = None
    recordNo: Optional[int] = None
    parseError: Optional[str] = None


class PaginatedEventsResponse(BaseModel):
    items: list[ForensicEventResponse]
    total: int
    page: int
    pageSize: int
    totalPages: int


def _row_to_event_response(row: sqlite3.Row) -> ForensicEventResponse:
    """Map database Row to ForensicEventResponse model with optional joined provenance fields."""
    keys = row.keys()
    raw_text = row["raw_text"] if "raw_text" in keys else None
    evidence_orig_name = (
        row["evidence_original_name"]
        if "evidence_original_name" in keys and row["evidence_original_name"]
        else (row["source_file_name"] if "source_file_name" in keys else None)
    )
    evidence_format = row["evidence_format"] if "evidence_format" in keys else None
    record_no = row["record_no"] if "record_no" in keys else None
    parse_error = row["parse_error"] if "parse_error" in keys else None
    tz_assumed = row["tz_assumed"] if "tz_assumed" in keys else None

    return ForensicEventResponse(
        eventId=row["event_id"],
        caseId=row["case_id"],
        evidenceId=row["evidence_id"],
        rawRecordId=row["raw_record_id"],
        timestampUtc=row["timestamp_utc"],
        timestampOriginal=row["timestamp_original"],
        timestampConfidence=row["timestamp_confidence"],
        tzAssumed=tz_assumed,
        source=row["source"] or "UNKNOWN",
        host=row["host"],
        eventType=row["event_type"],
        severity=row["severity"] or "INFO",
        userValue=row["user_value"],
        srcIp=row["src_ip"],
        srcIpScope=row["src_ip_scope"],
        srcPort=row["src_port"],
        process=row["process"],
        pid=row["pid"],
        commandValue=row["command_value"],
        resource=row["resource"],
        message=row["message"] or "",
        parseStatus=row["parse_status"],
        sourceFileName=row["source_file_name"],
        lineNumber=row["line_number"],
        byteStart=row["byte_start"],
        byteEnd=row["byte_end"],
        eventHash=row["event_hash"],
        createdAt=row["created_at"],
        rawText=raw_text,
        evidenceOriginalName=evidence_orig_name,
        evidenceFormat=evidence_format,
        recordNo=record_no,
        parseError=parse_error,
    )


@router.get("", response_model=PaginatedEventsResponse)
def list_case_events(
    case_id: str,
    page: int = Query(default=1, ge=1, description="Page number starting at 1"),
    page_size: int = Query(default=50, ge=1, le=500, description="Items per page"),
    search: Optional[str] = Query(default=None, description="Lexical search query"),
    event_type: Optional[str] = Query(default=None, description="Filter by event type"),
    severity: Optional[str] = Query(default=None, description="Filter by severity level"),
    user: Optional[str] = Query(default=None, description="Filter by username"),
    src_ip: Optional[str] = Query(default=None, description="Filter by source IP address"),
    from_time: Optional[str] = Query(default=None, alias="from", description="ISO start timestamp"),
    to_time: Optional[str] = Query(default=None, alias="to", description="ISO end timestamp"),
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> PaginatedEventsResponse:
    """
    Query case-scoped normalized forensic events.

    Supports FTS5 full-text indexing, exact field filters, date ranges, and pagination.
    """
    # Sanitize default arguments when called directly as Python function
    if not isinstance(page, int) or page < 1:
        page = 1
    if not isinstance(page_size, int) or page_size < 1:
        page_size = 50
    if not isinstance(search, str):
        search = None
    if not isinstance(event_type, str):
        event_type = None
    if not isinstance(severity, str):
        severity = None
    if not isinstance(user, str):
        user = None
    if not isinstance(src_ip, str):
        src_ip = None
    if not isinstance(from_time, str):
        from_time = None
    if not isinstance(to_time, str):
        to_time = None

    conditions = ["events.case_id = ?"]
    params: list = [case_id]

    fallback_conditions = ["events.case_id = ?"]
    fallback_params: list = [case_id]

    if event_type and event_type.upper() != "ALL":
        conditions.append("events.event_type = ?")
        params.append(event_type)
        fallback_conditions.append("events.event_type = ?")
        fallback_params.append(event_type)

    if severity and severity.upper() != "ALL":
        conditions.append("events.severity = ?")
        params.append(severity)
        fallback_conditions.append("events.severity = ?")
        fallback_params.append(severity)

    if user and user.strip() and user.upper() != "ALL":
        clean_user = user.strip()
        conditions.append("events.user_value = ?")
        params.append(clean_user)
        fallback_conditions.append("events.user_value = ?")
        fallback_params.append(clean_user)

    if src_ip and src_ip.strip() and src_ip.upper() != "ALL":
        clean_ip = src_ip.strip()
        conditions.append("events.src_ip = ?")
        params.append(clean_ip)
        fallback_conditions.append("events.src_ip = ?")
        fallback_params.append(clean_ip)

    if from_time:
        cond = "(events.timestamp_utc >= ? OR events.timestamp_original >= ?)"
        conditions.append(cond)
        params.extend([from_time, from_time])
        fallback_conditions.append(cond)
        fallback_params.extend([from_time, from_time])

    if to_time:
        cond = "(events.timestamp_utc <= ? OR events.timestamp_original <= ?)"
        conditions.append(cond)
        params.extend([to_time, to_time])
        fallback_conditions.append(cond)
        fallback_params.extend([to_time, to_time])

    has_search = False
    if search and search.strip():
        has_search = True
        clean = search.strip()
        like_expr = f"%{clean}%"

        # Safe FTS5 term tokenization
        fts_words = [w.strip() for w in clean.replace('"', ' ').replace("'", " ").split() if w.strip()]
        if fts_words:
            fts_query = " ".join(f'"{w}"*' for w in fts_words)
            conditions.append(
                """(
                    events.rowid IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)
                    OR events.src_ip LIKE ?
                    OR events.user_value LIKE ?
                    OR events.event_id LIKE ?
                    OR events.message LIKE ?
                )"""
            )
            params.extend([fts_query, like_expr, like_expr, like_expr, like_expr])
        else:
            conditions.append(
                """(
                    events.src_ip LIKE ?
                    OR events.user_value LIKE ?
                    OR events.event_id LIKE ?
                    OR events.message LIKE ?
                )"""
            )
            params.extend([like_expr, like_expr, like_expr, like_expr])

        fallback_conditions.append(
            """(
                events.src_ip LIKE ?
                OR events.user_value LIKE ?
                OR events.event_id LIKE ?
                OR events.message LIKE ?
            )"""
        )
        fallback_params.extend([like_expr, like_expr, like_expr, like_expr])

    where_clause = " WHERE " + " AND ".join(conditions)
    fallback_where = " WHERE " + " AND ".join(fallback_conditions)

    count_sql = f"SELECT COUNT(*) FROM events {where_clause}"
    fallback_count_sql = f"SELECT COUNT(*) FROM events {fallback_where}"

    offset = (page - 1) * page_size
    select_sql = (
        f"SELECT * FROM events {where_clause} "
        "ORDER BY timestamp_utc ASC, event_id ASC LIMIT ? OFFSET ?"
    )
    fallback_select_sql = (
        f"SELECT * FROM events {fallback_where} "
        "ORDER BY timestamp_utc ASC, event_id ASC LIMIT ? OFFSET ?"
    )

    query_params = list(params)
    select_params = list(params) + [page_size, offset]

    fallback_q_params = list(fallback_params)
    fallback_s_params = list(fallback_params) + [page_size, offset]

    try:
        total = conn.execute(count_sql, query_params).fetchone()[0]
        rows = conn.execute(select_sql, select_params).fetchall()
    except sqlite3.OperationalError:
        if has_search:
            # Fall back to pure SQL LIKE without FTS5 match
            total = conn.execute(fallback_count_sql, fallback_q_params).fetchone()[0]
            rows = conn.execute(fallback_select_sql, fallback_s_params).fetchall()
        else:
            raise

    items = [_row_to_event_response(r) for r in rows]
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return PaginatedEventsResponse(
        items=items,
        total=total,
        page=page,
        pageSize=page_size,
        totalPages=total_pages,
    )


@router.get("/{event_id}", response_model=ForensicEventResponse)
def get_case_event_by_id(
    case_id: str,
    event_id: str,
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> ForensicEventResponse:
    """Retrieve full forensic details, byte-level provenance, and exact raw text for a single event."""
    validate_identifier(event_id, "event_id")
    row = conn.execute(
        """
        SELECT 
            events.*,
            raw_records.raw_text,
            raw_records.record_no,
            raw_records.parse_error,
            evidence_files.original_name AS evidence_original_name,
            evidence_files.format AS evidence_format
        FROM events
        LEFT JOIN raw_records ON events.raw_record_id = raw_records.raw_record_id AND events.case_id = raw_records.case_id
        LEFT JOIN evidence_files ON events.evidence_id = evidence_files.evidence_id AND events.case_id = evidence_files.case_id
        WHERE events.case_id = ? AND events.event_id = ?
        """,
        (case_id, event_id),
    ).fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic event '{event_id}' not found in case '{case_id}'.",
        )

    return _row_to_event_response(row)
