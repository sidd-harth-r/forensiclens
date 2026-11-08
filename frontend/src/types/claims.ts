/**
 * Types for ForensicLens Claim Extraction and Deterministic Claim Verification.
 *
 * Adheres strictly to backend Pydantic schemas in backend/app/verification/schemas.py.
 */

export type VerificationStatus =
  | "SUPPORTED"
  | "CONTRADICTED"
  | "UNVERIFIED"
  | "INSUFFICIENT_EVIDENCE";

export type ClaimType =
  | "AUTH_SUCCESS"
  | "AUTH_FAILURE"
  | "SESSION_START"
  | "SESSION_END"
  | "SESSION_ACTIVITY"
  | "NETWORK_CONNECTION"
  | "FILE_ACCESS"
  | "ACCOUNT_MODIFICATION"
  | "PROCESS_EXECUTION"
  | "GENERIC_FORENSIC_EVENT";

export type EvidenceRole =
  | "PRIMARY_CITING"
  | "SUPPORTING"
  | "CONTRADICTING"
  | "CORRELATED"
  | "CONTEXT";

export type ExtractionMethod =
  | "DETERMINISTIC_FAKE"
  | "RULE_BASED"
  | "LLM_ASSISTED"
  | "SYNTHETIC_TEST"
  | "LEGACY";

export interface EvidenceReference {
  claimEvidenceId?: string | null;
  claimId?: string | null;
  evidenceId: string;
  rawRecordId?: string | null;
  eventId?: string | null;
  role: EvidenceRole;
  recordNo?: number | null;
  lineNumber?: number | null;
  byteStart?: number | null;
  byteEnd?: number | null;
  snippet?: string | null;
  relevanceScore?: number | null;
  createdAt?: string | null;
}

export interface Claim {
  claimId: string;
  caseId: string;
  investigationId?: string | null;
  claimType: ClaimType;
  statement: string;
  subject?: string | null;
  action: string;
  object?: string | null;
  sourceIp?: string | null;
  destinationIp?: string | null;
  sourcePort?: number | null;
  timestampClaimed?: string | null;
  timeRangeStart?: string | null;
  timeRangeEnd?: string | null;
  attributes: Record<string, unknown>;
  modelOutputJson?: string | null;
  extractionMethod: ExtractionMethod;
  compilerVersion?: string | null;
  confidence?: number | null;
  evidenceReferences: EvidenceReference[];
  currentStatus: VerificationStatus;
  createdAt: string;
}

export interface ClaimVerificationResult {
  verificationId: string;
  claimId: string;
  status: VerificationStatus;
  ruleId: string;
  ruleVersion: string;
  predicateType: string;
  resolvedParameters: Record<string, unknown>;
  matchedRowCount: number;
  evidenceRefs: string[];
  supportingRecords: Record<string, unknown>[];
  contradictingRecords: Record<string, unknown>[];
  explanation?: string | null;
  failureReason?: string | null;
  discrepancies: string[];
  verifierVersion: string;
  verifiedAt: string;
}

export interface ClaimExtractionRequest {
  query: string;
  retrievalMode?: string;
  retrievalLimit?: number;
  investigationId?: string | null;
}

export interface ClaimExtractionResponse {
  caseId: string;
  query: string;
  extractedClaims: Claim[];
  evidenceRetrievedCount: number;
  extractionMethod: ExtractionMethod;
  modelIdentifier?: string | null;
  warnings: string[];
  omittedEvidenceCount: number;
  truncatedEvidenceCount: number;
}

export interface ClaimVerificationRequest {
  claimIds?: string[];
  forceReverify?: boolean;
}

export interface ClaimVerificationResponse {
  caseId: string;
  verifiedCount: number;
  summary: Record<string, number>;
  results: ClaimVerificationResult[];
}

export interface ClaimListResponse {
  caseId: string;
  total: number;
  claims: Claim[];
  summary: Record<string, number>;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ClaimFilters {
  claimType?: ClaimType | "ALL";
  status?: VerificationStatus | "ALL";
  page?: number;
  pageSize?: number;
}
