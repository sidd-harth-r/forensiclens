export type CaseStatus = "OPEN" | "CLOSED" | "ARCHIVED";

export interface Case {
  caseId: string;
  name: string;
  description: string;
  status: CaseStatus;
  evidenceCount: number;
  eventsCount: number;
  investigationsCount: number;
  findingsCount: number;
  lastActivity: string;
  createdAt: string;
  leadInvestigator: string;
}

