export type EvidenceFormat = "OPENSSH" | "SYSLOG" | "APACHE" | "EVTX" | "PCAP" | "GENERIC";

export type EvidenceParserStatus =
  | "PENDING"
  | "PROCESSING"
  | "PARSED"
  | "PARTIAL"
  | "UNSUPPORTED"
  | "FAILED";

export interface EvidenceFile {
  evidenceId: string;
  caseId: string;
  originalName: string;
  mediaType?: string | null;
  format: EvidenceFormat;
  objectHash: string;
  objectSizeBytes: number;
  parserStatus: EvidenceParserStatus;
  totalLines?: number | null;
  parsedLines?: number | null;
  hashVerifiedAt?: string | null;
  createdAt: string;
  storagePath?: string | null;
}

export interface ProcessEvidenceResult {
  caseId: string;
  evidenceId: string;
  parserName: string;
  parserVersion?: string | null;
  rawRecordsCount: number;
  eventsCount: number;
  unparsedRecordsCount: number;
  status: EvidenceParserStatus;
  errorSummary?: string | null;
}
