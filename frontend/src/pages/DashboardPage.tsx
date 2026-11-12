import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  FolderKanban,
  HardDrive,
  ListTree,
  ShieldCheck,
  Upload,
  HelpCircle,
  Cpu,
  CheckCircle2,
} from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { CaseStatusBadge, ClaimStatusBadge, ParserStatusBadge, Badge } from "@/components/ui/Badge";
import { StatTile, DistributionBar, KeyValueList, HashValue } from "@/components/ui/DataDisplay";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Skeleton, TableSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { getEvidenceFiles } from "@/services/evidence";
import { getCaseClaims } from "@/services/claims";
import { getRetrievalStatus } from "@/services/retrieval";
import { isApiMode } from "@/services/apiClient";
import type { EvidenceFile } from "@/types/evidence";
import type { Claim, ClaimListResponse } from "@/types/claims";
import type { RetrievalStatusResponse } from "@/types/retrieval";
import { describeError, formatBytes, formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface AsyncSection<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const initial = <T,>(): AsyncSection<T> => ({ data: null, loading: true, error: null });

function errMsg(err: unknown, fallback: string) {
  return describeError(err, fallback);
}

export function DashboardPage() {
  const { cases, currentCase, isLoading: casesLoading, error: casesError, refreshCases } = useCase();
  const caseId = currentCase?.caseId;

  const [evidence, setEvidenceState] = useState<AsyncSection<EvidenceFile[]>>(initial);
  const [claims, setClaimsState] = useState<AsyncSection<{ list: ClaimListResponse; recent: Claim[] }>>(initial);
  const [index, setIndexState] = useState<AsyncSection<RetrievalStatusResponse>>(initial);

  // Generation counter: responses from a previous case (or a superseded reload)
  // must never be written into the panels of the currently selected case.
  const generation = useRef(0);

  const loadCaseSections = useCallback(async () => {
    const gen = ++generation.current;
    const live = () => gen === generation.current;
    const setEvidence = (v: AsyncSection<EvidenceFile[]>) => live() && setEvidenceState(v);
    const setClaims = (v: AsyncSection<{ list: ClaimListResponse; recent: Claim[] }>) => live() && setClaimsState(v);
    const setIndex = (v: AsyncSection<RetrievalStatusResponse>) => live() && setIndexState(v);

    if (!caseId) {
      setEvidence({ data: null, loading: false, error: null });
      setClaims({ data: null, loading: false, error: null });
      setIndex({ data: null, loading: false, error: null });
      return;
    }
    setEvidence(initial());
    setClaims(initial());
    setIndex(initial());

    const evidenceP = getEvidenceFiles(caseId)
      .then((d) => setEvidence({ data: d, loading: false, error: null }))
      .catch((e) => setEvidence({ data: null, loading: false, error: errMsg(e, "Failed to load evidence") }));

    const claimsP = (async () => {
      try {
        const first = await getCaseClaims(caseId, { page: 1, pageSize: 5 });
        // Backend orders claims oldest-first; read the last page for the newest entries.
        let pool = first.claims;
        if (first.totalPages > 1) {
          const last = await getCaseClaims(caseId, { page: first.totalPages, pageSize: 5 });
          pool = [...last.claims];
        }
        const recent = [...pool].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);
        setClaims({ data: { list: first, recent }, loading: false, error: null });
      } catch (e) {
        setClaims({ data: null, loading: false, error: errMsg(e, "Failed to load claims") });
      }
    })();

    const indexP = getRetrievalStatus(caseId)
      .then((d) => setIndex({ data: d, loading: false, error: null }))
      .catch((e) => setIndex({ data: null, loading: false, error: errMsg(e, "Failed to load index status") }));

    await Promise.allSettled([evidenceP, claimsP, indexP]);
  }, [caseId]);

  useEffect(() => {
    void loadCaseSections();
  }, [loadCaseSections]);

  const totals = useMemo(
    () => ({
      cases: cases.length,
      open: cases.filter((c) => c.status === "OPEN").length,
      evidence: cases.reduce((s, c) => s + (c.evidenceCount || 0), 0),
      events: cases.reduce((s, c) => s + (c.eventsCount || 0), 0),
    }),
    [cases]
  );

  const recentEvidence = useMemo(
    () =>
      [...(evidence.data ?? [])].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 6),
    [evidence.data]
  );

  const recentCases = useMemo(
    () => [...cases].sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || "")).slice(0, 5),
    [cases]
  );

  const summary = claims.data?.list.summary;
  const claimTotal = claims.data?.list.total ?? 0;
  const pending = summary?.UNVERIFIED ?? 0;

  /* ---------------------------------------------------------------- */

  if (casesError && cases.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState title="Could not load cases" message={casesError} onRetry={refreshCases} />
      </>
    );
  }

  const workflow: { step: number; label: string; detail: string; to: string; count?: string }[] = [
    {
      step: 1,
      label: "Ingest evidence",
      detail: "Hash and store artifacts read-only",
      to: "/evidence",
      count: currentCase ? `${currentCase.evidenceCount} files` : undefined,
    },
    {
      step: 2,
      label: "Explore parsed events",
      detail: "Filter normalized records with provenance",
      to: "/events",
      count: currentCase ? `${currentCase.eventsCount.toLocaleString()} events` : undefined,
    },
    {
      step: 3,
      label: "Reconstruct timeline",
      detail: "Chronological order and sessions",
      to: "/timeline",
    },
    {
      step: 4,
      label: "Retrieve evidence",
      detail: "Hybrid lexical + semantic search",
      to: "/retrieval",
      count: index.data && isApiMode ? `${index.data.indexStatus.toLowerCase()}` : undefined,
    },
    {
      step: 5,
      label: "Extract & verify claims",
      detail: "Deterministic verification against evidence",
      to: "/claims",
      count: claims.data ? `${claimTotal} claims` : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description={
          isApiMode
            ? "Repository totals and the state of the active investigation. All figures come from the case database."
            : "Fixture mode: figures below come from bundled sample data, not from any case database."
        }
        actions={
          <>
            <LinkButton to="/evidence" variant="secondary" size="sm">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Ingest evidence
            </LinkButton>
            <LinkButton to="/claims" variant="primary" size="sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Verify claims
            </LinkButton>
          </>
        }
      />

      {/* Metric row */}
      <section aria-label="Key figures" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {casesLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-md" />)
        ) : (
          <>
            <StatTile
              label="Cases"
              value={totals.cases}
              hint={`${totals.open} open`}
              icon={<FolderKanban />}
            />
            <StatTile
              label="Evidence items"
              value={totals.evidence.toLocaleString()}
              hint="Across all cases"
              icon={<HardDrive />}
            />
            <StatTile
              label="Parsed events"
              value={totals.events.toLocaleString()}
              hint="Across all cases"
              icon={<ListTree />}
            />
            <StatTile
              label="Claims"
              value={claims.loading ? "…" : claimTotal}
              hint={caseId ? `In ${caseId}` : "No active case"}
              icon={<ShieldCheck />}
              tone="accent"
            />
            <StatTile
              label="Pending verification"
              value={claims.loading ? "…" : pending}
              hint="Unverified claims"
              icon={<HelpCircle />}
              tone={pending > 0 ? "warning" : "default"}
            />
          </>
        )}
      </section>

      {!casesLoading && !currentCase ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No case selected"
          description="Create a case or pick one from the case selector to see its evidence, events and verification state."
          action={
            <LinkButton to="/cases" size="sm">
              Go to cases
            </LinkButton>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {/* Left column */}
          <div className="min-w-0 space-y-5 xl:col-span-2">
            <Panel
              title="Verification status"
              description="Latest deterministic outcome per claim in the active case"
              icon={<ShieldCheck />}
              actions={
                <Link to="/claims" className="text-xs text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
                  Open claim verification
                </Link>
              }
            >
              {claims.loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : claims.error ? (
                <ErrorState inline title="Could not load claims" message={claims.error} onRetry={loadCaseSections} />
              ) : claimTotal === 0 ? (
                <EmptyState
                  bare
                  icon={<ShieldCheck />}
                  title="No claims extracted yet"
                  description={
                    isApiMode
                      ? "Extract claims from retrieved evidence on the Claim Verification page, then verify them deterministically."
                      : "Claim extraction and verification require the live backend API. Fixture mode never fabricates claims."
                  }
                  className="py-6"
                />
              ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
                  <DistributionBar
                    label="Claim verification status"
                    segments={[
                      { key: "SUPPORTED", label: "Supported", value: summary?.SUPPORTED ?? 0, className: "bg-status-success" },
                      { key: "CONTRADICTED", label: "Contradicted", value: summary?.CONTRADICTED ?? 0, className: "bg-status-danger" },
                      { key: "INSUFFICIENT_EVIDENCE", label: "Insufficient", value: summary?.INSUFFICIENT_EVIDENCE ?? 0, className: "bg-status-warning" },
                      { key: "UNVERIFIED", label: "Unverified", value: summary?.UNVERIFIED ?? 0, className: "bg-status-neutral" },
                    ]}
                  />
                  <div className="min-w-0">
                    <h3 className="label-caps mb-1.5">Most recent claims</h3>
                    <ul className="divide-y divide-border-subtle rounded border border-border-subtle">
                      {claims.data?.recent.map((c) => (
                        <li key={c.claimId} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                          <span className="min-w-0">
                            <span className="block truncate text-xs text-text-primary" title={c.statement}>
                              {c.statement}
                            </span>
                            <span className="font-mono text-2xs text-text-muted">{c.claimType}</span>
                          </span>
                          <ClaimStatusBadge status={c.currentStatus} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="Recent evidence ingestion"
              description="Newest artifacts in the active case"
              icon={<HardDrive />}
              flush
              actions={
                <Link to="/evidence" className="text-xs text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
                  All evidence
                </Link>
              }
            >
              {evidence.loading ? (
                <TableSkeleton rows={4} columns={5} label="Loading evidence" />
              ) : evidence.error ? (
                <div className="p-4">
                  <ErrorState inline title="Could not load evidence" message={evidence.error} onRetry={loadCaseSections} />
                </div>
              ) : recentEvidence.length === 0 ? (
                <EmptyState
                  bare
                  icon={<HardDrive />}
                  title="No evidence ingested"
                  description="Ingest a log or artifact to hash it, store it read-only and parse it into events."
                  action={
                    <LinkButton to="/evidence" size="sm" variant="secondary">
                      Ingest evidence
                    </LinkButton>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>SHA-256</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ingested (UTC)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentEvidence.map((ev) => (
                      <TableRow key={ev.evidenceId}>
                        <TableCell className="max-w-[220px]">
                          <span className="block truncate font-mono text-xs" title={ev.originalName}>
                            {ev.originalName}
                          </span>
                          <span className="font-mono text-2xs text-text-muted">{ev.evidenceId}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" mono>
                            {ev.format}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <HashValue value={ev.objectHash} label="SHA-256" leading={8} trailing={6} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-xs text-text-secondary">
                          {formatBytes(ev.objectSizeBytes)}
                        </TableCell>
                        <TableCell>
                          <ParserStatusBadge status={ev.parserStatus} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-2xs text-text-muted">
                          {formatDateTime(ev.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>

          {/* Right column */}
          <div className="min-w-0 space-y-5">
            <Panel
              title="Active case"
              icon={<FolderKanban />}
              actions={currentCase && <CaseStatusBadge status={currentCase.status} />}
            >
              {casesLoading || !currentCase ? (
                <CardSkeleton lines={4} className="border-0 p-0" />
              ) : (
                <>
                  <p className="mb-3 text-sm font-medium text-text-primary">{currentCase.name}</p>
                  {currentCase.description && (
                    <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-text-muted">{currentCase.description}</p>
                  )}
                  <KeyValueList
                    items={[
                      { label: "Case ID", value: currentCase.caseId, mono: true },
                      { label: "Lead examiner", value: currentCase.leadInvestigator },
                      { label: "Created", value: formatDateTime(currentCase.createdAt), mono: true },
                      { label: "Last activity", value: formatDateTime(currentCase.lastActivity), mono: true },
                      {
                        label: "Retrieval index",
                        value: !isApiMode ? (
                          <span className="text-text-muted">Unavailable in fixture mode</span>
                        ) : index.loading ? (
                          <span className="text-text-muted">Checking…</span>
                        ) : index.error ? (
                          <span className="text-status-danger" title={index.error}>
                            Status unavailable
                          </span>
                        ) : index.data ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Cpu className="h-3 w-3 text-text-muted" aria-hidden="true" />
                            <span className="font-mono">{index.data.indexStatus}</span>
                            <span className="font-mono text-text-muted">
                              {index.data.indexedRecords.toLocaleString()}/{index.data.totalRecords.toLocaleString()}
                            </span>
                          </span>
                        ) : null,
                      },
                    ]}
                  />
                  <Link
                    to={`/cases/${encodeURIComponent(currentCase.caseId)}`}
                    className="mt-3 inline-flex items-center gap-1 rounded text-xs text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Case profile <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </>
              )}
            </Panel>

            <Panel title="Investigation workflow" icon={<CheckCircle2 />} flush>
              <ol className="divide-y divide-border-subtle">
                {workflow.map((w) => (
                  <li key={w.step}>
                    <Link
                      to={w.to}
                      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-surface-subtle font-mono text-2xs text-text-muted group-hover:border-accent/50 group-hover:text-accent">
                        {w.step}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-text-primary">{w.label}</span>
                        <span className="block truncate text-2xs text-text-muted">{w.detail}</span>
                      </span>
                      {w.count && <span className="shrink-0 font-mono text-2xs text-text-muted">{w.count}</span>}
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-disabled group-hover:text-text-secondary" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Recent case activity" icon={<FolderKanban />} flush>
              {casesLoading ? (
                <TableSkeleton rows={3} columns={2} />
              ) : recentCases.length === 0 ? (
                <EmptyState bare title="No cases" description="Create a case to begin an investigation." className="py-6" />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {recentCases.map((c) => (
                    <li key={c.caseId}>
                      <Link
                        to={`/cases/${encodeURIComponent(c.caseId)}`}
                        className={cn(
                          "flex items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                          c.caseId === caseId && "bg-accent-subtle/40"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-xs font-medium text-text-primary">{c.caseId}</span>
                          <span className="block truncate text-2xs text-text-muted">{c.name}</span>
                        </span>
                        <span className="shrink-0 text-right font-mono text-2xs text-text-muted">
                          {formatDateTime(c.lastActivity).replace(" UTC", "")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
