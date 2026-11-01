import { EventSeverity } from "./event";

export interface TimelineItem {
  eventId: string;
  caseId: string;
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

export interface TimelineQueryParams {
  page?: number;
  pageSize?: number;
  eventType?: string;
  severity?: string;
  user?: string;
  srcIp?: string;
  from?: string;
  to?: string;
}

export interface PaginatedTimeline {
  items: TimelineItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

