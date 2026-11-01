export type EvidenceFormat = "OPENSSH" | "SYSLOG" | "APACHE" | "EVTX" | "PCAP" | "GENERIC";

export type EvidenceParserStatus = "PENDING" | "PARSED" | "PARTIAL" | "FAILED";

export interface EvidenceFile {
  evidenceId: string;
  caseId: string;
  originalName: string;
  mediaType: string;
  format: EvidenceFormat;
  objectHash: string;
  objectSizeBytes: number;
  parserStatus: EvidenceParserStatus;
  totalLines?: number;
  parsedLines?: number;
  hashVerifiedAt?: string;
  createdAt: string;
  storagePath?: string;
}

