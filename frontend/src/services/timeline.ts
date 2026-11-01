import { apiClient, isApiMode } from "@/services/apiClient";
import { FIXTURE_EVENTS } from "@/fixtures/events";
import { PaginatedTimeline, TimelineItem, TimelineQueryParams } from "@/types/timeline";
import { EventSeverity } from "@/types/event";

export async function getTimeline(
  caseId?: string,
  params?: TimelineQueryParams
): Promise<PaginatedTimeline> {
  if (isApiMode) {
    if (!caseId) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: params?.pageSize || 50,
        totalPages: 1,
      };
    }

    const query: Record<string, unknown> = {};
    if (params?.page) query.page = params.page;
    if (params?.pageSize) query.page_size = params.pageSize;
    if (params?.eventType && params.eventType !== "ALL") query.event_type = params.eventType;
    if (params?.severity && params.severity !== "ALL") query.severity = params.severity;
    if (params?.user && params.user.trim()) query.user = params.user.trim();
    if (params?.srcIp && params.srcIp.trim()) query.src_ip = params.srcIp.trim();
    if (params?.from && params.from.trim()) query.from = params.from.trim();
    if (params?.to && params.to.trim()) query.to = params.to.trim();

    return await apiClient.get<PaginatedTimeline>(
      `/api/cases/${encodeURIComponent(caseId)}/timeline`,
      query
    );
  }

  // Fixture Mode fallback: derived chronologically from FIXTURE_EVENTS
  let filtered = [...FIXTURE_EVENTS];
  if (caseId) {
    filtered = filtered.filter((e) => e.caseId === caseId);
  }

  if (params?.eventType && params.eventType !== "ALL") {
    filtered = filtered.filter((e) => e.eventType === params.eventType);
  }

  if (params?.severity && params.severity !== "ALL") {
    filtered = filtered.filter((e) => e.severity === params.severity);
  }

  if (params?.user && params.user.trim()) {
    const u = params.user.toLowerCase();
    filtered = filtered.filter((e) => e.userValue && e.userValue.toLowerCase().includes(u));
  }

  if (params?.srcIp && params.srcIp.trim()) {
    filtered = filtered.filter((e) => e.srcIp && e.srcIp.includes(params.srcIp!));
  }

  if (params?.from) {
    filtered = filtered.filter((e) => (e.timestampUtc || e.timestampOriginal || "") >= params.from!);
  }

  if (params?.to) {
    filtered = filtered.filter((e) => (e.timestampUtc || e.timestampOriginal || "") <= params.to!);
  }

  // Sort chronologically
  filtered.sort((a, b) => {
    const tA = a.timestampUtc || a.timestampOriginal || "";
    const tB = b.timestampUtc || b.timestampOriginal || "";
    if (tA === tB) {
      return a.eventId.localeCompare(b.eventId);
    }
    return tA.localeCompare(tB);
  });

  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const items: TimelineItem[] = slice.map((e) => ({
    eventId: e.eventId,
    caseId: e.caseId,
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

  return Promise.resolve({
    items,
    total,
    page,
    pageSize,
    totalPages,
  });
}

