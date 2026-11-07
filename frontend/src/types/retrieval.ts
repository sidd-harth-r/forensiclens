/**
 * Types for the ForensicLens Hybrid Forensic Retrieval Engine.
 *
 * Adheres strictly to backend Pydantic schemas in backend/app/retrieval/schemas.py.
 */

export type RetrievalMode =
  | "KEYWORD_ONLY"
  | "SEMANTIC_ONLY"
  | "HYBRID"
  | "HYBRID_RERANKED";

export interface RetrievalFilters {
  eventType?: string;
  severity?: string;
  user?: string;
  srcIp?: string;
  fromTime?: string;
  toTime?: string;
  evidenceId?: string;
}

export interface RetrievalSearchRequest {
  query: string;
  topK?: number;
  lexicalCandidates?: number;
  semanticCandidates?: number;
  rerankCandidates?: number;
  mode?: RetrievalMode;
  filters?: RetrievalFilters;
}

export interface RetrievalResultItem {
  documentId: string;
  rawRecordId: string;
  eventId?: string | null;
  evidenceId: string;
  originalFilename: string;
  recordNo: number;
  lineNumber?: number | null;
  byteStart?: number | null;
  byteEnd?: number | null;
  text: string;
  timestamp?: string | null;
  eventType?: string | null;
  severity?: string | null;
  user?: string | null;
  srcIp?: string | null;
  lexicalRank?: number | null;
  semanticRank?: number | null;
  rrfScore?: number | null;
  rerankScore?: number | null;
  finalRank: number;
}

export interface RetrievalSearchResponse {
  items: RetrievalResultItem[];
  total: number;
  retrievalMode: RetrievalMode;
  query: string;
  caseId: string;
}

export interface RetrievalIndexRequest {
  rebuild?: boolean;
  batchSize?: number;
}

export interface RetrievalIndexResponse {
  caseId: string;
  indexedCount: number;
  totalIndexed: number;
  status: string;
  message: string;
}

export interface RetrievalStatusResponse {
  caseId: string;
  totalRecords: number;
  indexedRecords: number;
  isIndexed: boolean;
  indexStatus: "READY" | "UNINDEXED" | "EMPTY" | "STALE" | "PARTIAL" | string;
  embeddingModel: string;
  rerankerModel: string;
  embeddingModelReady: boolean;
  rerankerModelReady: boolean;
  offlineMode: boolean;
  lastIndexedAt?: string | null;
}

