import { FIXTURE_LEGAL } from "@/fixtures/legal";
import { LegalProvision } from "@/types/legal";

export async function getLegalProvisions(): Promise<LegalProvision[]> {
  return Promise.resolve([...FIXTURE_LEGAL]);
}

export async function getLegalProvisionById(provisionId: string): Promise<LegalProvision | null> {
  const found = FIXTURE_LEGAL.find((l) => l.provisionId === provisionId);
  return Promise.resolve(found ? { ...found } : null);
}

