import { FIXTURE_CASES } from "@/fixtures/cases";
import { Case } from "@/types/case";
import { apiClient, isApiMode, ApiError } from "@/services/apiClient";

export interface CreateCasePayload {
  caseId?: string;
  name: string;
  description?: string;
  leadInvestigator?: string;
}

export async function getCases(): Promise<Case[]> {
  if (isApiMode) {
    return await apiClient.get<Case[]>("/api/cases");
  }
  return Promise.resolve([...FIXTURE_CASES]);
}

export async function getCaseById(caseId: string): Promise<Case | null> {
  if (isApiMode) {
    try {
      return await apiClient.get<Case>(`/api/cases/${encodeURIComponent(caseId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }
  const found = FIXTURE_CASES.find((c) => c.caseId === caseId);
  return Promise.resolve(found ? { ...found } : null);
}

export async function createCase(payload: CreateCasePayload): Promise<Case> {
  if (isApiMode) {
    return await apiClient.post<Case>("/api/cases", payload);
  }

  const newCase: Case = {
    caseId: payload.caseId || `CASE-${String(FIXTURE_CASES.length + 1).padStart(3, "0")}`,
    name: payload.name,
    description: payload.description || "",
    status: "OPEN",
    evidenceCount: 0,
    eventsCount: 0,
    investigationsCount: 0,
    findingsCount: 0,
    lastActivity: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    leadInvestigator: payload.leadInvestigator || "Lead Analyst",
  };
  FIXTURE_CASES.unshift(newCase);
  return Promise.resolve({ ...newCase });
}
