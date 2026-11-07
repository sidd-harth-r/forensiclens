import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { RetrievalResultInspectorModal } from "@/components/retrieval/RetrievalResultInspectorModal";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import {
  getRetrievalStatus,
  indexCase,
  searchCaseEvidence,
} from "@/services/retrieval";
import {
  RetrievalMode,
  RetrievalResultItem,
  RetrievalSearchResponse,
  RetrievalStatusResponse,
} from "@/types/retrieval";
import { formatDateTime } from "@/lib/formatters";
import { ApiError, isApiMode } from "@/services/apiClient";
import { DataModeBadge } from "@/components/common/DataModeBadge";
import {
  Search,
  Database,
  Sparkles,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  ShieldAlert,
  FileText,
  Clock,
  Eye,
  Zap,
  RotateCcw,
  Cpu,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

export function RetrievalPage() {
  const { currentCase } = useCase();

  // Index Status State
  const [status, setStatus] = useState<RetrievalStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [indexingAction, setIndexingAction] = useState<"incremental" | "rebuild" | null>(null);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);

  // Search Form State
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RetrievalMode>("HYBRID_RERANKED");
  const [topK, setTopK] = useState(10);
  const [lexicalCandidates, setLexicalCandidates] = useState(50);
  const [semanticCandidates, setSemanticCandidates] = useState(50);
  const [rerankCandidates, setRerankCandidates] = useState(30);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);

  // Metadata Filters State
  const [showFilters, setShowFilters] = useState(false);
  const [filterEventType, setFilterEventType] = useState("ALL");
  const [filterSeverity, setFilterSeverity] = useState("ALL");
  const [filterUser, setFilterUser] = useState("");
  const [filterSrcIp, setFilterSrcIp] = useState("");
  const [filterFromTime, setFilterFromTime] = useState("");
  const [filterToTime, setFilterToTime] = useState("");
  const [filterEvidenceId, setFilterEvidenceId] = useState("");

  // Search Execution & Results State
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<{ message: string; is503: boolean } | null>(null);
  const [searchResponse, setSearchResponse] = useState<RetrievalSearchResponse | null>(null);

  // Inspector Modal State
  const [inspectedItem, setInspectedItem] = useState<RetrievalResultItem | null>(null);
  const [inspectedEventId, setInspectedEventId] = useState<string | null>(null);

  // Load Status
  const loadIndexStatus = useCallback(async () => {
    if (!currentCase?.caseId) {
      setStatus(null);
      return;
    }

    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await getRetrievalStatus(currentCase.caseId);
      setStatus(res);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : "Failed to load retrieval status"
      );
    } finally {
      setStatusLoading(false);
    }
  }, [currentCase?.caseId]);

  useEffect(() => {
    loadIndexStatus();
  }, [loadIndexStatus]);

  // Handle Incremental Indexing
  const handleIndexRecords = async (rebuild = false) => {
    if (!currentCase?.caseId) return;

    if (!isApiMode) {
      toast.error("Vector indexing is unavailable in fixture mode. Live backend API connection required.");
      return;
    }

    setIndexingAction(rebuild ? "rebuild" : "incremental");
    setShowRebuildConfirm(false);
    try {
      const res = await indexCase(currentCase.caseId, { rebuild, batchSize: 32 });
      toast.success(
        rebuild
          ? `Index rebuilt: ${res.totalIndexed} records indexed.`
          : `Indexed ${res.indexedCount} new records (${res.totalIndexed} total).`
      );
      await loadIndexStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Indexing failed";
      toast.error(`Indexing error: ${msg}`);
    } finally {
      setIndexingAction(null);
    }
  };

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterEventType !== "ALL") count++;
    if (filterSeverity !== "ALL") count++;
    if (filterUser.trim()) count++;
    if (filterSrcIp.trim()) count++;
    if (filterFromTime.trim()) count++;
    if (filterToTime.trim()) count++;
    if (filterEvidenceId.trim()) count++;
    return count;
  }, [
    filterEventType,
    filterSeverity,
    filterUser,
    filterSrcIp,
    filterFromTime,
    filterToTime,
    filterEvidenceId,
  ]);

  const handleResetFilters = () => {
    setFilterEventType("ALL");
    setFilterSeverity("ALL");
    setFilterUser("");
    setFilterSrcIp("");
    setFilterFromTime("");
    setFilterToTime("");
    setFilterEvidenceId("");
  };

  // Execute Search
  const executeSearch = useCallback(
    async (overrideMode?: RetrievalMode) => {
      if (!currentCase?.caseId) {
        toast.error("Please select a forensic case first");
        return;
      }

      if (!isApiMode) {
        toast.error("Retrieval search is disabled in fixture mode. Live backend API required.");
        setSearchError({
          message: "Forensic retrieval search is disabled in fixture mode. Hybrid retrieval requires a live backend API connection (VITE_DATA_MODE=api) with SQLite FTS5 lexical matching, ChromaDB vector retrieval, and cross-encoder reranking.",
          is503: false,
        });
        return;
      }

      const q = query.trim();
      if (!q) {
        toast.error("Please enter a search query");
        return;
      }

      const targetMode = overrideMode || mode;

      setSearchLoading(true);
      setSearchError(null);

      try {
        const filtersPayload =
          activeFiltersCount > 0
            ? {
                eventType: filterEventType !== "ALL" ? filterEventType : undefined,
                severity: filterSeverity !== "ALL" ? filterSeverity : undefined,
                user: filterUser.trim() || undefined,
                srcIp: filterSrcIp.trim() || undefined,
                fromTime: filterFromTime.trim() || undefined,
                toTime: filterToTime.trim() || undefined,
                evidenceId: filterEvidenceId.trim() || undefined,
              }
            : undefined;

        const res = await searchCaseEvidence(currentCase.caseId, {
          query: q,
          topK,
          mode: targetMode,
          lexicalCandidates,
          semanticCandidates,
          rerankCandidates,
          filters: filtersPayload,
        });

        setSearchResponse(res);
      } catch (err) {
        const is503 = err instanceof ApiError && err.status === 503;
        const msg = err instanceof Error ? err.message : "Search query failed";
        setSearchError({ message: msg, is503 });
      } finally {
        setSearchLoading(false);
      }
    },
    [
      currentCase?.caseId,
      query,
      mode,
      topK,
      lexicalCandidates,
      semanticCandidates,
      rerankCandidates,
      activeFiltersCount,
      filterEventType,
      filterSeverity,
      filterUser,
      filterSrcIp,
      filterFromTime,
      filterToTime,
      filterEvidenceId,
    ]
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch();
  };

  const getStatusBadgeVariant = (s?: string) => {
    switch (s) {
      case "READY":
        return "verified";
      case "FIXTURE_MODE":
      case "PARTIAL":
      case "STALE":
      case "UNINDEXED":
        return "warning";
      case "EMPTY":
      default:
        return "neutral";
    }
  };

  const getSeverityBadgeVariant = (severity?: string | null) => {
    switch (severity?.toUpperCase()) {
      case "CRITICAL":
        return "danger";
      case "WARNING":
        return "warning";
      case "INFO":
      default:
        return "default";
    }
  };

  if (!currentCase) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Hybrid Retrieval Explorer"
          description="Case-isolated multi-stage evidence retrieval combining SQLite FTS5, BGE dense embeddings, Reciprocal Rank Fusion, and Cross-Encoder reranking."
        />
        <EmptyState
          icon={<Database className="w-8 h-8 text-text-disabled" />}
          title="No Forensic Case Selected"
          description="Select an active case from the top navigation or case selector to inspect index status and search retrieved evidence records."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hybrid Retrieval Explorer"
        description="Case-isolated multi-stage forensic retrieval engine combining lexical BM25 (SQLite FTS5), local dense semantic search (BGE), Reciprocal Rank Fusion (RRF), and Cross-Encoder reranking."
        actions={<DataModeBadge />}
      />

      {/* Fixture Mode Advisory Banner */}
      {!isApiMode && (
        <Card className="border-amber-300 dark:border-amber-800 bg-amber-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <Database className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold block text-sm text-amber-800 dark:text-amber-300">
                Fixture Mode Active — Forensic Retrieval Engine Requires Live Backend
              </span>
              <p className="mt-0.5 text-xs text-text-secondary">
                ForensicLens is running in mock fixture mode (<code>VITE_DATA_MODE=fixtures</code>).
                Hybrid evidence retrieval, SQLite FTS5 lexical matching, ChromaDB dense embeddings, and cross-encoder reranking operate strictly on real persisted forensic data.
                Synthetic retrieval scores are explicitly disabled in fixture mode to prevent misrepresenting evidence.
              </p>
              <p className="mt-1 font-mono text-[11px] text-text-muted">
                To execute live hybrid retrieval, connect to the FastAPI backend with <code>VITE_DATA_MODE=api</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Index Status & Model Readiness Control Card */}
      <Card>
        <CardHeader className="pb-3 border-b border-border-subtle">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-accent" />
              <CardTitle className="text-sm font-semibold">
                Vector Index & Local Model Readiness
              </CardTitle>
              {status && (
                <Badge variant={getStatusBadgeVariant(status.indexStatus)}>
                  {status.indexStatus}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadIndexStatus}
                disabled={statusLoading || indexingAction !== null}
                className="gap-1 h-7 text-xs"
              >
                <RefreshCw
                  className={`w-3 h-3 ${statusLoading ? "animate-spin text-accent" : ""}`}
                />
                <span>Refresh</span>
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={() => handleIndexRecords(false)}
                disabled={!isApiMode || indexingAction !== null || statusLoading}
                title={!isApiMode ? "Vector indexing requires live backend API mode" : undefined}
                className="gap-1.5 h-7 text-xs"
              >
                {indexingAction === "incremental" ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                <span>Index New Records</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRebuildConfirm(true)}
                disabled={!isApiMode || indexingAction !== null || statusLoading}
                title={!isApiMode ? "Index rebuild requires live backend API mode" : undefined}
                className="gap-1 h-7 text-xs text-status-warning hover:text-status-warning border-status-warning/40"
              >
                {indexingAction === "rebuild" ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                <span>Rebuild Index</span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {statusLoading && !status && (
            <LoadingState message="Checking vector index and model readiness..." />
          )}

          {statusError && (
            <div className="p-3 rounded bg-status-danger-bg text-status-danger text-xs border border-red-300 dark:border-red-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to verify index status: {statusError}</span>
            </div>
          )}

          {status && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Indexed Records</span>
                <span className="font-mono font-bold text-sm text-text-primary">
                  {status.indexedRecords} / {status.totalRecords}
                </span>
                <span className="text-[10px] text-text-secondary block mt-0.5">
                  {status.totalRecords > 0
                    ? `${Math.round((status.indexedRecords / status.totalRecords) * 100)}% synchronized`
                    : "No source records"}
                </span>
              </div>

              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Embedding Model</span>
                <span className="font-mono text-xs font-semibold text-text-primary truncate block" title={status.embeddingModel}>
                  {status.embeddingModel.split("/").pop()}
                </span>
                <span className={`text-[10px] font-medium block mt-0.5 ${status.embeddingModelReady ? "text-status-success" : "text-status-warning"}`}>
                  {status.embeddingModelReady ? "● Weights Ready" : "○ Not Loaded"}
                </span>
              </div>

              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Reranker Model</span>
                <span className="font-mono text-xs font-semibold text-text-primary truncate block" title={status.rerankerModel}>
                  {status.rerankerModel.split("/").pop()}
                </span>
                <span className={`text-[10px] font-medium block mt-0.5 ${status.rerankerModelReady ? "text-status-success" : "text-status-warning"}`}>
                  {status.rerankerModelReady ? "● Weights Ready" : "○ Not Loaded"}
                </span>
              </div>

              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Air-Gapped Isolation</span>
                <span className="font-mono text-xs font-bold text-status-success block">
                  {status.offlineMode ? "ENFORCED" : "ONLINE"}
                </span>
                <span className="text-[10px] text-text-muted block mt-0.5">
                  Zero Cloud AI / Section 63 BSA
                </span>
              </div>

              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Collection Scope</span>
                <span className="font-mono text-xs font-semibold text-text-primary truncate block">
                  {status.caseId}
                </span>
                <span className="text-[10px] text-text-muted block mt-0.5">
                  Isolated ChromaDB collection
                </span>
              </div>

              <div className="p-2.5 rounded bg-surface-subtle border border-border">
                <span className="text-[11px] text-text-muted block">Last Indexed</span>
                <span className="font-mono text-xs text-text-secondary truncate block">
                  {status.lastIndexedAt ? formatDateTime(status.lastIndexedAt) : "Never"}
                </span>
                <span className="text-[10px] text-text-muted block mt-0.5">
                  Incremental sync
                </span>
              </div>
            </div>
          )}

          {/* Rebuild Confirmation Banner */}
          {showRebuildConfirm && (
            <div className="mt-3 p-3 rounded-lg border border-status-warning bg-status-warning-bg text-status-warning text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-status-warning" />
                <div>
                  <span className="font-semibold block">Confirm Complete Index Rebuild?</span>
                  <span className="text-[11px] text-text-secondary">
                    This will purge the existing vector collection for case {currentCase.caseId} and re-embed all raw source records from scratch.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowRebuildConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleIndexRecords(true)}
                >
                  Confirm Rebuild
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search Input & Controls Card */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <form onSubmit={handleSearchSubmit} className="space-y-4">
            {/* Primary Query Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter natural-language query or forensic keywords (e.g. 'failed root ssh authentication', 'invalid user admin', '192.168.1.100')..."
                  className="pr-10 h-10 text-xs sm:text-sm"
                  icon={<Search className="w-4 h-4 text-text-muted" />}
                />
              </div>

              <Button
                type="submit"
                disabled={!isApiMode || searchLoading || !query.trim()}
                title={!isApiMode ? "Retrieval search requires live backend API mode" : undefined}
                className="h-10 px-5 gap-2 shrink-0 font-semibold"
              >
                {searchLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Retrieve Evidence</span>
              </Button>
            </div>

            {/* Retrieval Mode & Candidate Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border-subtle">
              {/* Mode Selector Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted font-medium mr-1">Mode:</span>
                {(
                  [
                    { id: "HYBRID_RERANKED", label: "Hybrid + Rerank", icon: Sparkles },
                    { id: "HYBRID", label: "Hybrid (RRF)", icon: Layers },
                    { id: "SEMANTIC_ONLY", label: "Semantic Only", icon: Cpu },
                    { id: "KEYWORD_ONLY", label: "Keyword (FTS5)", icon: FileText },
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  const isSelected = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors font-medium border ${
                        isSelected
                          ? "bg-accent text-white border-accent shadow-xs"
                          : "bg-surface-subtle text-text-secondary border-border hover:bg-surface-muted"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Top-K and Filter Action Buttons */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-text-muted">Top K:</span>
                  {([10, 25, 50, 100] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTopK(k)}
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        topK === k
                          ? "bg-surface-muted text-accent font-bold border border-accent/40"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>

                <div className="h-4 w-[1px] bg-border hidden sm:block" />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters((prev) => !prev)}
                  className={`text-xs h-7 gap-1.5 ${showFilters ? "bg-accent-subtle text-accent border-accent/40" : ""}`}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Metadata Filters</span>
                  {activeFiltersCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-accent text-white font-mono">
                      {activeFiltersCount}
                    </span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedParams((prev) => !prev)}
                  className={`text-xs h-7 text-text-muted hover:text-text-primary ${showAdvancedParams ? "text-accent font-semibold" : ""}`}
                  title="Advanced Candidate Depth Settings"
                >
                  Candidates
                </Button>

                {activeFiltersCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResetFilters}
                    className="text-xs h-7 text-text-muted hover:text-text-primary"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* Advanced Candidate Pool Expansion */}
            {showAdvancedParams && (
              <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-3 animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Lexical Candidates (SQLite FTS5 Pool)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={lexicalCandidates}
                    onChange={(e) => setLexicalCandidates(Math.max(1, parseInt(e.target.value) || 50))}
                    className="h-8 text-xs font-mono"
                  />
                  <span className="text-[10px] text-text-muted mt-0.5 block">
                    Pool size fetched from lexical BM25 engine (1–200)
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Semantic Candidates (ChromaDB Pool)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={semanticCandidates}
                    onChange={(e) => setSemanticCandidates(Math.max(1, parseInt(e.target.value) || 50))}
                    className="h-8 text-xs font-mono"
                  />
                  <span className="text-[10px] text-text-muted mt-0.5 block">
                    Pool size fetched from vector similarity index (1–200)
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Rerank Candidates (Cross-Encoder Depth)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={rerankCandidates}
                    onChange={(e) => setRerankCandidates(Math.max(1, parseInt(e.target.value) || 30))}
                    className="h-8 text-xs font-mono"
                  />
                  <span className="text-[10px] text-text-muted mt-0.5 block">
                    Top fused candidates scored by BGE Cross-Encoder (1–100)
                  </span>
                </div>
              </div>
            )}

            {/* Structured Metadata Filters Panel */}
            {showFilters && (
              <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Event Type Filter
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {(["ALL", "AUTH_FAILURE", "AUTH_SUCCESS", "INVALID_USER", "DISCONNECT"] as const).map(
                      (et) => (
                        <button
                          key={et}
                          type="button"
                          onClick={() => setFilterEventType(et)}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            filterEventType === et
                              ? "bg-accent text-white"
                              : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                          }`}
                        >
                          {et}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Severity Filter
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {(["ALL", "INFO", "WARNING", "CRITICAL"] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setFilterSeverity(sev)}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          filterSeverity === sev
                            ? "bg-accent text-white"
                            : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    User Account
                  </label>
                  <Input
                    placeholder="e.g. root, admin"
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Source IP Address
                  </label>
                  <Input
                    placeholder="e.g. 192.168.1.100"
                    value={filterSrcIp}
                    onChange={(e) => setFilterSrcIp(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    From Timestamp (UTC)
                  </label>
                  <Input
                    placeholder="e.g. 2026-01-15T10:00:00"
                    value={filterFromTime}
                    onChange={(e) => setFilterFromTime(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    To Timestamp (UTC)
                  </label>
                  <Input
                    placeholder="e.g. 2026-01-15T12:00:00"
                    value={filterToTime}
                    onChange={(e) => setFilterToTime(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Evidence File ID
                  </label>
                  <Input
                    placeholder="e.g. EV_9F8B2C4D1E3A7001"
                    value={filterEvidenceId}
                    onChange={(e) => setFilterEvidenceId(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Model Not Ready (503) Recovery Box */}
      {searchError?.is503 && (
        <Card className="border-status-warning bg-status-warning-bg/40">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-status-warning shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-text-primary">
                  Local AI Model Unavailable (HTTP 503)
                </h4>
                <p className="text-xs text-text-secondary mt-0.5 max-w-2xl">
                  {searchError.message}
                </p>
                <p className="text-[11px] text-text-muted mt-1">
                  You can continue your investigation without AI models by switching to{" "}
                  <strong>KEYWORD_ONLY</strong> mode, which uses SQLite FTS5 lexical BM25 matching and requires zero neural weights.
                </p>
              </div>
            </div>

            <Button
              variant="default"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => {
                setMode("KEYWORD_ONLY");
                executeSearch("KEYWORD_ONLY");
              }}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Switch to Keyword Mode & Search</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* General Search Error */}
      {searchError && !searchError.is503 && (
        <ErrorState
          title="Retrieval Search Failed"
          message={searchError.message}
          onRetry={() => executeSearch()}
        />
      )}

      {/* Search In Progress */}
      {searchLoading && (
        <LoadingState message="Executing multi-stage retrieval, lexical BM25 matching, dense vector similarity, and reciprocal rank fusion..." />
      )}

      {/* Search Results Display */}
      {!searchLoading && searchResponse && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Results Summary Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-text-primary">
                {searchResponse.total} evidence {searchResponse.total === 1 ? "record" : "records"} retrieved
              </span>
              <span className="text-xs text-text-muted">for</span>
              <span className="font-mono text-xs text-accent font-medium px-2 py-0.5 rounded bg-surface border border-border truncate max-w-xs">
                "{searchResponse.query}"
              </span>
              <Badge variant="accent" className="font-mono text-[10px]">
                {searchResponse.retrievalMode}
              </Badge>
            </div>

            <div className="text-xs text-text-muted font-mono">
              Scope: {searchResponse.caseId}
            </div>
          </div>

          {searchResponse.items.length === 0 ? (
            <Card>
              <CardContent className="p-8">
                <EmptyState
                  icon={<Search className="w-8 h-8 text-text-disabled" />}
                  title="No Evidence Records Retrieved"
                  description={`No records in case ${currentCase.caseId} matched your query "${searchResponse.query}" under mode ${searchResponse.retrievalMode}.`}
                  actionLabel={activeFiltersCount > 0 ? "Clear Metadata Filters" : undefined}
                  onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {searchResponse.items.map((item) => (
                <Card
                  key={item.documentId}
                  className="hover:border-accent/40 transition-colors group cursor-pointer"
                  onClick={() => setInspectedItem(item)}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Top Row: Rank, Provenance, and Score Metrics */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Final Rank */}
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-accent text-white shadow-xs">
                          #{item.finalRank}
                        </span>

                        {/* File & Provenance */}
                        <span className="font-mono font-semibold text-xs text-text-primary">
                          {item.originalFilename}
                        </span>
                        <span className="font-mono text-xs text-text-muted">
                          {item.lineNumber != null ? `Line ${item.lineNumber}` : `Rec #${item.recordNo}`}
                        </span>
                        {item.byteStart != null && item.byteEnd != null && (
                          <span className="font-mono text-[11px] text-text-disabled">
                            [{item.byteStart}–{item.byteEnd} B]
                          </span>
                        )}
                      </div>

                      {/* Rank & Score Breakdown Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                        {item.lexicalRank != null && (
                          <span
                            className="px-1.5 py-0.2 rounded bg-surface-subtle border border-border text-text-secondary"
                            title="Rank in Lexical FTS5 Results"
                          >
                            Lex: #{item.lexicalRank}
                          </span>
                        )}

                        {item.semanticRank != null && (
                          <span
                            className="px-1.5 py-0.2 rounded bg-surface-subtle border border-border text-text-secondary"
                            title="Rank in Semantic ChromaDB Results"
                          >
                            Sem: #{item.semanticRank}
                          </span>
                        )}

                        {item.rrfScore != null && (
                          <span
                            className="px-1.5 py-0.2 rounded bg-surface-subtle border border-border text-accent font-semibold"
                            title="Reciprocal Rank Fusion Score"
                          >
                            RRF: {item.rrfScore.toFixed(4)}
                          </span>
                        )}

                        {item.rerankScore != null && (
                          <span
                            className="px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-status-success font-semibold"
                            title="Cross-Encoder Reranker Score"
                          >
                            Rerank: {item.rerankScore.toFixed(3)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata attributes row (if present) */}
                    {(item.timestamp || item.eventType || item.severity || item.user || item.srcIp) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {item.timestamp && (
                          <div className="flex items-center gap-1 font-mono text-[11px] text-text-muted">
                            <Clock className="w-3 h-3 text-text-disabled" />
                            <span>{formatDateTime(item.timestamp)}</span>
                          </div>
                        )}

                        {item.eventType && (
                          <span className="font-mono text-[11px] font-semibold text-text-primary px-1.5 py-0.2 rounded bg-surface-subtle border border-border">
                            {item.eventType}
                          </span>
                        )}

                        {item.severity && (
                          <Badge variant={getSeverityBadgeVariant(item.severity)}>
                            {item.severity}
                          </Badge>
                        )}

                        {item.user && (
                          <span className="font-mono text-[11px] text-text-secondary">
                            user: <strong>{item.user}</strong>
                          </span>
                        )}

                        {item.srcIp && (
                          <span className="font-mono text-[11px] text-text-secondary">
                            src: <strong>{item.srcIp}</strong>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Raw Text Snippet */}
                    <div className="p-2.5 rounded bg-neutral-950 text-neutral-100 font-mono text-xs overflow-x-auto select-all">
                      <pre className="whitespace-pre break-all">{item.text}</pre>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="font-mono text-[11px] text-text-muted">
                        Doc: {item.documentId}
                      </div>

                      <div className="flex items-center gap-2">
                        {item.eventId && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs text-accent hover:text-accent-hover gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectedEventId(item.eventId!);
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>View Event</span>
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-text-muted group-hover:text-text-primary gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedItem(item);
                          }}
                        >
                          <Eye className="w-3 h-3" />
                          <span>Inspect Provenance</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Initial Landing State when no query has been executed yet */}
      {!searchLoading && !searchResponse && !searchError && (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={<Sparkles className="w-8 h-8 text-text-disabled" />}
              title="Hybrid Forensic Retrieval"
              description="Enter an investigation query above to retrieve and rank evidence records across lexical and dense semantic spaces with full forensic provenance."
            />
          </CardContent>
        </Card>
      )}

      {/* Retrieval Result Provenance Inspector Modal */}
      <RetrievalResultInspectorModal
        item={inspectedItem}
        onClose={() => setInspectedItem(null)}
        onOpenEventInspector={(eventId) => {
          setInspectedItem(null);
          setInspectedEventId(eventId);
        }}
      />

      {/* Event Inspector Modal */}
      <EventInspectorModal
        eventId={inspectedEventId}
        caseId={currentCase?.caseId}
        onClose={() => setInspectedEventId(null)}
      />
    </div>
  );
}
