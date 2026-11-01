export type PrivacyLevel = "L0" | "L1" | "L2" | "L3";

export type InvestigationStatus = "COMPLETED" | "IN_PROGRESS" | "FAILED";

export interface Investigation {
  investigationId: string;
  caseId: string;
  title: string;
  query: string;
  privacyLevel: PrivacyLevel;
  status: InvestigationStatus;
  createdAt: string;
  completedAt?: string;
  retrievedEvidenceCount: number;
  claimsCount: number;
  leadAnalyst: string;
}

