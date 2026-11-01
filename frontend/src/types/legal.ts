export type LegalStatus = "IN_FORCE" | "REPEALED" | "STRUCK_DOWN" | "SUPERSEDED";

export interface LegalElement {
  elementId: string;
  name: string;
  description: string;
  covered: boolean;
  notes?: string;
}

export interface LegalProvision {
  provisionId: string;
  act: string;
  section: string;
  title: string;
  description: string;
  legalStatus: LegalStatus;
  relevanceScore: number; // 0 to 1
  coverageSummary: string;
  elements: LegalElement[];
  caveatNotes: string;
  lastReviewed: string;
}

