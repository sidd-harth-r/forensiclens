import { Investigation } from "@/types/investigation";

export const FIXTURE_INVESTIGATIONS: Investigation[] = [
  {
    investigationId: "INV-2026-001",
    caseId: "CASE-001",
    title: "Inbound SSH Credential Stuffing & Burst Activity",
    query: "Identify public IP addresses conducting brute-force authentication against port 22 between 10:00 and 11:00 UTC",
    privacyLevel: "L2",
    status: "COMPLETED",
    createdAt: "2026-01-15T10:30:00Z",
    completedAt: "2026-01-15T10:30:45Z",
    retrievedEvidenceCount: 3,
    claimsCount: 3,
    leadAnalyst: "S. Rao",
  },
  {
    investigationId: "INV-2026-002",
    caseId: "CASE-001",
    title: "Service Account Public-Key Verification",
    query: "Verify whether deploy_svc authentication originated from authorized CIDR 10.0.12.0/24 with valid ED25519 key",
    privacyLevel: "L2",
    status: "COMPLETED",
    createdAt: "2026-01-15T10:35:00Z",
    completedAt: "2026-01-15T10:35:30Z",
    retrievedEvidenceCount: 2,
    claimsCount: 2,
    leadAnalyst: "S. Rao",
  },
  {
    investigationId: "INV-2026-003",
    caseId: "CASE-002",
    title: "SQL Injection Probe Analysis",
    query: "Identify URI patterns matching UNION SELECT and stacked queries across HTTP access logs",
    privacyLevel: "L3",
    status: "IN_PROGRESS",
    createdAt: "2026-01-14T12:00:00Z",
    retrievedEvidenceCount: 1,
    claimsCount: 0,
    leadAnalyst: "A. Verma",
  },
];

