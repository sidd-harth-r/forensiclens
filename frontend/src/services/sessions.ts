import { apiClient, isApiMode, ApiError } from "@/services/apiClient";
import { FIXTURE_EVENTS } from "@/fixtures/events";
import {
  ForensicSession,
  PaginatedSessions,
  SessionEvent,
  SessionQueryParams,
  SessionStatus,
} from "@/types/session";
import { EventSeverity } from "@/types/event";

function buildFixtureSessions(caseId?: string): ForensicSession[] {
  const events = caseId ? FIXTURE_EVENTS.filter((e) => e.caseId === caseId) : FIXTURE_EVENTS;
  if (!events.length) return [];

  // Group by (user, srcIp)
  const groups = new Map<string, typeof FIXTURE_EVENTS>();
  for (const ev of events) {
    const key = `${ev.userValue || "none"}@${ev.srcIp || "none"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }

  const sessions: ForensicSession[] = [];
  let idx = 1;

  for (const [, evList] of groups.entries()) {
    const sorted = [...evList].sort((a, b) =>
      (a.timestampUtc || a.timestampOriginal || "").localeCompare(
        b.timestampUtc || b.timestampOriginal || ""
      )
    );

    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const hasClose = sorted.some(
      (e) => e.eventType === "SESSION_CLOSED" || e.eventType === "DISCONNECT"
    );
    const hasOpen = sorted.some(
      (e) => e.eventType === "AUTH_SUCCESS" || e.eventType === "SESSION_OPENED"
    );

    let status: SessionStatus = "INCOMPLETE";
    if (hasClose) {
      status = "CLOSED";
    } else if (hasOpen) {
      status = "OPEN";
    }

    const basis: string[] = [];
    if (first.userValue) basis.push(`User identity matched ('${first.userValue}')`);
    if (first.srcIp) basis.push(`Source IP matched ('${first.srcIp}')`);
    basis.push("Events within 300s correlation window");
    if (hasClose) {
      basis.push("Session termination lifecycle marker detected");
    } else if (hasOpen) {
      basis.push("Session start lifecycle marker detected without termination");
    } else {
      basis.push("Unsuccessful authentication sequence");
    }

    const sessionEvents: SessionEvent[] = sorted.map((e) => ({
      eventId: e.eventId,
      timestamp: e.timestampUtc,
      timestampOriginal: e.timestampOriginal,
      eventType: e.eventType,
      severity: e.severity as EventSeverity,
      summary: e.message || e.eventType,
      user: e.userValue,
      srcIp: e.srcIp,
      srcPort: e.srcPort,
      host: e.host,
      process: e.process,
      pid: e.pid,
      recordNo: e.lineNumber,
      evidenceId: e.evidenceId,
      evidenceOriginalName: e.sourceFileName || "auth.log",
      lineNumber: e.lineNumber,
      byteStart: e.byteStart,
      byteEnd: e.byteEnd,
      eventHash: e.eventHash,
      rawRecordId: e.rawRecordId,
    }));

    sessions.push({
      sessionId: `SES_${caseId || "CASE-001"}_${String(idx).padStart(3, "0")}`,
      caseId: caseId || first.caseId,
      user: first.userValue,
      srcIp: first.srcIp,
      host: first.host,
      startTime: first.timestampUtc || first.timestampOriginal,
      endTime: last.timestampUtc || last.timestampOriginal,
      durationSeconds: sorted.length > 1 ? 180 : 0,
      eventCount: sorted.length,
      status,
      correlationBasis: basis,
      events: sessionEvents,
    });
    idx++;
  }

  return sessions;
}

export async function getSessions(
  caseId?: string,
  params?: SessionQueryParams
): Promise<PaginatedSessions> {
  if (isApiMode) {
    if (!caseId) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: params?.pageSize || 20,
        totalPages: 1,
      };
    }

    const query: Record<string, unknown> = {};
    if (params?.page) query.page = params.page;
    if (params?.pageSize) query.page_size = params.pageSize;
    if (params?.user && params.user.trim()) query.user = params.user.trim();
    if (params?.srcIp && params.srcIp.trim()) query.src_ip = params.srcIp.trim();
    if (params?.status && params.status !== "ALL") query.status = params.status;
    if (params?.from && params.from.trim()) query.from = params.from.trim();
    if (params?.to && params.to.trim()) query.to = params.to.trim();
    if (params?.gapSeconds) query.gap_seconds = params.gapSeconds;

    return await apiClient.get<PaginatedSessions>(
      `/api/cases/${encodeURIComponent(caseId)}/sessions`,
      query
    );
  }

  // Fixture Mode fallback
  let all = buildFixtureSessions(caseId);

  if (params?.user && params.user.trim()) {
    const u = params.user.toLowerCase();
    all = all.filter((s) => s.user && s.user.toLowerCase().includes(u));
  }

  if (params?.srcIp && params.srcIp.trim()) {
    all = all.filter((s) => s.srcIp && s.srcIp.includes(params.srcIp!));
  }

  if (params?.status && params.status !== "ALL") {
    all = all.filter((s) => s.status === params.status);
  }

  if (params?.from) {
    all = all.filter((s) => (s.startTime || "") >= params.from!);
  }

  if (params?.to) {
    all = all.filter((s) => (s.endTime || "") <= params.to!);
  }

  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const total = all.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  return Promise.resolve({
    items,
    total,
    page,
    pageSize,
    totalPages,
  });
}

export async function getSessionById(
  caseId: string,
  sessionId: string
): Promise<ForensicSession | null> {
  if (isApiMode) {
    try {
      return await apiClient.get<ForensicSession>(
        `/api/cases/${encodeURIComponent(caseId)}/sessions/${encodeURIComponent(sessionId)}`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const all = buildFixtureSessions(caseId);
  const found = all.find((s) => s.sessionId === sessionId);
  return Promise.resolve(found ? { ...found } : null);
}

