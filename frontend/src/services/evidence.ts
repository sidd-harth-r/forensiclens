import { FIXTURE_EVIDENCE } from "@/fixtures/evidence";
import { EvidenceFile } from "@/types/evidence";

export async function getEvidenceFiles(caseId?: string): Promise<EvidenceFile[]> {
  if (caseId) {
    return Promise.resolve(FIXTURE_EVIDENCE.filter((e) => e.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_EVIDENCE]);
}

export async function getEvidenceById(evidenceId: string): Promise<EvidenceFile | null> {
  const found = FIXTURE_EVIDENCE.find((e) => e.evidenceId === evidenceId);
  return Promise.resolve(found ? { ...found } : null);
}

