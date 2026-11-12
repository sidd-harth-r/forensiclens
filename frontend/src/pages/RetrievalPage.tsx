import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Database,
  Sparkles,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  FileText,
  Eye,
  Zap,
  RotateCcw,
  Cpu,
  ExternalLink,
  Clock,
  CheckCircle2,
  CircleDashed,
  ScanSearch,
} from "lucide-react";
import { toast } from "sonner";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope } from "@/components/layout/PageHeader";
import { Card, Panel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Badge, SeverityBadge, type BadgeVariant } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EvidenceText } from "@/components/ui/DataDisplay";
import { Skeleton, CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Notice } from "@/components/common/Notice";
import { RetrievalResultInspectorModal } from "@/components/retrieval/RetrievalResultInspectorModal";
import { MatchChannels } from "@/components/retrieval/MatchChannels";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getRetrievalStatus, indexCase, searchCaseEvidence } from "@/services/retrieval";
import { RetrievalMode, RetrievalResultItem, RetrievalSearchResponse, RetrievalStatusResponse } from "@/types/retrieval";
import { formatDateTime, describeError } from "@/lib/formatters";
import { ApiError, isApiMode } from "@/services/apiClient";
import { cn } from "@/lib/utils";

const MODES: { id: RetrievalMode; label: string; icon: React.ReactNode; title: string }[] = [
  { id: "HYBRID_RERANKED", label: "Hybrid + rerank", icon: <Sparkles />, title: "Lexical + semantic, fused with RRF, then cross-encoder reranked" },
  { id: "HYBRID", label: "Hybrid", icon: <Layers />, title: "Lexical + semantic fused with Reciprocal Rank Fusion" },
  { id: "SEMANTIC_ONLY", label: "Semantic", icon: <Cpu />, title: "Dense embedding similarity only" },
  { id: "KEYWORD_ONLY", label: "Keyword", icon: <FileText />, title: "SQLite FTS5 BM25 only — needs no model weights" },
];

const EVENT_TYPES = ["ALL", "AUTH_FAILURE", "AUTH_SUCCESS", "INVALID_USER", "DISCONNECT"] as const;
const SEVERITIES = ["ALL", "INFO", "WARNING", "CRITICAL"] as const;

function indexStatusVariant(s?: string): BadgeVariant {
  switch (s) {
    case "READY":
      return "verified";
    case "FIXTURE_MODE":
    case "PARTIAL":
    case "STALE":
    case "UNINDEXED":
      return "warning";
    default:
      return "neutral";
  }
}

function ModelState({ name, ready }: { name: string; ready: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {ready ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-status-success" aria-hidden="true" />
      ) : (
        <CircleDashed className="h-3 w-3 shrink-0 text-status-warning" aria-hidden="true" />
      )}
      <span className="truncate font-mono" title={name}>
        {name.split("/").pop()}
      </span>
      <span className="sr-only">{ready ? "weights loaded" : "weights not loaded"}</span>
    </span>
  );
}

