import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  SlidersHorizontal,
  Layers,
  ListFilter,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope, FilterBar } from "@/components/layout/PageHeader";
import { Card, Panel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Field } from "@/components/ui/Input";
import { ClaimStatusBadge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { StatTile, Pagination, IdValue } from "@/components/ui/DataDisplay";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Notice } from "@/components/common/Notice";
import { ClaimDetailInspector } from "@/components/claims/ClaimDetailInspector";
import { extractClaims, getCaseClaims, verifyClaim } from "@/services/claims";
import { isApiMode } from "@/services/apiClient";
import type { Claim, ClaimExtractionResponse, ClaimListResponse, ClaimType, VerificationStatus } from "@/types/claims";
import { formatDateTime, describeError } from "@/lib/formatters";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

const CLAIM_TYPES: { label: string; value: ClaimType | "ALL" }[] = [
  { label: "All claim types", value: "ALL" },
  { label: "AUTH_SUCCESS", value: "AUTH_SUCCESS" },
  { label: "AUTH_FAILURE", value: "AUTH_FAILURE" },
  { label: "SESSION_START", value: "SESSION_START" },
  { label: "SESSION_END", value: "SESSION_END" },
  { label: "SESSION_ACTIVITY", value: "SESSION_ACTIVITY" },
  { label: "NETWORK_CONNECTION", value: "NETWORK_CONNECTION" },
  { label: "FILE_ACCESS", value: "FILE_ACCESS" },
  { label: "ACCOUNT_MODIFICATION", value: "ACCOUNT_MODIFICATION" },
  { label: "PROCESS_EXECUTION", value: "PROCESS_EXECUTION" },
  { label: "GENERIC_FORENSIC_EVENT", value: "GENERIC_FORENSIC_EVENT" },
];

const STATUS_TILES: {
  status: VerificationStatus;
  label: string;
  hint: string;
  tone: "success" | "danger" | "warning" | "neutral";
  icon: React.ReactNode;
}[] = [
  { status: "SUPPORTED", label: "Supported", hint: "Predicate matched evidence", tone: "success", icon: <CheckCircle2 /> },
  { status: "CONTRADICTED", label: "Contradicted", hint: "Evidence is incompatible", tone: "danger", icon: <XCircle /> },
  { status: "INSUFFICIENT_EVIDENCE", label: "Insufficient evidence", hint: "No conclusive records", tone: "warning", icon: <AlertTriangle /> },
  { status: "UNVERIFIED", label: "Unverified", hint: "Awaiting verification", tone: "neutral", icon: <HelpCircle /> },
];

function citationCounts(claim: Claim) {
  const refs = claim.evidenceReferences ?? [];
  return {
    supporting: refs.filter((r) => r.role === "PRIMARY_CITING" || r.role === "SUPPORTING").length,
    contradicting: refs.filter((r) => r.role === "CONTRADICTING").length,
    total: refs.length,
  };
}

