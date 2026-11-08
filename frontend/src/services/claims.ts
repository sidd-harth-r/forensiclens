/**
 * Claim Verification Service for ForensicLens.
 *
 * Provides typed API client integration for:
 * - POST /api/cases/{caseId}/claims/extract
 * - GET  /api/cases/{caseId}/claims
 * - POST /api/cases/{caseId}/claims/{claimId}/verify
 * - GET  /api/cases/{caseId}/claims/{claimId}/history
 *
 * In fixture mode (!isApiMode), claim extraction and verification are disabled
 * to prevent fabricating forensic conclusions, citations, or verification outcomes.
 */

import { apiClient, resolveApiMode } from "./apiClient.ts";
import type {
  ClaimExtractionRequest,
  ClaimExtractionResponse,
  ClaimFilters,
  ClaimListResponse,
  ClaimVerificationResult,
} from "../types/claims.ts";

export interface ClaimsServiceOptions {
  apiMode?: boolean;
}

/**
 * Retrieve evidence and extract grounded atomic claims for a case.
 */
export async function extractClaims(
  caseId: string,
  request: ClaimExtractionRequest,
  options?: ClaimsServiceOptions
): Promise<ClaimExtractionResponse> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    throw new Error(
      "Claim extraction is disabled in fixture mode. Grounded claim extraction requires a live backend API (VITE_DATA_MODE=api) with retrieval and LLM provider services."
    );
  }

  const payload: Record<string, unknown> = {
    query: request.query,
    retrievalMode: request.retrievalMode ?? "HYBRID",
    retrievalLimit: request.retrievalLimit ?? 20,
  };

  if (request.investigationId) {
    payload.investigationId = request.investigationId;
  }

  return await apiClient.post<ClaimExtractionResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/claims/extract`,
    payload
  );
}

/**
 * List paginated claims for a case with filtering and status summary counts.
 */
export async function getCaseClaims(
  caseId: string,
  filters?: ClaimFilters,
  options?: ClaimsServiceOptions
): Promise<ClaimListResponse> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    // Explicit fixture mode state: return zero claims, zero fabricated citations
    return {
      caseId,
      total: 0,
      claims: [],
      summary: {
        SUPPORTED: 0,
        CONTRADICTED: 0,
        UNVERIFIED: 0,
        INSUFFICIENT_EVIDENCE: 0,
      },
      page: 1,
      pageSize: filters?.pageSize ?? 50,
      totalPages: 1,
    };
  }

  const queryParams = new URLSearchParams();

  if (filters?.claimType && filters.claimType !== "ALL") {
    queryParams.set("claimType", filters.claimType);
  }

  if (filters?.status && filters.status !== "ALL") {
    queryParams.set("status", filters.status);
  }

  if (filters?.page !== undefined && filters.page > 0) {
    queryParams.set("page", String(filters.page));
  }

  if (filters?.pageSize !== undefined && filters.pageSize > 0) {
    queryParams.set("pageSize", String(filters.pageSize));
  }

  const queryString = queryParams.toString();
  const endpoint = `/api/cases/${encodeURIComponent(caseId)}/claims${queryString ? `?${queryString}` : ""}`;

  return await apiClient.get<ClaimListResponse>(endpoint);
}

/**
 * Deterministically verify a single claim against immutable case evidence.
 */
export async function verifyClaim(
  caseId: string,
  claimId: string,
  options?: ClaimsServiceOptions
): Promise<ClaimVerificationResult> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    throw new Error(
      "Claim verification is disabled in fixture mode. Deterministic verification requires a live backend API (VITE_DATA_MODE=api) with read-only SQLite database access."
    );
  }

  return await apiClient.post<ClaimVerificationResult>(
    `/api/cases/${encodeURIComponent(caseId)}/claims/${encodeURIComponent(claimId)}/verify`,
    {}
  );
}

/**
 * Retrieve the append-only verification audit history for a single claim.
 */
export async function getClaimHistory(
  caseId: string,
  claimId: string,
  options?: ClaimsServiceOptions
): Promise<ClaimVerificationResult[]> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    return [];
  }

  return await apiClient.get<ClaimVerificationResult[]>(
    `/api/cases/${encodeURIComponent(caseId)}/claims/${encodeURIComponent(claimId)}/history`
  );
}
