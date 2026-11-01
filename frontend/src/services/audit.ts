import { FIXTURE_AUDIT_INTEGRITY, FIXTURE_AUDIT_RECORDS } from "@/fixtures/audit";
import { AuditChainIntegrity, AuditRecord } from "@/types/audit";

export async function getAuditRecords(caseId?: string): Promise<AuditRecord[]> {
  if (caseId) {
    return Promise.resolve(FIXTURE_AUDIT_RECORDS.filter((a) => a.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_AUDIT_RECORDS]);
}

export async function getAuditIntegrity(_caseId?: string): Promise<AuditChainIntegrity> {
  return Promise.resolve({ ...FIXTURE_AUDIT_INTEGRITY });
}

