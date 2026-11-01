import { FIXTURE_EVIDENCE } from "@/fixtures/evidence";
import { EvidenceFile, ProcessEvidenceResult } from "@/types/evidence";
import { apiClient, isApiMode, ApiError } from "@/services/apiClient";

export async function getEvidenceFiles(caseId?: string): Promise<EvidenceFile[]> {
  if (isApiMode) {
    if (!caseId) {
      return [];
    }
    return await apiClient.get<EvidenceFile[]>(
      `/api/cases/${encodeURIComponent(caseId)}/evidence`
    );
  }

  if (caseId) {
    return Promise.resolve(FIXTURE_EVIDENCE.filter((e) => e.caseId === caseId));
  }
  return Promise.resolve([...FIXTURE_EVIDENCE]);
}

export async function getEvidenceById(
  caseId: string,
  evidenceId: string
): Promise<EvidenceFile | null> {
  if (isApiMode) {
    try {
      return await apiClient.get<EvidenceFile>(
        `/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const found = FIXTURE_EVIDENCE.find(
    (e) => e.evidenceId === evidenceId && (!caseId || e.caseId === caseId)
  );
  return Promise.resolve(found ? { ...found } : null);
}

export async function uploadEvidence(
  caseId: string,
  file: File,
  formatName?: string
): Promise<EvidenceFile> {
  if (isApiMode) {
    const formData = new FormData();
    formData.append("file", file);
    if (formatName) {
      formData.append("format_name", formatName);
    }
    return await apiClient.postFormData<EvidenceFile>(
      `/api/cases/${encodeURIComponent(caseId)}/evidence`,
      formData
    );
  }

  const mockEvidence: EvidenceFile = {
    evidenceId: `EV_${Math.random().toString(16).substring(2, 10).toUpperCase()}`,
    caseId,
    originalName: file.name,
    mediaType: file.type || "text/plain",
    format: "OPENSSH",
    objectHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    objectSizeBytes: file.size,
    parserStatus: "PENDING",
    totalLines: 10,
    parsedLines: 0,
    hashVerifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  FIXTURE_EVIDENCE.unshift(mockEvidence);
  return Promise.resolve(mockEvidence);
}

export async function processEvidence(
  caseId: string,
  evidenceId: string,
  parserName?: string
): Promise<ProcessEvidenceResult> {
  if (isApiMode) {
    return await apiClient.post<ProcessEvidenceResult>(
      `/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}/process`,
      parserName ? { parserName } : undefined
    );
  }

  // Fixture Mode implementation
  const target = FIXTURE_EVIDENCE.find((e) => e.evidenceId === evidenceId);
  if (!target) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  if (target.parserStatus === "PARSED") {
    throw new Error(`Evidence ${evidenceId} has already been processed.`);
  }

  target.parserStatus = "PARSED";
  target.totalLines = 10;
  target.parsedLines = 10;

  return Promise.resolve({
    caseId,
    evidenceId,
    parserName: parserName || "openssh",
    parserVersion: "1.0.0",
    rawRecordsCount: 10,
    eventsCount: 10,
    unparsedRecordsCount: 0,
    status: "PARSED",
    errorSummary: null,
  });
}
