export type EventSeverity = "INFO" | "WARNING" | "CRITICAL";

export type IpScope = "PUBLIC" | "PRIVATE" | "LOOPBACK" | "LINK_LOCAL" | "UNKNOWN";

export type EventParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";

export interface ForensicEvent {
  eventId: string;
  caseId: string;
  evidenceId: string;
  rawRecordId?: string | null;
  timestampUtc?: string | null;
  timestampOriginal?: string | null;
  timestampConfidence?: "EXACT" | "INFERRED_YEAR" | "INFERRED_TZ" | null;
  tzAssumed?: string | null;
  source: string;
  host?: string | null;
  eventType: string;
  severity: EventSeverity;
  userValue?: string | null;
  srcIp?: string | null;
  srcIpScope?: IpScope | null;
  srcPort?: number | null;
  process?: string | null;
  pid?: number | null;
  commandValue?: string | null;
  resource?: string | null;
  message: string;
  parseStatus: EventParseStatus;
  sourceFileName?: string | null;
  lineNumber?: number | null;
  byteStart?: number | null;
  byteEnd?: number | null;
  eventHash: string;
  createdAt: string;
  // Provenance & Detail extensions
  rawText?: string | null;
  evidenceOriginalName?: string | null;
  evidenceFormat?: string | null;
  recordNo?: number | null;
  parseError?: string | null;
}

export interface EventQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  eventType?: string;
  severity?: string;
  user?: string;
  srcIp?: string;
  from?: string;
  to?: string;
}

export interface PaginatedEvents {
  items: ForensicEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

