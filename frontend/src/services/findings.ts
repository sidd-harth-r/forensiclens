import { FIXTURE_FINDINGS } from "@/fixtures/findings";
import { ClaimFinding } from "@/types/finding";

export async function getFindings(caseId?: string): Promise<ClaimFinding[]> {
  if (caseId) {
    return Promise.resolve(FIXTURE_FINDINGS.filter((f) => f.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_FINDINGS]);
}

export async function getFindingById(claimId: string): Promise<ClaimFinding | null> {
  const found = FIXTURE_FINDINGS.find((f) => f.claimId === claimId);
  return Promise.resolve(found ? { ...found } : null);
}

