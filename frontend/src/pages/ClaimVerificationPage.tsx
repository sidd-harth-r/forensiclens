import React, { useState, useEffect, useCallback } from "react";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ClaimStatusBadge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { DataModeBadge } from "@/components/common/DataModeBadge";
import { ClaimDetailInspector } from "@/components/claims/ClaimDetailInspector";
import { extractClaims, getCaseClaims, verifyClaim } from "@/services/claims";
import type {
  Claim,
  ClaimExtractionResponse,
  ClaimListResponse,
  ClaimType,
  VerificationStatus,
} from "@/types/claims";
import { formatDateTime } from "@/lib/formatters";
import {
  ShieldCheck,
  Sparkles,
  Layers,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Eye,
  RefreshCw,
  SlidersHorizontal,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

const CLAIM_TYPES: { label: string; value: ClaimType | "ALL" }[] = [
  { label: "All Claim Types", value: "ALL" },
  { label: "Authentication Success (AUTH_SUCCESS)", value: "AUTH_SUCCESS" },
  { label: "Authentication Failure (AUTH_FAILURE)", value: "AUTH_FAILURE" },
  { label: "Session Start (SESSION_START)", value: "SESSION_START" },
  { label: "Session End (SESSION_END)", value: "SESSION_END" },
  { label: "Session Activity (SESSION_ACTIVITY)", value: "SESSION_ACTIVITY" },
  { label: "Network Connection (NETWORK_CONNECTION)", value: "NETWORK_CONNECTION" },
  { label: "File Access (FILE_ACCESS)", value: "FILE_ACCESS" },
  { label: "Account Modification (ACCOUNT_MODIFICATION)", value: "ACCOUNT_MODIFICATION" },
  { label: "Process Execution (PROCESS_EXECUTION)", value: "PROCESS_EXECUTION" },
  { label: "Generic Forensic Event (GENERIC_FORENSIC_EVENT)", value: "GENERIC_FORENSIC_EVENT" },
];

export function ClaimVerificationPage() {
  const { currentCase } = useCase();

  // Extraction Form State
  const [query, setQuery] = useState("");
  const [retrievalMode, setRetrievalMode] = useState("HYBRID");
  const [retrievalLimit, setRetrievalLimit] = useState(20);
  const [investigationId, setInvestigationId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ClaimExtractionResponse | null>(null);
  const [showExtractionParams, setShowExtractionParams] = useState(false);

  // Claims List & Filters State
  const [claimsData, setClaimsData] = useState<ClaimListResponse | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "ALL">("ALL");
  const [claimTypeFilter, setClaimTypeFilter] = useState<ClaimType | "ALL">("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Inspector & Verification Modals State
  const [inspectedClaim, setInspectedClaim] = useState<Claim | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"details" | "provenance" | "history">("details");
  const [confirmVerifyClaim, setConfirmVerifyClaim] = useState<Claim | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Load claims for current case
  const loadClaims = useCallback(async () => {
    if (!currentCase?.caseId) {
      setClaimsData(null);
      setClaimsLoading(false);
      return;
    }

    setClaimsLoading(true);
    setClaimsError(null);

    try {
      const res = await getCaseClaims(currentCase.caseId, {
        claimType: claimTypeFilter !== "ALL" ? claimTypeFilter : undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        page: currentPage,
        pageSize,
      });
      setClaimsData(res);
    } catch (err) {
      setClaimsError(err instanceof Error ? err.message : "Failed to load claims");
    } finally {
      setClaimsLoading(false);
    }
  }, [currentCase?.caseId, claimTypeFilter, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  // Handle Claim Extraction
  const handleExtractClaims = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentCase?.caseId) {
      toast.error("Please select a forensic case first.");
      return;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      toast.error("Please enter a question or hypothesis to extract claims.");
      return;
    }

    setExtracting(true);
    setExtractionResult(null);

    try {
      const res = await extractClaims(currentCase.caseId, {
        query: trimmedQuery,
        retrievalMode,
        retrievalLimit,
        investigationId: investigationId.trim() || undefined,
      });

      setExtractionResult(res);
      toast.success(
        `Extracted ${res.extractedClaims.length} atomic claim(s) grounded in ${res.evidenceRetrievedCount} evidence records.`
      );
      // Reset to page 1 and reload table
      setCurrentPage(1);
      await loadClaims();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claim extraction failed";
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  // Open Verification Confirmation
  const promptVerify = (claim: Claim) => {
    setConfirmVerifyClaim(claim);
  };

  // Execute Deterministic Verification
  const executeVerification = async (claimToVerify: Claim) => {
    if (!currentCase?.caseId) return;

    setIsVerifying(true);
    try {
      const result = await verifyClaim(currentCase.caseId, claimToVerify.claimId);
      toast.success(
        `Verification completed: ${result.status} (Rule: ${result.ruleId})`
      );

      // Close confirmation dialog if open
      setConfirmVerifyClaim(null);

      // Update inspected claim status if currently inspecting this claim
      if (inspectedClaim?.claimId === claimToVerify.claimId) {
        setInspectedClaim((prev) =>
          prev ? { ...prev, currentStatus: result.status } : null
        );
      }

      // Refresh list to update status cache & summary counters
      await loadClaims();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claim verification failed";
      toast.error(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  // Safe confidence score formatting
  const formatConfidence = (confidence: number | null | undefined) => {
    if (confidence === null || confidence === undefined) {
      return <span className="text-text-muted italic">Unavailable</span>;
    }
    return (
      <span className="font-mono font-medium text-text-primary">
        {Math.round(confidence * 100)}%
      </span>
    );
  };

  // Summary counts from backend response
  const summary = claimsData?.summary ?? {
    SUPPORTED: 0,
    CONTRADICTED: 0,
    UNVERIFIED: 0,
    INSUFFICIENT_EVIDENCE: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claim Verification Explorer"
        description="Evidence-grounded atomic claim extraction and deterministic verification against immutable case evidence."
        actions={
          <div className="flex items-center gap-2">
            <DataModeBadge />
          </div>
        }
      />

      {/* Case Check */}
      {!currentCase?.caseId ? (
        <EmptyState
          icon={<Layers className="w-10 h-10 text-text-disabled" />}
          title="No Forensic Case Selected"
          description="Select an active case from the case selector to extract and verify investigative claims."
        />
      ) : (
        <div className="space-y-6">
          {/* Status Metric Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* SUPPORTED */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter((prev) => (prev === "SUPPORTED" ? "ALL" : "SUPPORTED"));
                setCurrentPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                statusFilter === "SUPPORTED"
                  ? "bg-emerald-500/10 border-emerald-500 shadow-sm ring-1 ring-emerald-500"
                  : "bg-surface border-border hover:border-emerald-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  SUPPORTED
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold font-mono text-text-primary mt-2">
                {summary.SUPPORTED ?? 0}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Deterministic predicate match
              </p>
            </button>

            {/* CONTRADICTED */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter((prev) => (prev === "CONTRADICTED" ? "ALL" : "CONTRADICTED"));
                setCurrentPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                statusFilter === "CONTRADICTED"
                  ? "bg-red-500/10 border-red-500 shadow-sm ring-1 ring-red-500"
                  : "bg-surface border-border hover:border-red-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                  CONTRADICTED
                </span>
                <XCircle className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-2xl font-bold font-mono text-text-primary mt-2">
                {summary.CONTRADICTED ?? 0}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Incompatible evidence verified
              </p>
            </button>

            {/* UNVERIFIED */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter((prev) => (prev === "UNVERIFIED" ? "ALL" : "UNVERIFIED"));
                setCurrentPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                statusFilter === "UNVERIFIED"
                  ? "bg-slate-500/10 border-slate-500 shadow-sm ring-1 ring-slate-500"
                  : "bg-surface border-border hover:border-slate-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-secondary">
                  UNVERIFIED
                </span>
                <HelpCircle className="w-4 h-4 text-text-muted" />
              </div>
              <p className="text-2xl font-bold font-mono text-text-primary mt-2">
                {summary.UNVERIFIED ?? 0}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Extracted, awaiting verification
              </p>
            </button>

            {/* INSUFFICIENT EVIDENCE */}
            <button
              type="button"
              onClick={() => {
                setStatusFilter((prev) => (prev === "INSUFFICIENT_EVIDENCE" ? "ALL" : "INSUFFICIENT_EVIDENCE"));
                setCurrentPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                statusFilter === "INSUFFICIENT_EVIDENCE"
                  ? "bg-amber-500/10 border-amber-500 shadow-sm ring-1 ring-amber-500"
                  : "bg-surface border-border hover:border-amber-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  INSUFFICIENT EVIDENCE
                </span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-bold font-mono text-text-primary mt-2">
                {summary.INSUFFICIENT_EVIDENCE ?? 0}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                No matching or conclusive records
              </p>
            </button>
          </div>

          {/* Extraction Panel */}
          <Card className="border-border bg-surface shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-accent-subtle text-accent-text">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      Extract Grounded Atomic Claims
                    </CardTitle>
                    <p className="text-xs text-text-muted">
                      Retrieve candidate evidence and extract structured atomic claims via LLM provider abstraction.
                    </p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowExtractionParams((prev) => !prev)}
                  className="gap-1.5 text-text-secondary"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>{showExtractionParams ? "Hide Options" : "Retrieval Options"}</span>
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              <form onSubmit={handleExtractClaims} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="extract-query-input" className="text-xs font-medium text-text-primary">
                    Investigative Question or Assertion
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="extract-query-input"
                      placeholder="e.g. Did user admin log in from IP 192.168.1.50 between 14:00 and 15:00 UTC?"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={extracting}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      disabled={extracting || !query.trim()}
                      className="gap-1.5 shrink-0"
                    >
                      {extracting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Extracting...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Extract Claims</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Advanced Retrieval Options */}
                {showExtractionParams && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3.5 rounded-lg bg-surface-subtle border border-border/60 text-xs">
                    <div className="space-y-1">
                      <label htmlFor="retrieval-mode-select" className="font-medium text-text-secondary">
                        Retrieval Pipeline Mode
                      </label>
                      <select
                        id="retrieval-mode-select"
                        value={retrievalMode}
                        onChange={(e) => setRetrievalMode(e.target.value)}
                        disabled={extracting}
                        className="w-full h-8 px-2 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="HYBRID">HYBRID (Lexical + Semantic RRF)</option>
                        <option value="HYBRID_RERANKED">HYBRID_RERANKED (RRF + Cross-Encoder)</option>
                        <option value="KEYWORD_ONLY">KEYWORD_ONLY (SQLite FTS5)</option>
                        <option value="SEMANTIC_ONLY">SEMANTIC_ONLY (ChromaDB BGE)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="retrieval-limit-input" className="font-medium text-text-secondary">
                        Max Evidence Documents (1-100)
                      </label>
                      <Input
                        id="retrieval-limit-input"
                        type="number"
                        min={1}
                        max={100}
                        value={retrievalLimit}
                        onChange={(e) => setRetrievalLimit(Math.max(1, Math.min(100, Number(e.target.value))))}
                        disabled={extracting}
                        className="h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="investigation-id-input" className="font-medium text-text-secondary">
                        Optional Investigation ID
                      </label>
                      <Input
                        id="investigation-id-input"
                        placeholder="e.g. INV-2026-001"
                        value={investigationId}
                        onChange={(e) => setInvestigationId(e.target.value)}
                        disabled={extracting}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}

                {/* Extraction Policy Callout */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-subtle border border-border/60 text-xs text-text-secondary">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
                  <p>
                    <strong>Extraction Policy:</strong> Claims are extracted and grounded in retrieved case evidence.
                    Extracted claims are initialized strictly as <span className="font-mono font-semibold text-text-primary">UNVERIFIED</span>.
                    Verification does not execute automatically and must be triggered deterministically.
                  </p>
                </div>
              </form>

              {/* Extraction Outcome Banner */}
              {extractionResult && (
                <div className="p-3.5 rounded-lg bg-accent-subtle/50 border border-accent/20 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-accent-text">
                      Extraction Completed: {extractionResult.extractedClaims.length} Claim(s) Extracted
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      Method: {extractionResult.extractionMethod}
                    </span>
                  </div>
                  <p className="text-text-secondary">
                    Grounded using {extractionResult.evidenceRetrievedCount} retrieved forensic evidence record(s).
                    {extractionResult.omittedEvidenceCount > 0 && (
                      <span> ({extractionResult.omittedEvidenceCount} record(s) omitted due to size limits).</span>
                    )}
                  </p>
                  {extractionResult.warnings && extractionResult.warnings.length > 0 && (
                    <div className="pt-1 text-amber-700 dark:text-amber-300">
                      <span className="font-semibold">Warnings:</span>
                      <ul className="list-disc list-inside space-y-0.5 pl-1">
                        {extractionResult.warnings.map((w, wIdx) => (
                          <li key={wIdx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Claims Explorer Table Card */}
          <Card className="border-border bg-surface shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-text-secondary" />
                  <CardTitle className="text-sm font-semibold">
                    Case Claims ({claimsData?.total ?? 0})
                  </CardTitle>
                </div>

                {/* Filter Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Status Filter */}
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as VerificationStatus | "ALL");
                      setCurrentPage(1);
                    }}
                    className="h-8 px-2 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    aria-label="Filter by Verification Status"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="SUPPORTED">SUPPORTED</option>
                    <option value="CONTRADICTED">CONTRADICTED</option>
                    <option value="UNVERIFIED">UNVERIFIED</option>
                    <option value="INSUFFICIENT_EVIDENCE">INSUFFICIENT EVIDENCE</option>
                  </select>

                  {/* Claim Type Filter */}
                  <select
                    value={claimTypeFilter}
                    onChange={(e) => {
                      setClaimTypeFilter(e.target.value as ClaimType | "ALL");
                      setCurrentPage(1);
                    }}
                    className="h-8 px-2 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent max-w-[220px]"
                    aria-label="Filter by Claim Type"
                  >
                    {CLAIM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadClaims}
                    disabled={claimsLoading}
                    className="gap-1 h-8 px-2.5"
                    title="Refresh Claims"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${claimsLoading ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {claimsLoading ? (
                <div className="p-8">
                  <LoadingState message="Loading case claims..." />
                </div>
              ) : claimsError ? (
                <div className="p-6">
                  <ErrorState
                    title="Failed to Load Claims"
                    message={claimsError}
                    onRetry={loadClaims}
                  />
                </div>
              ) : !claimsData?.claims || claimsData.claims.length === 0 ? (
                <div className="p-12 text-center">
                  <HelpCircle className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium text-text-primary">No Claims Found</p>
                  <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto">
                    {statusFilter !== "ALL" || claimTypeFilter !== "ALL"
                      ? "No claims match the active filters. Try clearing your filters or refreshing."
                      : "No claims have been extracted for this case yet. Use the extraction panel above to extract grounded claims."}
                  </p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[32%]">Statement & Claim ID</TableHead>
                        <TableHead className="w-[14%]">Type</TableHead>
                        <TableHead className="w-[14%]">Subject / Action</TableHead>
                        <TableHead className="w-[12%]">Source IP</TableHead>
                        <TableHead className="w-[9%]">Confidence</TableHead>
                        <TableHead className="w-[10%]">Status</TableHead>
                        <TableHead className="w-[9%] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claimsData.claims.map((claim) => (
                        <TableRow key={claim.claimId} className="hover:bg-surface-subtle/50 transition-colors">
                          {/* Statement & Claim ID */}
                          <TableCell className="align-top py-3">
                            <div className="space-y-1">
                              <p className="font-medium text-text-primary text-xs leading-snug line-clamp-2">
                                {claim.statement}
                              </p>
                              <div className="flex items-center gap-2 text-[11px] font-mono text-text-muted">
                                <span>{claim.claimId}</span>
                                <span>•</span>
                                <span>{formatDateTime(claim.createdAt)}</span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Type */}
                          <TableCell className="align-top py-3">
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface-subtle border border-border/60 text-text-secondary">
                              {claim.claimType}
                            </span>
                          </TableCell>

                          {/* Subject / Action */}
                          <TableCell className="align-top py-3 text-xs">
                            <div className="space-y-0.5 font-mono text-[11px]">
                              {claim.subject && (
                                <p className="text-text-primary font-medium">{claim.subject}</p>
                              )}
                              <p className="text-text-muted">{claim.action}</p>
                            </div>
                          </TableCell>

                          {/* Source IP / Port */}
                          <TableCell className="align-top py-3 font-mono text-[11px] text-text-secondary">
                            {claim.sourceIp ? (
                              <span>
                                {claim.sourceIp}
                                {claim.sourcePort ? `:${claim.sourcePort}` : ""}
                              </span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </TableCell>

                          {/* Confidence */}
                          <TableCell className="align-top py-3 text-xs">
                            {formatConfidence(claim.confidence)}
                          </TableCell>

                          {/* Status */}
                          <TableCell className="align-top py-3">
                            <ClaimStatusBadge status={claim.currentStatus} />
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="align-top py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-1">
                              {/* Inspect */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setInspectedClaim(claim);
                                  setInspectorTab("details");
                                }}
                                className="h-7 px-2 text-xs text-text-secondary hover:text-text-primary"
                                title="Inspect Claim Details & Citations"
                                aria-label="Inspect Claim Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>

                              {/* Verify */}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => promptVerify(claim)}
                                disabled={isVerifying}
                                className="h-7 px-2 text-xs gap-1"
                                title="Deterministically Verify Claim"
                                aria-label="Verify Claim"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                                <span>Verify</span>
                              </Button>

                              {/* History */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setInspectedClaim(claim);
                                  setInspectorTab("history");
                                }}
                                className="h-7 px-2 text-xs text-text-secondary hover:text-text-primary"
                                title="View Verification Audit History"
                                aria-label="View Verification History"
                              >
                                <History className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination Bar */}
                  <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-text-muted">
                    <span>
                      Page <strong className="text-text-primary">{claimsData.page}</strong> of{" "}
                      <strong className="text-text-primary">{claimsData.totalPages}</strong> (Total:{" "}
                      {claimsData.total} claims)
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={claimsData.page <= 1 || claimsLoading}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="gap-1 h-7 px-2"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Previous</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={claimsData.page >= claimsData.totalPages || claimsLoading}
                        onClick={() => setCurrentPage((p) => p + 1)}
                        className="gap-1 h-7 px-2"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Verification Confirmation Modal */}
      {confirmVerifyClaim && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-modal-title"
        >
          <div className="bg-surface border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-accent-subtle text-accent-text shrink-0 mt-0.5">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 id="verify-modal-title" className="text-sm font-semibold text-text-primary">
                  Confirm Deterministic Claim Verification
                </h3>
                <p className="text-xs text-text-muted">
                  ForensicLens will evaluate this claim against immutable case databases using pre-defined, read-only SQL predicates.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-surface-subtle border border-border/60 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-text-muted font-mono text-[11px]">
                <span>ID: {confirmVerifyClaim.claimId}</span>
                <span>Type: {confirmVerifyClaim.claimType}</span>
              </div>
              <p className="font-semibold text-text-primary">
                {confirmVerifyClaim.statement}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-800 dark:text-blue-300 space-y-1">
              <p className="font-semibold text-blue-900 dark:text-blue-200">
                Deterministic Audit Integrity
              </p>
              <p>
                The verification outcome will be appended permanently to the immutable case audit trail.
                Neither the LLM nor the investigator can override deterministic rule logic.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmVerifyClaim(null)}
                disabled={isVerifying}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => executeVerification(confirmVerifyClaim)}
                disabled={isVerifying}
                className="gap-1.5"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Evaluating Predicates...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Run Verification</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Detail Inspector Modal */}
      {inspectedClaim && currentCase?.caseId && (
        <ClaimDetailInspector
          claim={inspectedClaim}
          caseId={currentCase.caseId}
          onClose={() => setInspectedClaim(null)}
          onVerify={executeVerification}
          isVerifying={isVerifying}
          initialTab={inspectorTab}
        />
      )}
    </div>
  );
}
