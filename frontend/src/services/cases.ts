import { FIXTURE_CASES } from "@/fixtures/cases";
import { Case } from "@/types/case";

export async function getCases(): Promise<Case[]> {
  // Simulating async abstraction layer over fixture data
  return Promise.resolve([...FIXTURE_CASES]);
}

export async function getCaseById(caseId: string): Promise<Case | null> {
  const found = FIXTURE_CASES.find((c) => c.caseId === caseId);
  return Promise.resolve(found ? { ...found } : null);
}

