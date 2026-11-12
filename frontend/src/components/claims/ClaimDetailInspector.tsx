import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowRight,
  Cpu,
  ExternalLink,
  FileText,
  History,
  Layers,
  ShieldCheck,
  X,
  Link2,
} from "lucide-react";
import type { Claim, ClaimVerificationResult, EvidenceReference, EvidenceRole } from "@/types/claims";
import { ClaimStatusBadge, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Dialog";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { IdValue, KeyValueGrid, EvidenceText } from "@/components/ui/DataDisplay";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDateTime, describeError } from "@/lib/formatters";
import { getClaimHistory } from "@/services/claims";
import { cn } from "@/lib/utils";
import { ClaimVerificationHistory } from "./ClaimVerificationHistory";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";

type LegacyTab = "details" | "provenance" | "history";
type InspectorTab = "overview" | "evidence" | "history";

const fromLegacy = (t: LegacyTab | InspectorTab): InspectorTab =>
  t === "details" ? "overview" : t === "provenance" ? "evidence" : t;

interface ClaimDetailInspectorProps {
  claim: Claim | null;
  caseId: string;
  onClose: () => void;
  onVerify?: (claim: Claim) => Promise<void>;
  isVerifying?: boolean;
  initialTab?: LegacyTab | InspectorTab;
  /** "drawer" overlays the page; "panel" docks beside the claim list */
  variant?: "drawer" | "panel";
  /** Increment to force reloading verification history (e.g. after a verify run) */
  refreshKey?: number;
}

/**
 * Citation roles are assigned by the claim extractor (model output, see
 * backend app/verification/extractor.py) — NOT by deterministic verification.
 * They are therefore rendered with neutral styling; verification outcomes are
 * shown only from the verification history.
 */
const ROLE_GROUPS: { id: string; label: string; short: string; roles: EvidenceRole[]; icon: React.ReactNode; empty: string }[] = [
  {
    id: "supporting",
    label: "Cited as primary / supporting",
    short: "Primary / supporting",
    roles: ["PRIMARY_CITING", "SUPPORTING"],
    icon: <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />,
    empty: "No citations with a primary or supporting role.",
  },
  {
    id: "contradicting",
    label: "Cited as contradicting",
    short: "Contradicting",
    roles: ["CONTRADICTING"],
    icon: <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />,
    empty: "No citations with a contradicting role.",
  },
  {
    id: "context",
    label: "Cited as correlated / context",
    short: "Context",
    roles: ["CORRELATED", "CONTEXT"],
    icon: <Layers className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />,
    empty: "No citations with a correlated or context role.",
  },
];

const ROLE_LABEL: Record<EvidenceRole, string> = {
  PRIMARY_CITING: "Primary",
  SUPPORTING: "Supporting",
  CONTRADICTING: "Contradicting",
  CORRELATED: "Correlated",
  CONTEXT: "Context",
};

function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-text-muted" title="The extractor did not produce a confidence score">
        Not provided
      </span>
    );
  }
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs">
        {pct}% <span className="text-text-muted">({value.toFixed(2)})</span>
      </span>
    </span>
  );
}

