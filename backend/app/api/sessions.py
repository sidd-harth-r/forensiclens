"""
Sessions API endpoints.

Provides case-scoped deterministic forensic session reconstruction from persisted events.
Groups related authentication and network events into auditable sessions.
"""

from __future__ import annotations

import math
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_case_connection, validate_identifier
from app.correlation.sessions import (
    DEFAULT_SESSION_GAP_SECONDS,
    ForensicSession,
    reconstruct_sessions,
)

router = APIRouter(prefix="/api/cases/{case_id}/sessions", tags=["Sessions"])


class SessionEventResponse(BaseModel):
    eventId: str
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


class ForensicSessionResponse(BaseModel):
    sessionId: str
    caseId: str
    user: Optional[str] = None
    srcIp: Optional[str] = None
    host: Optional[str] = None
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    durationSeconds: int
    eventCount: int
    status: str
    correlationBasis: list[str]
    events: list[SessionEventResponse]


class PaginatedSessionsResponse(BaseModel):
    items: list[ForensicSessionResponse]
    total: int
    page: int
    pageSize: int
    totalPages: int


def _session_to_response(s: ForensicSession) -> ForensicSessionResponse:
    """Map ForensicSession dataclass to ForensicSessionResponse model."""
    events = [
        SessionEventResponse(
            eventId=ev.eventId,
            timestamp=ev.timestamp,
            timestampOriginal=ev.timestampOriginal,
            eventType=ev.eventType,
            severity=ev.severity,
            summary=ev.summary,
            user=ev.user,
            srcIp=ev.srcIp,
            srcPort=ev.srcPort,
            host=ev.host,
            process=ev.process,
            pid=ev.pid,
            recordNo=ev.recordNo,
            evidenceId=ev.evidenceId,
            evidenceOriginalName=ev.evidenceOriginalName,
            lineNumber=ev.lineNumber,
            byteStart=ev.byteStart,
            byteEnd=ev.byteEnd,
            eventHash=ev.eventHash,
            rawRecordId=ev.rawRecordId,
        )
        for ev in s.events
    ]
    return ForensicSessionResponse(
        sessionId=s.sessionId,
        caseId=s.caseId,
        user=s.user,
        srcIp=s.srcIp,
        host=s.host,
        startTime=s.startTime,
        endTime=s.endTime,
        durationSeconds=s.durationSeconds,
        eventCount=s.eventCount,
        status=s.status,
        correlationBasis=s.correlationBasis,
        events=events,
    )


def _fetch_case_events_for_correlation(
    conn: sqlite3.Connection,
    case_id: str,
) -> list[dict]:
    """Fetch all case events sorted chronologically for deterministic session grouping."""
    sql = """
        SELECT 
            events.*,
            raw_records.record_no,
            evidence_files.original_name AS evidence_original_name
        FROM events
        LEFT JOIN raw_records ON events.raw_record_id = raw_records.raw_record_id AND events.case_id = raw_records.case_id
        LEFT JOIN evidence_files ON events.evidence_id = evidence_files.evidence_id AND events.case_id = evidence_files.case_id
        WHERE events.case_id = ?
        ORDER BY COALESCE(events.timestamp_utc, events.timestamp_original) ASC, events.event_id ASC
    """
    rows = conn.execute(sql, (case_id,)).fetchall()
    return [dict(r) for r in rows]


@router.get("", response_model=PaginatedSessionsResponse)
def list_case_sessions(
    case_id: str,
    page: int = Query(default=1, ge=1, description="Page number starting at 1"),
    page_size: int = Query(default=20, ge=1, le=200, description="Items per page"),
    user: Optional[str] = Query(default=None, description="Filter by user"),
    src_ip: Optional[str] = Query(default=None, description="Filter by source IP"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status (CLOSED, OPEN, INCOMPLETE)"),
    from_time: Optional[str] = Query(default=None, alias="from", description="ISO start timestamp"),
    to_time: Optional[str] = Query(default=None, alias="to", description="ISO end timestamp"),
    gap_seconds: int = Query(default=DEFAULT_SESSION_GAP_SECONDS, ge=10, le=86400, description="Session gap threshold"),
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> PaginatedSessionsResponse:
    """
    Retrieve deterministically reconstructed forensic sessions for the selected case.
    """
    if not isinstance(page, int) or page < 1:
        page = 1
    if not isinstance(page_size, int) or page_size < 1:
        page_size = 20
    if not isinstance(user, str):
        user = None
    if not isinstance(src_ip, str):
        src_ip = None
    if not isinstance(status_filter, str):
        status_filter = None
    if not isinstance(from_time, str):
        from_time = None
    if not isinstance(to_time, str):
        to_time = None
    if not isinstance(gap_seconds, int) or gap_seconds < 10:
        gap_seconds = DEFAULT_SESSION_GAP_SECONDS

    raw_events = _fetch_case_events_for_correlation(conn, case_id)
    all_sessions = reconstruct_sessions(raw_events, case_id=case_id, gap_seconds=gap_seconds)

    # Filter sessions
    filtered = all_sessions

    if user and user.strip() and user.upper() != "ALL":
        u_norm = user.strip().lower()
        filtered = [s for s in filtered if s.user and u_norm in s.user.lower()]

    if src_ip and src_ip.strip() and src_ip.upper() != "ALL":
        ip_norm = src_ip.strip()
        filtered = [s for s in filtered if s.srcIp and ip_norm in s.srcIp]

    if status_filter and status_filter.strip() and status_filter.upper() != "ALL":
        st_norm = status_filter.strip().upper()
        filtered = [s for s in filtered if s.status.upper() == st_norm]

    if from_time:
        filtered = [s for s in filtered if (s.startTime or "") >= from_time]

    if to_time:
        filtered = [s for s in filtered if (s.endTime or "") <= to_time]

    total = len(filtered)
    total_pages = math.ceil(total / page_size) if total > 0 else 1
    offset = (page - 1) * page_size
    page_items = filtered[offset : offset + page_size]

    return PaginatedSessionsResponse(
        items=[_session_to_response(s) for s in page_items],
        total=total,
        page=page,
        pageSize=page_size,
        totalPages=total_pages,
    )


@router.get("/{session_id}", response_model=ForensicSessionResponse)
def get_case_session_by_id(
    case_id: str,
    session_id: str,
    gap_seconds: int = Query(default=DEFAULT_SESSION_GAP_SECONDS, ge=10, le=86400),
    conn: sqlite3.Connection = Depends(get_case_connection),
) -> ForensicSessionResponse:
    """
    Retrieve full metadata, ordered event sequence, and provenance for a single forensic session.
    """
    validate_identifier(session_id, "session_id")
    if not isinstance(gap_seconds, int) or gap_seconds < 10:
        gap_seconds = DEFAULT_SESSION_GAP_SECONDS
    raw_events = _fetch_case_events_for_correlation(conn, case_id)
    all_sessions = reconstruct_sessions(raw_events, case_id=case_id, gap_seconds=gap_seconds)

    for s in all_sessions:
        if s.sessionId == session_id:
            return _session_to_response(s)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Forensic session '{session_id}' not found in case '{case_id}'.",
    )
