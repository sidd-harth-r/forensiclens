export type ClaimVerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "CONTRADICTED"
  | "REQUIRES_HUMAN_JUDGMENT";

export interface EvidenceRef {
  evidenceId: string;
  sourceFileName: string;
  lineNumber?: number;
  byteStart?: number;
  byteEnd?: number;
  snippet?: string;
}

export interface ClaimFinding {
  claimId: string;
  caseId: string;
  investigationId: string;
  text: string;
  status: ClaimVerificationStatus;
  confidence: number; // 0 to 1
  predicateName: string;
  predicateVersion: string;
  evidenceRefs: EvidenceRef[];
  humanReviewReason?: string;
  verifiedAt?: string;
  createdAt: string;
}

