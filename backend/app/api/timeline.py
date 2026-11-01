"""
Timeline API endpoints.

Provides case-scoped chronological timeline reconstruction derived directly from
persisted events in the case database, with deterministic ordering and bounded pagination.
"""

from __future__ import annotations

import math
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import get_case_connection

router = APIRouter(prefix="/api/cases/{case_id}/timeline", tags=["Timeline"])


class TimelineItemResponse(BaseModel):
    eventId: str
    caseId: str
    timestamp: Optional[str] = None
    timestampOriginal: Optional[str] = None
    eventType: str
    severity: str
    summary: str
    user: Optional[str] = None
    srcIp: Optional[str] = None
    srcPort: Optional[int] = None
    host: Optional[str] = None
    process: Optional[str] = None
    pid: Optional[int] = None
    recordNo: Optional[int] = None
    evidenceId: Optional[str] = None
    evidenceOriginalName: Optional[str] = None
    lineNumber: Optional[int] = None
    byteStart: Optional[int] = None
    byteEnd: Optional[int] = None
    eventHash: str
    rawRecordId: Optional[str] = None


class PaginatedTimelineResponse(BaseModel):
    items: list[TimelineItemResponse]
    total: int
    page: int
    pageSize: int
    totalPages: int


def _row_to_timeline_item(row: sqlite3.Row) -> TimelineItemResponse:
    """Map database Row to TimelineItemResponse without exposing filesystem paths."""
    keys = row.keys()
    orig_name = (
        row["evidence_original_name"]
        if "evidence_original_name" in keys and row["evidence_original_name"]
        else (row["source_file_name"] if "source_file_name" in keys else None)
    )
    record_no = row["record_no"] if "record_no" in keys else None

    # Summary: use raw message or event_type (do not invent claims)
    message = row["message"] if "message" in keys and row["message"] else None
    summary = message.strip() if message and message.strip() else (row["event_type"] or "EVENT")

    return TimelineItemResponse(
        eventId=row["event_id"],
        caseId=row["case_id"],
        timestamp=row["timestamp_utc"],
        timestampOriginal=row["timestamp_original"],
        eventType=row["event_type"],
        severity=row["severity"] or "INFO",
        summary=summary,
        user=row["user_value"],
        srcIp=row["src_ip"],
        srcPort=row["src_port"],
        host=row["host"],
        process=row["process"],
        pid=row["pid"],
        recordNo=record_no,
        evidenceId=row["evidence_id"],
        evidenceOriginalName=orig_name,
        lineNumber=row["line_number"],
        byteStart=row["byte_start"],
        byteEnd=row["byte_end"],
        eventHash=row["event_hash"] or "",
        rawRecordId=row["raw_record_id"],
    )


@router.get("", response_model=PaginatedTimelineResponse)
def get_case_timeline(
    case_id: str,
    page: int = Query(default=1, ge=1, description="Page number starting at 1"),
    page_size: int = Query(default=50, ge=1, le=500, description="Items per page"),
    event_type: Optional[str] = Query(default=None, description="Filter by event type"),
    severity: Optional[str] = Query(default=None, description="Filter by severity level"),
    user: Optional[str] = Query(default=None, description="Filter by username"),
    src_ip: Optional[str] = Query(default=None, description="Filter by source IP"),
    from_time: Optional[str] = Query(default=None, alias="from", description="ISO start timestamp"),
    to_time: Optional[str] = Query(default=None, alias="to", description="ISO end timestamp"),
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> PaginatedTimelineResponse:
    """
    Retrieve chronologically reconstructed timeline items for the selected case.

    Deterministic ordering: Primary by timestamp ASC, secondary by event_id ASC.
    """
    # Sanitize default values when called directly as Python function
    if not isinstance(page, int) or page < 1:
        page = 1
    if not isinstance(page_size, int) or page_size < 1:
        page_size = 50
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

    if event_type and event_type.upper() != "ALL":
        conditions.append("events.event_type = ?")
        params.append(event_type)

    if severity and severity.upper() != "ALL":
        conditions.append("events.severity = ?")
        params.append(severity)

    if user and user.strip() and user.upper() != "ALL":
        conditions.append("events.user_value = ?")
        params.append(user.strip())

    if src_ip and src_ip.strip() and src_ip.upper() != "ALL":
        conditions.append("events.src_ip = ?")
        params.append(src_ip.strip())

    if from_time:
        conditions.append("(events.timestamp_utc >= ? OR events.timestamp_original >= ?)")
        params.extend([from_time, from_time])

    if to_time:
        conditions.append("(events.timestamp_utc <= ? OR events.timestamp_original <= ?)")
        params.extend([to_time, to_time])

    where_clause = " WHERE " + " AND ".join(conditions)

    count_sql = f"SELECT COUNT(*) FROM events {where_clause}"
    total = conn.execute(count_sql, params).fetchone()[0]

    offset = (page - 1) * page_size
    select_sql = f"""
        SELECT 
            events.*,
            raw_records.record_no,
            evidence_files.original_name AS evidence_original_name
        FROM events
        LEFT JOIN raw_records ON events.raw_record_id = raw_records.raw_record_id AND events.case_id = raw_records.case_id
        LEFT JOIN evidence_files ON events.evidence_id = evidence_files.evidence_id AND events.case_id = evidence_files.case_id
        {where_clause}
        ORDER BY COALESCE(events.timestamp_utc, events.timestamp_original) ASC, events.event_id ASC
        LIMIT ? OFFSET ?
    """
    select_params = list(params) + [page_size, offset]
    rows = conn.execute(select_sql, select_params).fetchall()

    items = [_row_to_timeline_item(r) for r in rows]
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return PaginatedTimelineResponse(
        items=items,
        total=total,
        page=page,
        pageSize=page_size,
        totalPages=total_pages,
    )

