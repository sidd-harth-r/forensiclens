export interface AuditRecord {
  auditId: string;
  caseId: string;
  sequenceNo: number;
  eventType: string;
  actorId: string;
  objectType: string;
  objectId: string;
  recordHash: string;
  prevHash: string | null;
  createdAt: string;
  metadataJson: string;
}

export interface AuditChainIntegrity {
  caseId: string;
  totalRecords: number;
  chainValid: boolean;
  genesisHash: string;
  headHash: string;
  verifiedAt: string;
}

