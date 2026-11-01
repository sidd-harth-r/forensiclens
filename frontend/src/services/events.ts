import { FIXTURE_EVENTS } from "@/fixtures/events";
import { EventQueryParams, ForensicEvent, PaginatedEvents } from "@/types/event";
import { apiClient, isApiMode, ApiError } from "@/services/apiClient";

export async function getEvents(
  caseId?: string,
  params?: EventQueryParams
): Promise<PaginatedEvents> {
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
    if (params?.search) query.search = params.search;
    if (params?.eventType && params.eventType !== "ALL") query.event_type = params.eventType;
    if (params?.severity && params.severity !== "ALL") query.severity = params.severity;
    if (params?.from) query.from = params.from;
    if (params?.to) query.to = params.to;

    return await apiClient.get<PaginatedEvents>(
      `/api/cases/${encodeURIComponent(caseId)}/events`,
      query
    );
  }

  // Fixture Mode implementation: filter and paginate in-memory
  let filtered = FIXTURE_EVENTS;
  if (caseId) {
    filtered = filtered.filter((e) => e.caseId === caseId);
  }

  if (params?.eventType && params.eventType !== "ALL") {
    filtered = filtered.filter((e) => e.eventType === params.eventType);
  }

  if (params?.severity && params.severity !== "ALL") {
    filtered = filtered.filter((e) => e.severity === params.severity);
  }

  if (params?.search && params.search.trim()) {
    const term = params.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.eventId.toLowerCase().includes(term) ||
        e.message.toLowerCase().includes(term) ||
        (e.userValue && e.userValue.toLowerCase().includes(term)) ||
        (e.srcIp && e.srcIp.includes(term)) ||
        e.eventType.toLowerCase().includes(term)
    );
  }

  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return Promise.resolve({
    items,
    total,
    page,
    pageSize,
    totalPages,
  });
}

export async function getEventById(
  caseId: string,
  eventId: string
): Promise<ForensicEvent | null> {
  if (isApiMode) {
    try {
      return await apiClient.get<ForensicEvent>(
        `/api/cases/${encodeURIComponent(caseId)}/events/${encodeURIComponent(eventId)}`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const found = FIXTURE_EVENTS.find(
    (e) => e.eventId === eventId && (!caseId || e.caseId === caseId)
  );
  return Promise.resolve(found ? { ...found } : null);
}
