/**
 * Retrieval Service for ForensicLens.
 *
 * Provides typed API client integration for:
 * - GET  /api/cases/{caseId}/retrieval/status
 * - POST /api/cases/{caseId}/retrieval/index
 * - POST /api/cases/{caseId}/retrieval/search
 *
 * In fixture mode (!isApiMode), retrieval and indexing are explicitly disabled
 * to prevent generating artificial RRF or reranking scores that mislead forensic investigators.
 */

import { apiClient, resolveApiMode } from "./apiClient.ts";
import type {
  RetrievalIndexRequest,
  RetrievalIndexResponse,
  RetrievalMode,
  RetrievalSearchRequest,
  RetrievalSearchResponse,
  RetrievalStatusResponse,
} from "../types/retrieval.ts";

export interface RetrievalServiceOptions {
  apiMode?: boolean;
}

export async function getRetrievalStatus(
  caseId: string,
  options?: RetrievalServiceOptions
): Promise<RetrievalStatusResponse> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (activeApiMode) {
    return await apiClient.get<RetrievalStatusResponse>(
      `/api/cases/${encodeURIComponent(caseId)}/retrieval/status`
    );
  }

  // Explicit fixture mode state: do not fabricate index readiness or model availability
  return {
    caseId,
    totalRecords: 0,
    indexedRecords: 0,
    isIndexed: false,
    indexStatus: "FIXTURE_MODE",
    embeddingModel: "Disabled (Fixture Mode)",
    rerankerModel: "Disabled (Fixture Mode)",
    embeddingModelReady: false,
    rerankerModelReady: false,
    offlineMode: true,
    lastIndexedAt: null,
  };
}

export async function indexCase(
  caseId: string,
  request?: RetrievalIndexRequest,
  options?: RetrievalServiceOptions
): Promise<RetrievalIndexResponse> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    throw new Error(
      "Vector indexing is unavailable in fixture mode. Connect to a live backend API (VITE_DATA_MODE=api) to generate embeddings and index forensic records."
    );
  }

  const payload = {
    rebuild: request?.rebuild ?? false,
    batchSize: request?.batchSize ?? 32,
  };

  return await apiClient.post<RetrievalIndexResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/retrieval/index`,
    payload
  );
}

export async function searchCaseEvidence(
  caseId: string,
  request: RetrievalSearchRequest,
  options?: RetrievalServiceOptions
): Promise<RetrievalSearchResponse> {
  const activeApiMode = resolveApiMode(options?.apiMode);

  if (!activeApiMode) {
    throw new Error(
      "Forensic retrieval search is disabled in fixture mode. Hybrid retrieval requires a live backend API (VITE_DATA_MODE=api) with SQLite FTS5 lexical search, ChromaDB vector retrieval, and cross-encoder reranking."
    );
  }

  const topK = request.topK ?? 10;
  const mode: RetrievalMode = request.mode ?? "HYBRID";

  const payload: Record<string, unknown> = {
    query: request.query,
    topK,
    mode,
  };

  if (request.lexicalCandidates != null) {
    payload.lexicalCandidates = request.lexicalCandidates;
  }
  if (request.semanticCandidates != null) {
    payload.semanticCandidates = request.semanticCandidates;
  }
  if (request.rerankCandidates != null) {
    payload.rerankCandidates = request.rerankCandidates;
  }

  if (request.filters) {
    const cleanFilters: Record<string, unknown> = {};
    const f = request.filters;

    if (f.eventType && f.eventType !== "ALL") {
      cleanFilters.eventType = f.eventType;
    }
    if (f.severity && f.severity !== "ALL") {
      cleanFilters.severity = f.severity;
    }
    if (f.user && f.user.trim()) {
      cleanFilters.user = f.user.trim();
    }
    if (f.srcIp && f.srcIp.trim()) {
      cleanFilters.srcIp = f.srcIp.trim();
    }
    if (f.fromTime && f.fromTime.trim()) {
      cleanFilters.fromTime = f.fromTime.trim();
    }
    if (f.toTime && f.toTime.trim()) {
      cleanFilters.toTime = f.toTime.trim();
    }
    if (f.evidenceId && f.evidenceId.trim()) {
      cleanFilters.evidenceId = f.evidenceId.trim();
    }

    if (Object.keys(cleanFilters).length > 0) {
      payload.filters = cleanFilters;
    }
  }

  return await apiClient.post<RetrievalSearchResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/retrieval/search`,
    payload
  );
}
