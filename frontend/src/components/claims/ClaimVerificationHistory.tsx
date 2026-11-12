import { useState } from "react";
import { ChevronDown, ChevronRight, History, AlertTriangle, ShieldAlert, CheckCircle2, FileCode } from "lucide-react";
import { ClaimVerificationResult } from "@/types/claims";
import { ClaimStatusBadge, CLAIM_STATUS_META } from "@/components/ui/Badge";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { Notice } from "@/components/common/Notice";
import { EvidenceText } from "@/components/ui/DataDisplay";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface ClaimVerificationHistoryProps {
  history: ClaimVerificationResult[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const railTone: Record<string, string> = {
  SUPPORTED: "border-status-success text-status-success",
  CONTRADICTED: "border-status-danger text-status-danger",
  INSUFFICIENT_EVIDENCE: "border-status-warning text-status-warning",
  UNVERIFIED: "border-border-strong text-text-muted",
};

/**
 * Append-only verification audit trail, newest first (backend order).
 */
export function ClaimVerificationHistory({ history, loading = false, error = null, onRetry }: ClaimVerificationHistoryProps) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpand = (verificationId: string) => {
    setExpandedItems((prev) => ({ ...prev, [verificationId]: !prev[verificationId] }));
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
    );
  }

  if (error) {
    return <ErrorState inline title="Could not load verification history" message={error} onRetry={onRetry} />;
  }

  if (!history || history.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="Not verified yet"
        description="Run deterministic verification to evaluate this claim against stored case evidence. Each run is appended here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Append-only audit trail">
        Verification records cannot be edited or removed. Outcomes reflect deterministic predicate evaluation against the
        case database and do not by themselves attribute actions to a physical person.
      </Notice>

      <ol className="relative space-y-3 pl-6" aria-label="Verification runs, newest first">
        <span className="absolute bottom-2 left-[9px] top-2 w-px bg-border" aria-hidden="true" />
        {history.map((record, index) => {
          const isExpanded = !!expandedItems[record.verificationId];
          const Meta = CLAIM_STATUS_META[record.status] ?? CLAIM_STATUS_META.UNVERIFIED;
          const Icon = Meta.icon;
          const hasDetails =
            (record.resolvedParameters && Object.keys(record.resolvedParameters).length > 0) ||
            (record.supportingRecords && record.supportingRecords.length > 0) ||
            (record.contradictingRecords && record.contradictingRecords.length > 0);
          const detailsId = `vr-details-${record.verificationId || index}`;

          return (
            <li key={record.verificationId || index} className="relative">
              <span
                className={cn(
                  "absolute -left-6 top-3 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-surface",
                  railTone[record.status] ?? railTone.UNVERIFIED
                )}
                aria-hidden="true"
              >
                <Icon className="h-2.5 w-2.5" />
              </span>

              <article className="rounded-md border border-border bg-surface">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClaimStatusBadge status={record.status} />
                    {index === 0 && (
                      <span className="rounded-sm border border-accent/30 bg-accent-subtle px-1 text-2xs font-medium text-accent-text">
                        Latest
                      </span>
                    )}
                    <span className="font-mono text-xs text-text-primary">{record.ruleId}</span>
                    <span className="font-mono text-2xs text-text-muted">v{record.ruleVersion}</span>
                  </div>
                  <time className="font-mono text-2xs text-text-muted" dateTime={record.verifiedAt}>
                    {formatDateTime(record.verifiedAt)}
                  </time>
                </header>

                <div className="space-y-2.5 px-3 py-2.5 text-xs">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <div>
                      <dt className="label-caps">Predicate</dt>
                      <dd className="font-mono text-text-primary">{record.predicateType}</dd>
                    </div>
                    <div>
                      <dt className="label-caps">Matched rows</dt>
                      <dd className="font-mono text-text-primary">{record.matchedRowCount}</dd>
                    </div>
                    <div>
                      <dt className="label-caps">Engine</dt>
                      <dd className="font-mono text-text-secondary">v{record.verifierVersion}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="label-caps">Evidence files</dt>
                      <dd className="truncate font-mono text-text-secondary" title={record.evidenceRefs?.join(", ")}>
                        {record.evidenceRefs?.length ? record.evidenceRefs.join(", ") : "—"}
                      </dd>
                    </div>
                  </dl>

                  {record.explanation && <p className="leading-relaxed text-text-secondary">{record.explanation}</p>}

                  {record.failureReason && record.status !== "SUPPORTED" && (
                    <p className="flex items-start gap-1.5 text-status-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="font-medium">Reason:</span> {record.failureReason}
                      </span>
                    </p>
                  )}

                  {record.discrepancies && record.discrepancies.length > 0 && (
                    <div className="rounded border border-status-danger/30 bg-status-danger-bg px-2.5 py-2">
                      <p className="mb-1 flex items-center gap-1.5 font-medium text-status-danger">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        Discrepancies ({record.discrepancies.length})
                      </p>
                      <ul className="list-disc space-y-0.5 pl-5 text-text-secondary">
                        {record.discrepancies.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {hasDetails && (
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleExpand(record.verificationId)}
                        aria-expanded={isExpanded}
                        aria-controls={detailsId}
                        className="inline-flex items-center gap-1 rounded text-2xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                        Technical details and matched records
                      </button>

                      {isExpanded && (
                        <div id={detailsId} className="mt-2 space-y-3">
                          {record.resolvedParameters && Object.keys(record.resolvedParameters).length > 0 && (
                            <div>
                              <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-text-secondary">
                                <FileCode className="h-3 w-3" aria-hidden="true" />
                                Evaluated parameters
                              </p>
                              <EvidenceText wrap={false}>{JSON.stringify(record.resolvedParameters, null, 2)}</EvidenceText>
                            </div>
                          )}
                          {record.supportingRecords && record.supportingRecords.length > 0 && (
                            <div>
                              <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-status-success">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                Supporting records ({record.supportingRecords.length})
                              </p>
                              <EvidenceText wrap={false} maxHeightClass="max-h-40">
                                {JSON.stringify(record.supportingRecords, null, 2)}
                              </EvidenceText>
                            </div>
                          )}
                          {record.contradictingRecords && record.contradictingRecords.length > 0 && (
                            <div>
                              <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-status-danger">
                                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                                Contradicting records ({record.contradictingRecords.length})
                              </p>
                              <EvidenceText wrap={false} maxHeightClass="max-h-40">
                                {JSON.stringify(record.contradictingRecords, null, 2)}
                              </EvidenceText>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
