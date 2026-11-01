import { FIXTURE_INVESTIGATIONS } from "@/fixtures/investigations";
import { Investigation } from "@/types/investigation";

export async function getInvestigations(caseId?: string): Promise<Investigation[]> {
  if (caseId) {
    return Promise.resolve(FIXTURE_INVESTIGATIONS.filter((i) => i.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_INVESTIGATIONS]);
}

export async function getInvestigationById(investigationId: string): Promise<Investigation | null> {
  const found = FIXTURE_INVESTIGATIONS.find((i) => i.investigationId === investigationId);
  return Promise.resolve(found ? { ...found } : null);
}