export function ClaimVerificationPage() {
  const { currentCase } = useCase();
  const docked = useMediaQuery("(min-width: 1280px)");

  // Extraction form state
  const [query, setQuery] = useState("");
  const [retrievalMode, setRetrievalMode] = useState("HYBRID");
  const [retrievalLimit, setRetrievalLimit] = useState(20);
  const [investigationId, setInvestigationId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ClaimExtractionResponse | null>(null);
  const [showExtractionParams, setShowExtractionParams] = useState(false);

  // Claims list & filters
  const [claimsData, setClaimsData] = useState<ClaimListResponse | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "ALL">("ALL");
  const [claimTypeFilter, setClaimTypeFilter] = useState<ClaimType | "ALL">("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Inspector & verification
  const [inspectedClaim, setInspectedClaim] = useState<Claim | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"details" | "provenance" | "history">("details");
  const [confirmVerifyClaim, setConfirmVerifyClaim] = useState<Claim | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

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
      setClaimsError(describeError(err, "Failed to load claims"));
    } finally {
      setClaimsLoading(false);
    }
  }, [currentCase?.caseId, claimTypeFilter, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  // Close the inspector when switching cases
  useEffect(() => {
    setInspectedClaim(null);
  }, [currentCase?.caseId]);

  const handleExtractClaims = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentCase?.caseId) {
      toast.error("Select a forensic case first.");
      return;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      toast.error("Enter a question or hypothesis to extract claims.");
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
        `Extracted ${res.extractedClaims.length} claim(s) grounded in ${res.evidenceRetrievedCount} evidence record(s).`
      );
      setCurrentPage(1);
      await loadClaims();
    } catch (err) {
      toast.error(describeError(err, "Claim extraction failed"));
    } finally {
      setExtracting(false);
    }
  };

  const executeVerification = async (claimToVerify: Claim) => {
    if (!currentCase?.caseId) return;

    setIsVerifying(true);
    try {
      const result = await verifyClaim(currentCase.caseId, claimToVerify.claimId);
      toast.success(`Verification completed: ${result.status}`, { description: `Rule ${result.ruleId}` });
      setConfirmVerifyClaim(null);

      if (inspectedClaim?.claimId === claimToVerify.claimId) {
        setInspectedClaim((prev) => (prev ? { ...prev, currentStatus: result.status } : null));
      }
      setHistoryRefreshKey((k) => k + 1);
      await loadClaims();
    } catch (err) {
      toast.error(describeError(err, "Claim verification failed"));
    } finally {
      setIsVerifying(false);
    }
  };

  const openInspector = (claim: Claim, tab: "details" | "provenance" | "history" = "details") => {
    setInspectedClaim(claim);
    setInspectorTab(tab);
  };

  const summary = claimsData?.summary ?? { SUPPORTED: 0, CONTRADICTED: 0, UNVERIFIED: 0, INSUFFICIENT_EVIDENCE: 0 };
  const totalAll = Object.values(summary).reduce((s, n) => s + (n || 0), 0);
  const filtersActive = statusFilter !== "ALL" || claimTypeFilter !== "ALL";
  const showDocked = docked && !!inspectedClaim && !!currentCase?.caseId;

  return (
    <>
      <PageHeader
        title="Claim Verification"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description="Extract atomic claims grounded in retrieved evidence, then verify each one deterministically against the case database."
        actions={
          <Button variant="outline" size="sm" onClick={loadClaims} disabled={claimsLoading || !currentCase}>
            <RefreshCw className={cn("h-3.5 w-3.5", claimsLoading && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {!currentCase?.caseId ? (
        <EmptyState
          icon={<Layers />}
          title="No case selected"
          description="Select a case from the case selector to extract and verify investigative claims."
        />
      ) : (
        <div className="space-y-5">
          {!isApiMode && (
            <Notice tone="warning" title="Extraction and verification require the live backend">
              The UI is running on fixture data. Claim extraction and deterministic verification are disabled, and no
              claims are fabricated. Set <code className="font-mono">VITE_DATA_MODE=api</code> to connect.
            </Notice>
          )}

          {/* Status distribution — doubles as the status filter */}
          <section aria-label="Verification status filter" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label="All claims"
              value={totalAll}
              hint="Clear status filter"
              icon={<ListFilter />}
              tone="accent"
              active={statusFilter === "ALL"}
              onClick={() => {
                setStatusFilter("ALL");
                setCurrentPage(1);
              }}
            />
            {STATUS_TILES.map((t) => (
              <StatTile
                key={t.status}
                label={t.label}
                value={summary[t.status] ?? 0}
                hint={t.hint}
                icon={t.icon}
                tone={t.tone}
                active={statusFilter === t.status}
                onClick={() => {
                  setStatusFilter((prev) => (prev === t.status ? "ALL" : t.status));
                  setCurrentPage(1);
                }}
              />
            ))}
          </section>

          {/* Extraction */}
          <Panel
            title="Extract grounded claims"
            description="Retrieves candidate evidence for your question and extracts structured atomic claims from it."
            icon={<Sparkles />}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowExtractionParams((p) => !p)}
                aria-expanded={showExtractionParams}
                aria-controls="extraction-options"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Retrieval options
              </Button>
            }
          >
            <form onSubmit={handleExtractClaims} className="space-y-3">
              <label htmlFor="extract-query-input" className="sr-only">
                Investigative question or assertion
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="extract-query-input"
                  placeholder="e.g. Did user admin log in from 192.168.1.50 between 14:00 and 15:00 UTC?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={extracting}
                  className="h-9 flex-1"
                />
                <Button type="submit" variant="primary" disabled={!query.trim() || !isApiMode} loading={extracting} className="h-9">
                  {!extracting && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                  {extracting ? "Extracting…" : "Extract claims"}
                </Button>
              </div>

              {showExtractionParams && (
                <div id="extraction-options" className="grid grid-cols-1 gap-3 rounded border border-border-subtle bg-surface-subtle p-3 md:grid-cols-3">
                  <Field label="Retrieval mode" htmlFor="retrieval-mode-select">
                    <Select id="retrieval-mode-select" value={retrievalMode} onChange={(e) => setRetrievalMode(e.target.value)} disabled={extracting}>
                      <option value="HYBRID">Hybrid — lexical + semantic (RRF)</option>
                      <option value="HYBRID_RERANKED">Hybrid + cross-encoder rerank</option>
                      <option value="KEYWORD_ONLY">Keyword only (FTS5)</option>
                      <option value="SEMANTIC_ONLY">Semantic only (embeddings)</option>
                    </Select>
                  </Field>
                  <Field label="Max evidence documents" htmlFor="retrieval-limit-input" hint="1–100">
                    <Input
                      id="retrieval-limit-input"
                      type="number"
                      min={1}
                      max={100}
                      value={retrievalLimit}
                      onChange={(e) => setRetrievalLimit(Math.max(1, Math.min(100, Number(e.target.value))))}
                      disabled={extracting}
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Investigation ID" htmlFor="investigation-id-input" hint="Optional">
                    <Input
                      id="investigation-id-input"
                      placeholder="e.g. INV-2026-001"
                      value={investigationId}
                      onChange={(e) => setInvestigationId(e.target.value)}
                      disabled={extracting}
                      className="font-mono"
                    />
                  </Field>
                </div>
              )}

              <p className="text-2xs leading-relaxed text-text-muted">
                Extracted claims start as <span className="font-mono text-text-secondary">UNVERIFIED</span>. Verification
                never runs automatically — it is an explicit, deterministic action recorded in the append-only history.
              </p>
            </form>

            {extractionResult && (
              <div className="mt-3 space-y-1.5 rounded border border-accent/30 bg-accent-subtle/50 px-3 py-2.5 text-xs" role="status">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text-primary">
                    {extractionResult.extractedClaims.length} claim(s) extracted from {extractionResult.evidenceRetrievedCount} evidence record(s)
                  </span>
                  <span className="font-mono text-2xs text-text-muted">
                    {extractionResult.extractionMethod}
                    {extractionResult.modelIdentifier ? ` · ${extractionResult.modelIdentifier}` : ""}
                  </span>
                </div>
                {(extractionResult.omittedEvidenceCount > 0 || extractionResult.truncatedEvidenceCount > 0) && (
                  <p className="text-text-secondary">
                    {extractionResult.omittedEvidenceCount > 0 && `${extractionResult.omittedEvidenceCount} record(s) omitted. `}
                    {extractionResult.truncatedEvidenceCount > 0 && `${extractionResult.truncatedEvidenceCount} record(s) truncated for size.`}
                  </p>
                )}
                {extractionResult.warnings?.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-status-warning">
                    {extractionResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          {/* Master–detail workspace */}
          <div className={cn("grid grid-cols-1 gap-5", showDocked && "xl:grid-cols-[minmax(0,1fr)_minmax(400px,38%)]")}>
            <Card className="min-w-0 self-start overflow-hidden">
              <FilterBar>
                <h2 className="mr-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <ShieldCheck className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  Claims
                  <span className="font-mono text-xs font-normal text-text-muted">{claimsData?.total ?? 0}</span>
                </h2>
                <Select
                  aria-label="Filter by verification status"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as VerificationStatus | "ALL");
                    setCurrentPage(1);
                  }}
                  wrapperClassName="w-auto"
                  className="w-48 text-xs"
                >
                  <option value="ALL">All statuses</option>
                  <option value="SUPPORTED">Supported</option>
                  <option value="CONTRADICTED">Contradicted</option>
                  <option value="UNVERIFIED">Unverified</option>
                  <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option>
                </Select>
                <Select
                  aria-label="Filter by claim type"
                  value={claimTypeFilter}
                  onChange={(e) => {
                    setClaimTypeFilter(e.target.value as ClaimType | "ALL");
                    setCurrentPage(1);
                  }}
                  wrapperClassName="w-auto"
                  className="w-56 font-mono text-xs"
                >
                  {CLAIM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStatusFilter("ALL");
                      setClaimTypeFilter("ALL");
                      setCurrentPage(1);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </FilterBar>

              {claimsLoading && !claimsData ? (
                <TableSkeleton rows={6} columns={6} label="Loading claims" />
              ) : claimsError ? (
                <div className="p-4">
                  <ErrorState title="Failed to load claims" message={claimsError} onRetry={loadClaims} />
                </div>
              ) : !claimsData?.claims || claimsData.claims.length === 0 ? (
                <EmptyState
                  bare
                  icon={<ShieldCheck />}
                  title={filtersActive ? "No claims match these filters" : "No claims extracted yet"}
                  description={
                    filtersActive
                      ? "Clear the filters or choose a different status."
                      : isApiMode
                      ? "Ask an investigative question above to extract claims grounded in this case's evidence."
                      : "Claims appear here once extracted through the live backend."
                  }
                  actionLabel={filtersActive ? "Clear filters" : undefined}
                  onAction={
                    filtersActive
                      ? () => {
                          setStatusFilter("ALL");
                          setClaimTypeFilter("ALL");
                          setCurrentPage(1);
                        }
                      : undefined
                  }
                />
              ) : (
                <div className={cn("transition-opacity", claimsLoading && "opacity-60")} aria-busy={claimsLoading}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[150px]">Status</TableHead>
                        <TableHead>Claim</TableHead>
                        {!showDocked && <TableHead className="w-[150px]">Subject · action</TableHead>}
                        {!showDocked && <TableHead className="w-[100px]">Confidence</TableHead>}
                        <TableHead className="w-[110px]" title="Evidence citations attached at extraction">
                          Citations
                        </TableHead>
                        <TableHead className="w-[96px] text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claimsData.claims.map((claim) => {
                        const c = citationCounts(claim);
                        return (
                          <TableRow
                            key={claim.claimId}
                            selected={inspectedClaim?.claimId === claim.claimId}
                            onActivate={() => openInspector(claim)}
                            aria-label={`Inspect claim ${claim.claimId}`}
                            className="align-top"
                          >
                            <TableCell className="align-top">
                              <ClaimStatusBadge status={claim.currentStatus} />
                            </TableCell>
                            <TableCell className="align-top">
                              <p className="line-clamp-2 text-sm leading-snug text-text-primary">{claim.statement}</p>
                              <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-2xs text-text-muted">
                                <span>{claim.claimType}</span>
                                <span>{claim.claimId}</span>
                                <span>{formatDateTime(claim.createdAt).replace(" UTC", "")}</span>
                              </p>
                            </TableCell>
                            {!showDocked && (
                              <TableCell className="align-top font-mono text-xs">
                                <span className="block truncate text-text-primary">{claim.subject || "—"}</span>
                                <span className="block truncate text-text-muted">{claim.action}</span>
                              </TableCell>
                            )}
                            {!showDocked && (
                              <TableCell className="align-top font-mono text-xs">
                                {claim.confidence == null ? (
                                  <span className="text-text-disabled" title="Not provided by extractor">
                                    —
                                  </span>
                                ) : (
                                  `${Math.round(claim.confidence * 100)}%`
                                )}
                              </TableCell>
                            )}
                            <TableCell className="align-top">
                              {/* Extractor-assigned citation roles — neutral styling, not verification results */}
                              <span
                                className="inline-flex items-center gap-1 font-mono text-xs text-text-secondary"
                                title={`${c.total} citation(s): ${c.supporting} cited as primary/supporting, ${c.contradicting} as contradicting (roles assigned by the extractor)`}
                              >
                                <FileText className="h-3 w-3 text-text-muted" aria-hidden="true" />
                                {c.total}
                                {c.contradicting > 0 && <span className="text-text-muted">({c.contradicting} contra)</span>}
                                <span className="sr-only">
                                  {` citations: ${c.supporting} primary or supporting, ${c.contradicting} contradicting, as assigned by the extractor`}
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className="text-right align-top" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setConfirmVerifyClaim(claim)}
                                disabled={isVerifying || !isApiMode}
                                aria-label={`Verify claim ${claim.claimId}`}
                              >
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                Verify
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <Pagination
                    page={claimsData.page}
                    totalPages={claimsData.totalPages}
                    total={claimsData.total}
                    pageSize={claimsData.pageSize}
                    noun="claims"
                    onPageChange={setCurrentPage}
                    disabled={claimsLoading}
                  />
                </div>
              )}
            </Card>

            {showDocked && inspectedClaim && (
              <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
                <ClaimDetailInspector
                  variant="panel"
                  claim={inspectedClaim}
                  caseId={currentCase.caseId}
                  onClose={() => setInspectedClaim(null)}
                  onVerify={isApiMode ? executeVerification : undefined}
                  isVerifying={isVerifying}
                  initialTab={inspectorTab}
                  refreshKey={historyRefreshKey}
                />
              </div>
            )}
          </div>

          {!showDocked && !inspectedClaim && claimsData && claimsData.claims.length > 0 && (
            <p className="text-2xs text-text-muted">Select a claim to inspect its evidence and verification history.</p>
          )}
        </div>
      )}

      {/* Verification confirmation */}
      <ConfirmDialog
        open={!!confirmVerifyClaim}
        onCancel={() => setConfirmVerifyClaim(null)}
        onConfirm={() => confirmVerifyClaim && executeVerification(confirmVerifyClaim)}
        title="Run deterministic verification"
        description="The claim is evaluated against the case database using fixed, read-only predicates."
        confirmLabel={isVerifying ? "Evaluating predicates…" : "Run verification"}
        confirmIcon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
        loading={isVerifying}
      >
        {confirmVerifyClaim && (
          <div className="space-y-3">
            <div className="rounded border border-border bg-surface-subtle px-3 py-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <ClaimStatusBadge status={confirmVerifyClaim.currentStatus} />
                <span className="font-mono text-2xs text-text-muted">{confirmVerifyClaim.claimType}</span>
                <IdValue value={confirmVerifyClaim.claimId} label="claim ID" className="text-text-muted" />
              </div>
              <p className="text-sm text-text-primary">{confirmVerifyClaim.statement}</p>
            </div>
            <Notice tone="info">
              The outcome is appended permanently to this claim's verification history. Neither the language model nor the
              investigator can override the rule result.
            </Notice>
          </div>
        )}
      </ConfirmDialog>

      {/* Drawer inspector on narrower screens */}
      {!docked && inspectedClaim && currentCase?.caseId && (
        <ClaimDetailInspector
          variant="drawer"
          claim={inspectedClaim}
          caseId={currentCase.caseId}
          onClose={() => setInspectedClaim(null)}
          onVerify={isApiMode ? executeVerification : undefined}
          isVerifying={isVerifying}
          initialTab={inspectorTab}
          refreshKey={historyRefreshKey}
        />
      )}
    </>
  );
}
