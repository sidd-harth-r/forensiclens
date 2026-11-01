import { EventSeverity } from "./event";

export interface SessionEvent {
  eventId: string;
  timestamp?: string | null;
  timestampOriginal?: string | null;
  eventType: string;
  severity: EventSeverity;
  summary: string;
  user?: string | null;
  srcIp?: string | null;
  srcPort?: number | null;
  host?: string | null;
  process?: string | null;
  pid?: number | null;
  recordNo?: number | null;
  evidenceId?: string | null;
  evidenceOriginalName?: string | null;
  lineNumber?: number | null;
  byteStart?: number | null;
  byteEnd?: number | null;
  eventHash: string;
  rawRecordId?: string | null;
}

export type SessionStatus = "CLOSED" | "OPEN" | "INCOMPLETE";

export interface ForensicSession {
  sessionId: string;
  caseId: string;
  user?: string | null;
  srcIp?: string | null;
  host?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationSeconds: number;
  eventCount: number;
  status: SessionStatus;
  correlationBasis: string[];
  events: SessionEvent[];
}

export interface SessionQueryParams {
  page?: number;
  pageSize?: number;
  user?: string;
  srcIp?: string;
  status?: string;
  from?: string;
  to?: string;
  gapSeconds?: number;
}

export interface PaginatedSessions {
  items: ForensicSession[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

