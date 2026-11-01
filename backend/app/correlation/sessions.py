"""
Deterministic forensic session reconstruction service.

Groups case-scoped normalized events into logical forensic sessions using explicit,
transparent correlation heuristics (Actor Identity + Temporal Proximity + Lifecycle Markers).

IMPORTANT FORENSIC DISCLAIMER:
Session reconstruction is an MVP deterministic correlation heuristic and does NOT constitute
definitive proof of user identity, human intent, attribution, or malicious activity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


# Configurable temporal correlation threshold (seconds).
# Documented MVP heuristic: 5 minutes between consecutive actor events.
DEFAULT_SESSION_GAP_SECONDS: int = 300

# Canonical lifecycle marker event types
LIFECYCLE_START_EVENTS = {"AUTH_SUCCESS", "SESSION_OPENED"}
LIFECYCLE_TERMINATE_EVENTS = {"SESSION_CLOSED", "DISCONNECT", "LOGOUT"}
LIFECYCLE_FAILURE_EVENTS = {"AUTH_FAILURE", "INVALID_USER"}


@dataclass
class CorrelationSignal:
    """Explicit audit record of reasons why events were correlated into a session."""

    user_matched: bool = False
    user_value: Optional[str] = None
    ip_matched: bool = False
    ip_value: Optional[str] = None
    temporal_proximity: bool = False
    max_gap_seconds: float = 0.0
    gap_threshold_seconds: int = DEFAULT_SESSION_GAP_SECONDS
    lifecycle_start_detected: bool = False
    lifecycle_closed_detected: bool = False
    lifecycle_close_event: Optional[str] = None
    single_unattributed_event: bool = False

    def to_basis_list(self) -> list[str]:
        """Convert signals into a human-readable, transparent list of correlation factors."""
        basis = []
        if self.single_unattributed_event:
            basis.append("Unattributed event: isolated without identity signals (no user/IP)")
            return basis

        if self.user_matched and self.user_value:
            basis.append(f"User identity matched ('{self.user_value}')")
        if self.ip_matched and self.ip_value:
            basis.append(f"Source IP matched ('{self.ip_value}')")

        if self.temporal_proximity:
            basis.append(
                f"Consecutive event interval within {self.gap_threshold_seconds}s threshold "
                f"(max observed gap: {int(self.max_gap_seconds)}s)"
            )

        if self.lifecycle_start_detected:
            basis.append("Session start lifecycle marker detected (AUTH_SUCCESS / SESSION_OPENED)")

        if self.lifecycle_closed_detected:
            close_type = self.lifecycle_close_event or "SESSION_CLOSED"
            basis.append(f"Session termination lifecycle marker detected ({close_type})")
        else:
            basis.append("No explicit termination event recorded (ended at final correlated event)")

        return basis


@dataclass
class ForensicSessionEvent:
    """Ordered event reference within a reconstructed forensic session."""

    eventId: str
    timestamp: Optional[str]
    timestampOriginal: Optional[str]
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
    eventHash: str = ""
    rawRecordId: Optional[str] = None


@dataclass
class ForensicSession:
    """Reconstructed forensic session with deterministic identifier and provenance."""

    sessionId: str
    caseId: str
    user: Optional[str]
    srcIp: Optional[str]
    host: Optional[str]
    startTime: Optional[str]
    endTime: Optional[str]
    durationSeconds: int
    eventCount: int
    status: str  # 'CLOSED', 'OPEN', 'INCOMPLETE'
    correlationBasis: list[str] = field(default_factory=list)
    events: list[ForensicSessionEvent] = field(default_factory=list)


def parse_timestamp_to_seconds(ts_str: Optional[str]) -> Optional[float]:
    """Parse ISO or BSD syslog timestamp string into epoch seconds for temporal comparison."""
    if not ts_str or not isinstance(ts_str, str):
        return None

    clean = ts_str.strip()
    # Try ISO-8601
    try:
        iso_clean = clean.replace("Z", "+00:00")
        return datetime.fromisoformat(iso_clean).timestamp()
    except Exception:
        pass

    # Try standard syslog format: "Jan 15 10:20:30"
    for fmt in ("%b %d %H:%M:%S", "%b  %d %H:%M:%S"):
        try:
            parsed = datetime.strptime(clean[:15], fmt)
            # Use base leap year 2024 for consistent calendar math
            return parsed.replace(year=2024).timestamp()
        except Exception:
            pass

    return None


def _format_event_summary(ev: dict[str, Any]) -> str:
    """Generate neutral, factual summary string without inventing inferences."""
    msg = ev.get("message")
    if msg and msg.strip():
        return msg.strip()
    return ev.get("event_type") or "EVENT"


def _row_to_session_event(row: dict[str, Any]) -> ForensicSessionEvent:
    """Convert raw dictionary or SQLite row to ForensicSessionEvent."""
    return ForensicSessionEvent(
        eventId=row["event_id"],
        timestamp=row.get("timestamp_utc"),
        timestampOriginal=row.get("timestamp_original"),
        eventType=row.get("event_type") or "UNKNOWN",
        severity=row.get("severity") or "INFO",
        summary=_format_event_summary(row),
        user=row.get("user_value"),
        srcIp=row.get("src_ip"),
        srcPort=row.get("src_port"),
        host=row.get("host"),
        process=row.get("process"),
        pid=row.get("pid"),
        recordNo=row.get("record_no"),
        evidenceId=row.get("evidence_id"),
        evidenceOriginalName=row.get("evidence_original_name") or row.get("source_file_name"),
        lineNumber=row.get("line_number"),
        byteStart=row.get("byte_start"),
        byteEnd=row.get("byte_end"),
        eventHash=row.get("event_hash") or "",
        rawRecordId=row.get("raw_record_id"),
    )


def reconstruct_sessions(
    events: list[dict[str, Any]],
    case_id: str,
    gap_seconds: int = DEFAULT_SESSION_GAP_SECONDS,
) -> list[ForensicSession]:
    """
    Reconstruct logical sessions from chronologically ordered events.

    Deterministic Correlation Rules:
    1. Actor identity: Matches user and/or src_ip.
       - Different users NEVER form the same session.
       - Different source IPs NEVER form the same session when both are available.
       - If an event has missing IP (e.g. pam_unix session opened), it correlates with the
         active session of the matching user.
       - If neither user nor IP is present, event is isolated into an unattributed session.
    2. Temporal proximity: Interval between consecutive events for the actor must be <= gap_seconds.
    3. Lifecycle markers:
       - SESSION_CLOSED, DISCONNECT, LOGOUT terminates the session as 'CLOSED'.
       - If gap exceeds threshold before closure, previous session becomes 'INCOMPLETE'.
       - If stream ends without closure event, session becomes 'OPEN' (or 'INCOMPLETE' if only failures).
    4. Deterministic Session IDs:
       - Sessions are deterministically sorted by startTime and actor.
       - Assigned sequential IDs: SES_<case_id>_<index:03d>.
    """
    if not events:
        return []

    if not isinstance(gap_seconds, (int, float)) or gap_seconds < 10:
        gap_seconds = DEFAULT_SESSION_GAP_SECONDS

    # Sort events deterministically: primary by timestamp, secondary by event_id
    sorted_events = sorted(
        events,
        key=lambda e: (
            e.get("timestamp_utc") or e.get("timestamp_original") or "",
            e.get("event_id") or "",
        ),
    )

    # List of active sessions currently open and accumulating events
    active_sessions: list[dict[str, Any]] = []
    completed_sessions: list[dict[str, Any]] = []

    for ev in sorted_events:
        user = ev.get("user_value")
        user_norm = user.strip().lower() if user and isinstance(user, str) and user.strip() else None

        ip = ev.get("src_ip")
        ip_norm = ip.strip() if ip and isinstance(ip, str) and ip.strip() else None

        ev_time = parse_timestamp_to_seconds(ev.get("timestamp_utc") or ev.get("timestamp_original"))
        session_event = _row_to_session_event(ev)
        event_type = (ev.get("event_type") or "").upper()

        # Rule E: If no identity is available, do NOT force correlation.
        if not user_norm and not ip_norm:
            sig = CorrelationSignal(
                user_matched=False,
                ip_matched=False,
                temporal_proximity=False,
                single_unattributed_event=True,
            )
            completed_sessions.append(
                {
                    "user": None,
                    "src_ip": None,
                    "host": ev.get("host"),
                    "start_time": session_event.timestamp or session_event.timestampOriginal,
                    "end_time": session_event.timestamp or session_event.timestampOriginal,
                    "duration_seconds": 0,
                    "status": "INCOMPLETE",
                    "signal": sig,
                    "events": [session_event],
                    "last_time": ev_time,
                }
            )
            continue

        # Find matching active session:
        # 1. User must match if both present (or cannot conflict)
        # 2. IP must match if both present (different source IPs cannot merge)
        # 3. Time gap <= gap_seconds
        matched_idx: Optional[int] = None
        for idx, act in enumerate(active_sessions):
            act_user_norm = act["user"].strip().lower() if act["user"] else None
            act_ip_norm = act["src_ip"].strip() if act["src_ip"] else None

            # User conflict check
            if user_norm and act_user_norm and user_norm != act_user_norm:
                continue

            # IP conflict check: different IPs when both are available cannot merge
            if ip_norm and act_ip_norm and ip_norm != act_ip_norm:
                continue

            # At least one identity signal must link them
            has_identity_link = (
                (user_norm and act_user_norm and user_norm == act_user_norm)
                or (ip_norm and act_ip_norm and ip_norm == act_ip_norm)
            )
            if not has_identity_link:
                continue

            # Temporal proximity check
            time_gap: Optional[float] = None
            if ev_time is not None and act["last_time"] is not None:
                time_gap = ev_time - act["last_time"]

            if time_gap is not None and time_gap > gap_seconds:
                # Outside threshold: cannot match this session
                continue

            matched_idx = idx
            break

        if matched_idx is None:
            # Check if there are timed-out active sessions to finalize
            # (sessions where ev_time - last_time > gap_seconds)
            surviving_active = []
            for act in active_sessions:
                if (
                    ev_time is not None
                    and act["last_time"] is not None
                    and (ev_time - act["last_time"]) > gap_seconds
                ):
                    act["status"] = "INCOMPLETE"
                    completed_sessions.append(act)
                else:
                    surviving_active.append(act)
            active_sessions = surviving_active

            # Start new session
            sig = CorrelationSignal(
                user_matched=bool(user_norm),
                user_value=user,
                ip_matched=bool(ip_norm),
                ip_value=ip,
                temporal_proximity=False,
                gap_threshold_seconds=int(gap_seconds),
            )
            if event_type in LIFECYCLE_START_EVENTS:
                sig.lifecycle_start_detected = True

            is_terminated = event_type in LIFECYCLE_TERMINATE_EVENTS
            if is_terminated:
                sig.lifecycle_closed_detected = True
                sig.lifecycle_close_event = event_type

            new_session = {
                "user": user,
                "src_ip": ip,
                "host": ev.get("host"),
                "start_time": session_event.timestamp or session_event.timestampOriginal,
                "end_time": session_event.timestamp or session_event.timestampOriginal,
                "duration_seconds": 0,
                "status": "CLOSED" if is_terminated else "OPEN",
                "signal": sig,
                "events": [session_event],
                "first_time": ev_time,
                "last_time": ev_time,
            }

            if is_terminated:
                completed_sessions.append(new_session)
            else:
                active_sessions.append(new_session)
        else:
            # Correlate event into matched active session
            act = active_sessions[matched_idx]
            act["events"].append(session_event)
            act["end_time"] = session_event.timestamp or session_event.timestampOriginal
            sig: CorrelationSignal = act["signal"]
            sig.temporal_proximity = True

            # Enrich user/IP if previous was missing
            if not act["user"] and user:
                act["user"] = user
                sig.user_matched = True
                sig.user_value = user
            if not act["src_ip"] and ip:
                act["src_ip"] = ip
                sig.ip_matched = True
                sig.ip_value = ip

            if ev_time is not None and act["last_time"] is not None:
                gap = max(0.0, ev_time - act["last_time"])
                sig.max_gap_seconds = max(sig.max_gap_seconds, gap)

            if ev_time is not None and act["first_time"] is not None:
                act["duration_seconds"] = max(0, int(ev_time - act["first_time"]))

            act["last_time"] = ev_time

            if event_type in LIFECYCLE_START_EVENTS:
                sig.lifecycle_start_detected = True

            if event_type in LIFECYCLE_TERMINATE_EVENTS:
                sig.lifecycle_closed_detected = True
                sig.lifecycle_close_event = event_type
                act["status"] = "CLOSED"
                completed_sessions.append(act)
                active_sessions.pop(matched_idx)

    # Finalize any remaining active sessions
    for act in active_sessions:
        has_auth_success = any(
            e.eventType in LIFECYCLE_START_EVENTS for e in act["events"]
        )
        if not has_auth_success:
            act["status"] = "INCOMPLETE"
        else:
            act["status"] = "OPEN"
        completed_sessions.append(act)

    # Sort all completed sessions deterministically:
    # Primary: start_time ASC
    # Secondary: user or ip or first eventId
    sorted_completed = sorted(
        completed_sessions,
        key=lambda s: (
            s["start_time"] or "",
            s["user"] or "",
            s["src_ip"] or "",
            s["events"][0].eventId if s["events"] else "",
        ),
    )

    # Build final ForensicSession instances with deterministic session IDs
    final_sessions: list[ForensicSession] = []
    for idx, s in enumerate(sorted_completed, start=1):
        session_id = f"SES_{case_id}_{idx:03d}"
        final_sessions.append(
            ForensicSession(
                sessionId=session_id,
                caseId=case_id,
                user=s["user"],
                srcIp=s["src_ip"],
                host=s["host"],
                startTime=s["start_time"],
                endTime=s["end_time"],
                durationSeconds=s["duration_seconds"],
                eventCount=len(s["events"]),
                status=s["status"],
                correlationBasis=s["signal"].to_basis_list(),
                events=s["events"],
            )
        )

    return final_sessions