export function RetrievalPage() {
  const { currentCase } = useCase();

  // Index status
  const [status, setStatus] = useState<RetrievalStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [indexingAction, setIndexingAction] = useState<"incremental" | "rebuild" | null>(null);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);

  // Search form
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RetrievalMode>("HYBRID_RERANKED");
  const [topK, setTopK] = useState(10);
  const [lexicalCandidates, setLexicalCandidates] = useState(50);
  const [semanticCandidates, setSemanticCandidates] = useState(50);
  const [rerankCandidates, setRerankCandidates] = useState(30);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);

  // Metadata filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterEventType, setFilterEventType] = useState("ALL");
  const [filterSeverity, setFilterSeverity] = useState("ALL");
  const [filterUser, setFilterUser] = useState("");
  const [filterSrcIp, setFilterSrcIp] = useState("");
  const [filterFromTime, setFilterFromTime] = useState("");
  const [filterToTime, setFilterToTime] = useState("");
  const [filterEvidenceId, setFilterEvidenceId] = useState("");

  // Results
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<{ message: string; is503: boolean } | null>(null);
  const [searchResponse, setSearchResponse] = useState<RetrievalSearchResponse | null>(null);

  // Inspectors
  const [inspectedItem, setInspectedItem] = useState<RetrievalResultItem | null>(null);
  const [inspectedEventId, setInspectedEventId] = useState<string | null>(null);

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
      setStatusError(describeError(err, "Failed to load retrieval status"));
    } finally {
      setStatusLoading(false);
    }
  }, [currentCase?.caseId]);

  useEffect(() => {
    loadIndexStatus();
  }, [loadIndexStatus]);

  // Reset results when the case changes — results are case-scoped
  useEffect(() => {
    setSearchResponse(null);
    setSearchError(null);
  }, [currentCase?.caseId]);

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
      const msg = describeError(err, "Indexing failed");
      toast.error(`Indexing error: ${msg}`);
    } finally {
      setIndexingAction(null);
    }
  };

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
  }, [filterEventType, filterSeverity, filterUser, filterSrcIp, filterFromTime, filterToTime, filterEvidenceId]);

  const handleResetFilters = () => {
    setFilterEventType("ALL");
    setFilterSeverity("ALL");
    setFilterUser("");
    setFilterSrcIp("");
    setFilterFromTime("");
    setFilterToTime("");
    setFilterEvidenceId("");
  };

  const executeSearch = useCallback(
    async (overrideMode?: RetrievalMode) => {
      if (!currentCase?.caseId) {
        toast.error("Please select a forensic case first");
        return;
      }

      if (!isApiMode) {
        toast.error("Retrieval search is disabled in fixture mode. Live backend API required.");
        setSearchError({
          message:
            "Forensic retrieval search is disabled in fixture mode. Hybrid retrieval requires a live backend API connection (VITE_DATA_MODE=api) with SQLite FTS5 lexical matching, ChromaDB vector retrieval, and cross-encoder reranking.",
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
        const msg = describeError(err, "Search query failed");
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

  if (!currentCase) {
    return (
      <>
        <PageHeader title="Retrieval Explorer" description="Case-isolated hybrid evidence retrieval." />
        <EmptyState
          icon={<Database />}
          title="No case selected"
          description="Select a case to inspect its index status and search its evidence records."
        />
      </>
    );
  }

  const pct = status && status.totalRecords > 0 ? Math.round((status.indexedRecords / status.totalRecords) * 100) : 0;
  const busy = indexingAction !== null || statusLoading;

  return (
    <>
      <PageHeader
        title="Retrieval Explorer"
        eyebrow={<CaseScope caseId={currentCase.caseId} name={currentCase.name} />}
        description="Multi-stage retrieval over raw evidence records: FTS5 lexical BM25, local dense embeddings, Reciprocal Rank Fusion and cross-encoder reranking."
      />

      <div className="space-y-5">
        {!isApiMode && (
          <Notice tone="warning" title="Retrieval requires the live backend">
            The UI is running on fixture data (<code className="font-mono">VITE_DATA_MODE=fixtures</code>). Retrieval scores
            are never synthesized, so search and indexing are disabled until the FastAPI backend is connected.
          </Notice>
        )}

        {/* Index & model readiness */}
        <Panel
          title="Index & local models"
          icon={<Database />}
          actions={
            <>
              {status && <Badge variant={indexStatusVariant(status.indexStatus)} mono>{status.indexStatus}</Badge>}
              <Button variant="ghost" size="sm" onClick={loadIndexStatus} disabled={busy} aria-label="Refresh index status">
                <RefreshCw className={cn("h-3.5 w-3.5", statusLoading && "animate-spin")} aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleIndexRecords(false)}
                disabled={!isApiMode || busy}
                loading={indexingAction === "incremental"}
                title={!isApiMode ? "Requires live backend API mode" : "Embed records added since the last index run"}
              >
                {indexingAction !== "incremental" && <Zap className="h-3.5 w-3.5" aria-hidden="true" />}
                Index new records
              </Button>
              <Button
                variant="destructive-outline"
                size="sm"
                onClick={() => setShowRebuildConfirm(true)}
                disabled={!isApiMode || busy}
                loading={indexingAction === "rebuild"}
                title={!isApiMode ? "Requires live backend API mode" : "Purge and re-embed every record"}
              >
                {indexingAction !== "rebuild" && <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                Rebuild
              </Button>
            </>
          }
        >
          {statusLoading && !status ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : statusError ? (
            <ErrorState inline title="Could not read index status" message={statusError} onRetry={loadIndexStatus} />
          ) : status ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
              <div className="min-w-0">
                <dt className="label-caps">Indexed records</dt>
                <dd className="mt-1 font-mono text-text-primary">
                  {status.indexedRecords.toLocaleString()} / {status.totalRecords.toLocaleString()}
                  <span className="ml-1 text-text-muted">{status.totalRecords > 0 ? `${pct}%` : ""}</span>
                </dd>
                <div
                  className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-label="Index coverage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                >
                  <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="min-w-0">
                <dt className="label-caps">Embedding model</dt>
                <dd className="mt-1 text-text-primary">
                  <ModelState name={status.embeddingModel} ready={status.embeddingModelReady} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="label-caps">Reranker model</dt>
                <dd className="mt-1 text-text-primary">
                  <ModelState name={status.rerankerModel} ready={status.rerankerModelReady} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="label-caps">Model network access</dt>
                <dd className={cn("mt-1 font-mono", status.offlineMode ? "text-text-primary" : "text-status-warning")}>
                  {status.offlineMode ? "Offline mode enforced" : "Offline mode not enforced"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="label-caps">Last indexed (UTC)</dt>
                <dd className="mt-1 font-mono text-text-secondary">
                  {status.lastIndexedAt ? formatDateTime(status.lastIndexedAt) : "Never"}
                </dd>
              </div>
            </dl>
          ) : null}
        </Panel>

        {/* Search */}
        <Card>
          <form onSubmit={handleSearchSubmit} className="space-y-3 p-4">
            <label htmlFor="retrieval-query" className="sr-only">
              Retrieval query
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="retrieval-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Natural-language question or keywords — e.g. failed root ssh authentication from 192.168.1.100"
                className="h-10 text-sm"
                icon={<Search />}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={!isApiMode || !query.trim()}
                loading={searchLoading}
                title={!isApiMode ? "Retrieval search requires live backend API mode" : undefined}
                className="h-10 shrink-0"
              >
                {!searchLoading && <Search className="h-4 w-4" aria-hidden="true" />}
                Retrieve
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted" id="mode-label">
                  Mode
                </span>
                <SegmentedControl<RetrievalMode>
                  label="Retrieval mode"
                  value={mode}
                  onChange={setMode}
                  options={MODES.map((m) => ({ value: m.id, label: m.label, icon: m.icon, title: m.title }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Top K</span>
                <SegmentedControl<number>
                  label="Number of results"
                  value={topK}
                  onChange={setTopK}
                  mono
                  options={[10, 25, 50, 100].map((k) => ({ value: k, label: String(k) }))}
                />
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={showFilters || activeFiltersCount > 0 ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowFilters((p) => !p)}
                  aria-expanded={showFilters}
                  aria-controls="retrieval-filters"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Metadata filters
                  {activeFiltersCount > 0 && (
                    <span className="rounded-sm bg-accent-subtle px-1 font-mono text-2xs text-accent-text">{activeFiltersCount}</span>
                  )}
                </Button>
                <Button
                  type="button"
                  variant={showAdvancedParams ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowAdvancedParams((p) => !p)}
                  aria-expanded={showAdvancedParams}
                  aria-controls="retrieval-candidates"
                >
                  Candidate depth
                </Button>
                {activeFiltersCount > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleResetFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            </div>

            {showAdvancedParams && (
              <div id="retrieval-candidates" className="grid grid-cols-1 gap-3 rounded border border-border-subtle bg-surface-subtle p-3 sm:grid-cols-3">
                <Field label="Lexical candidates" htmlFor="lex-cand" hint="FTS5 BM25 pool (1–200)">
                  <Input id="lex-cand" type="number" min={1} max={200} value={lexicalCandidates} onChange={(e) => setLexicalCandidates(Math.max(1, parseInt(e.target.value) || 50))} className="font-mono" />
                </Field>
                <Field label="Semantic candidates" htmlFor="sem-cand" hint="Vector similarity pool (1–200)">
                  <Input id="sem-cand" type="number" min={1} max={200} value={semanticCandidates} onChange={(e) => setSemanticCandidates(Math.max(1, parseInt(e.target.value) || 50))} className="font-mono" />
                </Field>
                <Field label="Rerank candidates" htmlFor="rr-cand" hint="Fused candidates scored by the cross-encoder (1–100)">
                  <Input id="rr-cand" type="number" min={1} max={100} value={rerankCandidates} onChange={(e) => setRerankCandidates(Math.max(1, parseInt(e.target.value) || 30))} className="font-mono" />
                </Field>
              </div>
            )}

            {showFilters && (
              <div id="retrieval-filters" className="grid grid-cols-1 gap-3 rounded border border-border-subtle bg-surface-subtle p-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-text-secondary">Event type</span>
                  <SegmentedControl<string>
                    label="Event type filter"
                    value={filterEventType}
                    onChange={setFilterEventType}
                    size="xs"
                    mono
                    options={EVENT_TYPES.map((t) => ({ value: t, label: t === "ALL" ? "All" : t }))}
                  />
                </div>
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-text-secondary">Severity</span>
                  <SegmentedControl<string>
                    label="Severity filter"
                    value={filterSeverity}
                    onChange={setFilterSeverity}
                    size="xs"
                    options={SEVERITIES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase() }))}
                  />
                </div>
                <Field label="User" htmlFor="rf-user">
                  <Input id="rf-user" placeholder="e.g. root" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="font-mono text-xs" />
                </Field>
                <Field label="Source IP" htmlFor="rf-ip">
                  <Input id="rf-ip" placeholder="e.g. 192.168.1.100" value={filterSrcIp} onChange={(e) => setFilterSrcIp(e.target.value)} className="font-mono text-xs" />
                </Field>
                <Field label="From (UTC)" htmlFor="rf-from">
                  <Input id="rf-from" placeholder="2026-01-15T10:00:00" value={filterFromTime} onChange={(e) => setFilterFromTime(e.target.value)} className="font-mono text-xs" />
                </Field>
                <Field label="To (UTC)" htmlFor="rf-to">
                  <Input id="rf-to" placeholder="2026-01-15T12:00:00" value={filterToTime} onChange={(e) => setFilterToTime(e.target.value)} className="font-mono text-xs" />
                </Field>
                <Field label="Evidence ID" htmlFor="rf-ev" className="sm:col-span-2">
                  <Input id="rf-ev" placeholder="e.g. EV_9F8B2C4D1E3A7001" value={filterEvidenceId} onChange={(e) => setFilterEvidenceId(e.target.value)} className="font-mono text-xs" />
                </Field>
              </div>
            )}
          </form>
        </Card>

        {/* Model unavailable — offer keyword fallback */}
        {searchError?.is503 && (
          <Notice
            tone="warning"
            title="Local model unavailable (HTTP 503)"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setMode("KEYWORD_ONLY");
                  executeSearch("KEYWORD_ONLY");
                }}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Search with keyword mode
              </Button>
            }
          >
            <p>{searchError.message}</p>
            <p>Keyword mode uses SQLite FTS5 BM25 matching and needs no neural model weights.</p>
          </Notice>
        )}

        {searchError && !searchError.is503 && (
          <ErrorState title="Retrieval failed" message={searchError.message} onRetry={() => executeSearch()} />
        )}

        {/* Results */}
        {searchLoading ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <span className="sr-only">Running retrieval</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} lines={3} />
            ))}
          </div>
        ) : searchResponse ? (
          <section aria-labelledby="results-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="results-heading" className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                <span className="font-mono font-semibold text-text-primary">{searchResponse.total}</span>
                {searchResponse.total === 1 ? "record" : "records"} for
                <span className="max-w-xs truncate rounded border border-border bg-surface px-1.5 font-mono text-xs text-text-primary">
                  {searchResponse.query}
                </span>
                <Badge variant="accent" mono>
                  {searchResponse.retrievalMode}
                </Badge>
              </h2>
              <span className="font-mono text-2xs text-text-muted">scope {searchResponse.caseId}</span>
            </div>

            {searchResponse.items.length === 0 ? (
              <EmptyState
                icon={<Search />}
                title="No records retrieved"
                description={`Nothing in ${currentCase.caseId} matched this query in ${searchResponse.retrievalMode} mode.`}
                actionLabel={activeFiltersCount > 0 ? "Clear metadata filters" : undefined}
                onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
              />
            ) : (
              <ol className="space-y-2">
                {searchResponse.items.map((item) => (
                  <li key={item.documentId}>
                    <article className="grid grid-cols-[44px_1fr] overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong sm:grid-cols-[52px_1fr_150px]">
                      <div className="flex flex-col items-center border-r border-border-subtle bg-surface-subtle pt-3">
                        <span className="label-caps">Rank</span>
                        <span className="font-mono text-base font-semibold text-text-primary">{item.finalRank}</span>
                      </div>

                      <div className="min-w-0 space-y-2 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button
                            type="button"
                            onClick={() => setInspectedItem(item)}
                            className="truncate rounded font-mono text-xs font-medium text-text-primary hover:text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            aria-label={`Inspect provenance for rank ${item.finalRank}: ${item.originalFilename}`}
                          >
                            {item.originalFilename}
                            <span className="text-text-muted">
                              {item.lineNumber != null ? `:${item.lineNumber}` : ` rec #${item.recordNo}`}
                            </span>
                          </button>
                          <MatchChannels item={item} mode={searchResponse.retrievalMode} />
                        </div>

                        {(item.timestamp || item.eventType || item.severity || item.user || item.srcIp) && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted">
                            {item.timestamp && (
                              <span className="inline-flex items-center gap-1 font-mono">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {formatDateTime(item.timestamp)}
                              </span>
                            )}
                            {item.eventType && <span className="font-mono text-text-secondary">{item.eventType}</span>}
                            {item.severity && <SeverityBadge severity={item.severity} />}
                            {item.user && <span className="font-mono">user {item.user}</span>}
                            {item.srcIp && <span className="font-mono">src {item.srcIp}</span>}
                          </div>
                        )}

                        <EvidenceText maxHeightClass="max-h-24">{item.text}</EvidenceText>

                        <div className="flex flex-wrap items-center gap-2 sm:hidden">
                          {item.rrfScore != null && <span className="font-mono text-2xs text-text-muted">RRF {item.rrfScore.toFixed(4)}</span>}
                          {item.rerankScore != null && <span className="font-mono text-2xs text-text-muted">rerank {item.rerankScore.toFixed(3)}</span>}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="ghost" size="xs" onClick={() => setInspectedItem(item)}>
                            <Eye className="h-3 w-3" aria-hidden="true" />
                            Provenance
                          </Button>
                          {item.eventId && (
                            <Button variant="ghost" size="xs" onClick={() => setInspectedEventId(item.eventId!)}>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              Event
                            </Button>
                          )}
                          <span className="ml-auto truncate font-mono text-2xs text-text-disabled">{item.evidenceId}</span>
                        </div>
                      </div>

                      <dl className="hidden space-y-2 border-l border-border-subtle px-3 py-2.5 text-xs sm:block">
                        <div>
                          <dt className="label-caps">RRF score</dt>
                          <dd className="font-mono text-text-primary">{item.rrfScore != null ? item.rrfScore.toFixed(4) : "—"}</dd>
                        </div>
                        <div>
                          <dt className="label-caps">Rerank score</dt>
                          <dd className="font-mono text-text-primary">{item.rerankScore != null ? item.rerankScore.toFixed(3) : "—"}</dd>
                        </div>
                      </dl>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : (
          !searchError && (
            <EmptyState
              icon={<ScanSearch />}
              title="Search this case's evidence"
              description="Results show the verbatim record, which retrieval channels matched it, fused and reranked scores, and the exact file, line and byte range it came from."
            />
          )
        )}
      </div>

      <ConfirmDialog
        open={showRebuildConfirm}
        onCancel={() => setShowRebuildConfirm(false)}
        onConfirm={() => handleIndexRecords(true)}
        title="Rebuild the vector index?"
        description={`Purges the vector collection for ${currentCase.caseId} and re-embeds every raw record. Raw evidence is not modified.`}
        confirmLabel="Rebuild index"
        tone="danger"
        loading={indexingAction === "rebuild"}
      />

      <RetrievalResultInspectorModal
        item={inspectedItem}
        mode={searchResponse?.retrievalMode}
        onClose={() => setInspectedItem(null)}
        onOpenEventInspector={(eventId) => {
          setInspectedItem(null);
          setInspectedEventId(eventId);
        }}
      />

      <EventInspectorModal eventId={inspectedEventId} caseId={currentCase?.caseId} onClose={() => setInspectedEventId(null)} />
    </>
  );
}