function CitationCard({ citation, onInspectEvent }: { citation: EvidenceReference; onInspectEvent: (id: string) => void }) {
  const loc = [
    citation.recordNo != null ? `rec #${citation.recordNo}` : null,
    citation.lineNumber != null ? `line ${citation.lineNumber}` : null,
    citation.byteStart != null ? `bytes ${citation.byteStart}–${citation.byteEnd ?? "?"}` : null,
  ].filter(Boolean);

  return (
    <li className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" title="Role assigned by the extractor, not by verification">
            {ROLE_LABEL[citation.role] ?? citation.role}
          </Badge>
          <span className="truncate font-mono text-xs text-text-primary" title={citation.evidenceId}>
            {citation.evidenceId}
          </span>
          {loc.length > 0 && <span className="font-mono text-2xs text-text-muted">{loc.join(" · ")}</span>}
        </div>
        <div className="flex items-center gap-2">
          {citation.relevanceScore != null && (
            <span className="font-mono text-2xs text-text-muted" title="Retrieval relevance score">
              score {citation.relevanceScore.toFixed(3)}
            </span>
          )}
          {citation.eventId && (
            <Button variant="outline" size="xs" onClick={() => onInspectEvent(citation.eventId!)}>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Event
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5 px-3 py-2">
        {citation.snippet ? (
          <EvidenceText maxHeightClass="max-h-32">{citation.snippet}</EvidenceText>
        ) : (
          <p className="text-2xs text-text-muted">No verbatim snippet stored for this citation.</p>
        )}
        {(citation.rawRecordId || citation.eventId) && (
          <p className="flex flex-wrap gap-x-3 font-mono text-2xs text-text-muted">
            {citation.rawRecordId && <span>raw {citation.rawRecordId}</span>}
            {citation.eventId && <span>event {citation.eventId}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

export function ClaimDetailInspector({
  claim,
  caseId,
  onClose,
  onVerify,
  isVerifying = false,
  initialTab = "overview",
  variant = "drawer",
  refreshKey = 0,
}: ClaimDetailInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>(fromLegacy(initialTab));
  const [history, setHistory] = useState<ClaimVerificationResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [inspectedEventId, setInspectedEventId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(fromLegacy(initialTab));
  }, [claim?.claimId, initialTab]);

  const loadHistory = useCallback(
    (isCurrent: () => boolean = () => true) => {
      if (!claim) return;
      setHistoryLoading(true);
      setHistoryError(null);
      getClaimHistory(caseId, claim.claimId)
        .then((res) => {
          if (isCurrent()) setHistory(res);
        })
        .catch((err) => {
          if (isCurrent()) setHistoryError(describeError(err, "Failed to load verification history"));
        })
        .finally(() => {
          if (isCurrent()) setHistoryLoading(false);
        });
    },
    [claim?.claimId, caseId]
  );

  // Load history whenever the claim changes or a verification run completes,
  // so the latest deterministic outcome is visible on the overview.
  useEffect(() => {
    if (!claim) return;
    let current = true;
    setHistory([]);
    loadHistory(() => current);
    return () => {
      current = false;
    };
  }, [claim?.claimId, refreshKey, loadHistory]);

  const refs = useMemo(() => claim?.evidenceReferences ?? [], [claim]);
  const grouped = useMemo(
    () => ROLE_GROUPS.map((g) => ({ ...g, items: refs.filter((r) => g.roles.includes(r.role)) })),
    [refs]
  );

  if (!claim) return null;

  const latest = history[0];
  const idPrefix = `claim-${claim.claimId}`;

  /* ---------------------------- content ---------------------------- */

  const assertion = (
    <div className="rounded-md border border-border bg-surface-subtle p-3">
      <p className="label-caps mb-2">Asserted fact</p>
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded border border-border bg-surface px-2 py-1 text-text-primary" title="Subject">
          {claim.subject || <span className="text-text-disabled">subject —</span>}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        <span className="rounded border border-accent/40 bg-accent-subtle px-2 py-1 text-accent-text" title="Action">
          {claim.action}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        <span className="rounded border border-border bg-surface px-2 py-1 text-text-primary" title="Object">
          {claim.object || <span className="text-text-disabled">object —</span>}
        </span>
      </div>
      {(claim.sourceIp || claim.destinationIp) && (
        <p className="mt-2 font-mono text-2xs text-text-muted">
          {claim.sourceIp ?? "?"}
          {claim.sourcePort != null ? `:${claim.sourcePort}` : ""} → {claim.destinationIp ?? "?"}
        </p>
      )}
    </div>
  );

  const latestBlock = historyLoading && history.length === 0 ? (
    <Skeleton className="h-20 w-full" />
  ) : historyError ? (
    <p className="rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2 text-xs text-status-danger">
      Could not load verification result: {historyError}
    </p>
  ) : latest ? (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={latest.status} />
          <span className="font-mono text-xs text-text-primary">{latest.ruleId}</span>
          <span className="font-mono text-2xs text-text-muted">v{latest.ruleVersion}</span>
        </div>
        <time className="font-mono text-2xs text-text-muted" dateTime={latest.verifiedAt}>
          {formatDateTime(latest.verifiedAt)}
        </time>
      </div>
      <div className="space-y-2 px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            <span className="text-text-muted">Matched rows </span>
            <span className="font-mono text-text-primary">{latest.matchedRowCount}</span>
          </span>
          <span>
            <span className="text-text-muted">Supporting </span>
            <span className="font-mono text-status-success">{latest.supportingRecords?.length ?? 0}</span>
          </span>
          <span>
            <span className="text-text-muted">Contradicting </span>
            <span className="font-mono text-status-danger">{latest.contradictingRecords?.length ?? 0}</span>
          </span>
          <span>
            <span className="text-text-muted">Predicate </span>
            <span className="font-mono text-text-secondary">{latest.predicateType}</span>
          </span>
        </div>
        {latest.explanation && <p className="leading-relaxed text-text-secondary">{latest.explanation}</p>}
        {latest.failureReason && latest.status !== "SUPPORTED" && (
          <p className="text-status-warning">Reason: {latest.failureReason}</p>
        )}
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className="rounded text-2xs font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Full verification history ({history.length})
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-3">
      <p className="text-xs text-text-muted">This claim has not been verified. Status remains UNVERIFIED until a deterministic run completes.</p>
      {onVerify && (
        <Button size="sm" variant="primary" onClick={() => onVerify(claim)} loading={isVerifying}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Verify
        </Button>
      )}
    </div>
  );

  const overview = (
    <div className="space-y-5">
      {assertion}

      <section aria-labelledby={`${idPrefix}-latest`}>
        <h3 id={`${idPrefix}-latest`} className="label-caps mb-2">
          Latest deterministic verification
        </h3>
        {latestBlock}
      </section>

      <section aria-labelledby={`${idPrefix}-trace`}>
        <h3 id={`${idPrefix}-trace`} className="label-caps mb-2 flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Extraction citations
        </h3>
        <p className="mb-2 text-2xs text-text-muted">
          Citation roles are assigned by the extractor. Only the deterministic verification above establishes support or
          contradiction.
        </p>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
          {grouped.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveTab("evidence")}
              className="bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="flex items-center gap-1.5 text-2xs text-text-muted">
                {g.icon}
                {g.short}
              </span>
              <span className="mt-0.5 block font-mono text-lg font-semibold text-text-primary">{g.items.length}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby={`${idPrefix}-fields`}>
        <h3 id={`${idPrefix}-fields`} className="label-caps mb-2">
          Claim fields
        </h3>
        <KeyValueGrid
          columns={2}
          items={[
            { label: "Claim type", value: claim.claimType, mono: true },
            { label: "Confidence", value: <Confidence value={claim.confidence} /> },
            { label: "Claimed timestamp", value: claim.timestampClaimed ? formatDateTime(claim.timestampClaimed) : null, mono: true },
            {
              label: "Claimed window",
              value:
                claim.timeRangeStart || claim.timeRangeEnd
                  ? `${claim.timeRangeStart ? formatDateTime(claim.timeRangeStart) : "—"} → ${claim.timeRangeEnd ? formatDateTime(claim.timeRangeEnd) : "—"}`
                  : null,
              mono: true,
            },
            {
              label: "Source",
              value: claim.sourceIp ? `${claim.sourceIp}${claim.sourcePort != null ? `:${claim.sourcePort}` : ""}` : null,
              mono: true,
            },
            { label: "Destination", value: claim.destinationIp, mono: true },
          ]}
        />
      </section>

      <section aria-labelledby={`${idPrefix}-prov`}>
        <h3 id={`${idPrefix}-prov`} className="label-caps mb-2 flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
          Extraction provenance
        </h3>
        <KeyValueGrid
          columns={2}
          items={[
            { label: "Method", value: claim.extractionMethod, mono: true },
            { label: "Compiler version", value: claim.compilerVersion, mono: true },
            { label: "Extracted (UTC)", value: formatDateTime(claim.createdAt), mono: true },
            { label: "Investigation", value: claim.investigationId, mono: true },
          ]}
        />
        {claim.attributes && Object.keys(claim.attributes).length > 0 && (
          <details className="group mt-3 rounded border border-border-subtle">
            <summary className="cursor-pointer px-3 py-1.5 text-2xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Structured attributes ({Object.keys(claim.attributes).length})
            </summary>
            <div className="border-t border-border-subtle p-2">
              <EvidenceText wrap={false}>{JSON.stringify(claim.attributes, null, 2)}</EvidenceText>
            </div>
          </details>
        )}
      </section>
    </div>
  );

  const evidenceTab = (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Citations attached at extraction time, grouped by the role the extractor assigned. Roles are not verification
        results. Snippets are verbatim, untrusted evidence text.
        {latest && (
          <>
            {" "}
            The latest deterministic run matched <span className="font-mono text-text-primary">{latest.matchedRowCount}</span> row(s) —{" "}
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className="rounded text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              inspect matched records
            </button>
            .
          </>
        )}
      </p>
      {refs.length === 0 ? (
        <EmptyState icon={<FileText />} title="No citations" description="No evidence references are attached to this claim." />
      ) : (
        grouped.map((g) => (
          <section key={g.id} aria-labelledby={`${idPrefix}-g-${g.id}`}>
            <h3 id={`${idPrefix}-g-${g.id}`} className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
              {g.icon}
              {g.label}
              <span className="font-mono text-2xs font-normal text-text-muted">{g.items.length}</span>
            </h3>
            {g.items.length === 0 ? (
              <p className="rounded border border-dashed border-border px-3 py-2 text-2xs text-text-muted">{g.empty}</p>
            ) : (
              <ul className="space-y-2">
                {g.items.map((c, i) => (
                  <CitationCard key={c.claimEvidenceId || `${g.id}-${i}`} citation={c} onInspectEvent={setInspectedEventId} />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );

  const tabs = (
    <Tabs<InspectorTab>
      label="Claim inspector sections"
      idPrefix={idPrefix}
      value={activeTab}
      onChange={setActiveTab}
      items={[
        { id: "overview", label: "Overview", icon: <FileText /> },
        { id: "evidence", label: "Evidence", icon: <Layers />, count: refs.length },
        { id: "history", label: "History", icon: <History />, count: historyLoading ? undefined : history.length },
      ]}
    />
  );

  const body = (
    <>
      {activeTab === "overview" && (
        <TabPanel idPrefix={idPrefix} id="overview">
          {overview}
        </TabPanel>
      )}
      {activeTab === "evidence" && (
        <TabPanel idPrefix={idPrefix} id="evidence">
          {evidenceTab}
        </TabPanel>
      )}
      {activeTab === "history" && (
        <TabPanel idPrefix={idPrefix} id="history">
          <ClaimVerificationHistory history={history} loading={historyLoading} error={historyError} onRetry={() => loadHistory()} />
        </TabPanel>
      )}
    </>
  );

  const verifyButton = onVerify && (
    <Button variant="primary" size="sm" onClick={() => onVerify(claim)} loading={isVerifying}>
      {!isVerifying && <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
      {isVerifying ? "Verifying…" : history.length > 0 ? "Re-verify" : "Verify"}
    </Button>
  );

  const eyebrow = (
    <>
      <ClaimStatusBadge status={claim.currentStatus} />
      <Badge variant="outline" mono>
        {claim.claimType}
      </Badge>
      <IdValue value={claim.claimId} label="claim ID" className="text-text-muted" />
    </>
  );

  const nested = inspectedEventId && (
    <EventInspectorModal eventId={inspectedEventId} caseId={caseId} onClose={() => setInspectedEventId(null)} />
  );

  if (variant === "panel") {
    return (
      <>
        <aside
          aria-label="Claim inspector"
          className="flex max-h-[calc(100vh-7rem)] min-h-[420px] flex-col overflow-hidden rounded-md border border-border bg-surface"
        >
          <header className="shrink-0 space-y-1.5 border-b border-border px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">{eyebrow}</div>
              <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close claim inspector">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
            <h2 className="break-words text-sm font-semibold leading-snug text-text-primary">{claim.statement}</h2>
            {verifyButton && <div className="pt-1">{verifyButton}</div>}
          </header>
          <div className="shrink-0 border-b border-border">{tabs}</div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4")}>{body}</div>
        </aside>
        {nested}
      </>
    );
  }

  return (
    <>
      <Drawer
        open={!!claim}
        onClose={onClose}
        width="xl"
        eyebrow={eyebrow}
        title={claim.statement}
        headerActions={verifyButton}
        subheader={tabs}
        footer={
          <span className="text-2xs text-text-muted">
            Case <span className="font-mono text-text-secondary">{caseId}</span>
          </span>
        }
      >
        {body}
      </Drawer>
      {nested}
    </>
  );
}
