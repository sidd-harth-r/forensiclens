import { useState } from "react";
import { ClaimVerificationResult } from "@/types/claims";
import { ClaimStatusBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/formatters";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import {
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Info,
  CheckCircle2,
  AlertTriangle,
  History,
  FileCode,
} from "lucide-react";

interface ClaimVerificationHistoryProps {
  history: ClaimVerificationResult[];
  loading?: boolean;
  error?: string | null;
}

export function ClaimVerificationHistory({
  history,
  loading = false,
  error = null,
}: ClaimVerificationHistoryProps) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpand = (verificationId: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [verificationId]: !prev[verificationId],
    }));
  };

  if (loading) {
    return <LoadingState message="Loading verification audit history..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to Load History"
        message={error}
      />
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="py-8 text-center border border-dashed border-border rounded-lg bg-surface-subtle/50">
        <History className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium text-text-primary">No Verification Attempts</p>
        <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto">
          This claim has not been verified yet. Run deterministic verification to evaluate it against immutable case evidence.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Append-only & Attribution Disclaimer Callout */}
      <div className="flex items-start gap-2.5 p-3 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs text-blue-800 dark:text-blue-300">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
        <div className="space-y-1">
          <p className="font-semibold text-blue-900 dark:text-blue-200">
            Immutable Forensic Verification Audit Trail
          </p>
          <p>
            Verification records are append-only and cannot be altered or removed. Outcomes reflect deterministic
            predicate evaluation against forensic case databases.
          </p>
          <p className="font-medium text-blue-900/90 dark:text-blue-200/90 italic">
            Forensic verification outcome does not infer physical human identity attribution.
          </p>
        </div>
      </div>

      {/* History Items in Reverse Chronological Order */}
      <div className="space-y-3">
        {history.map((record, index) => {
          const isExpanded = !!expandedItems[record.verificationId];
          const hasDetails =
            (record.resolvedParameters && Object.keys(record.resolvedParameters).length > 0) ||
            (record.discrepancies && record.discrepancies.length > 0) ||
            (record.supportingRecords && record.supportingRecords.length > 0) ||
            (record.contradictingRecords && record.contradictingRecords.length > 0);

          return (
            <div
              key={record.verificationId || index}
              className="border border-border rounded-lg bg-surface p-4 transition-all hover:border-border/80 shadow-xs"
            >
              {/* Header: Status, Timestamp, Rule */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <ClaimStatusBadge status={record.status} />
                  <span className="font-mono text-xs font-semibold text-text-primary">
                    {record.ruleId}
                  </span>
                  <span className="text-[11px] font-mono text-text-muted">
                    v{record.ruleVersion}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="font-mono">{formatDateTime(record.verifiedAt)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-subtle font-mono text-text-secondary">
                    engine v{record.verifierVersion}
                  </span>
                </div>
              </div>

              {/* Body: Explanation & Predicate */}
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary">
                  <div>
                    <span className="text-text-muted font-medium">Predicate: </span>
                    <span className="font-mono font-medium text-text-primary">{record.predicateType}</span>
                  </div>
                  <div>
                    <span className="text-text-muted font-medium">Matched Records: </span>
                    <span className="font-mono font-semibold text-text-primary">{record.matchedRowCount}</span>
                  </div>
                  {record.evidenceRefs && record.evidenceRefs.length > 0 && (
                    <div>
                      <span className="text-text-muted font-medium">Evidence Files: </span>
                      <span className="font-mono text-text-secondary">
                        {record.evidenceRefs.join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Explanation */}
                {record.explanation && (
                  <p className="text-xs text-text-primary leading-relaxed bg-surface-subtle/50 p-2.5 rounded border border-border/40">
                    {record.explanation}
                  </p>
                )}

                {/* Failure Reason */}
                {record.failureReason && record.status !== "SUPPORTED" && (
                  <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <div>
                      <span className="font-semibold">Reason: </span>
                      <span>{record.failureReason}</span>
                    </div>
                  </div>
                )}

                {/* Discrepancies */}
                {record.discrepancies && record.discrepancies.length > 0 && (
                  <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                      <span>Identified Discrepancies ({record.discrepancies.length})</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1">
                      {record.discrepancies.map((disc, dIdx) => (
                        <li key={dIdx}>{disc}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Expandable Technical Details */}
                {hasDetails && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(record.verificationId)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isExpanded ? "Hide" : "Show"} Technical Verification Details & Records
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2.5 space-y-3 pt-2 border-t border-border/50 animate-in fade-in duration-150">
                        {/* Resolved Parameters */}
                        {record.resolvedParameters && Object.keys(record.resolvedParameters).length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary mb-1">
                              <FileCode className="w-3 h-3" />
                              <span>Evaluated Parameters</span>
                            </div>
                            <pre className="font-mono text-[11px] bg-surface-subtle p-2 rounded border border-border/50 overflow-x-auto text-text-primary">
                              {JSON.stringify(record.resolvedParameters, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Supporting Records Preview */}
                        {record.supportingRecords && record.supportingRecords.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-status-success mb-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Supporting Records ({record.supportingRecords.length})</span>
                            </div>
                            <pre className="font-mono text-[11px] bg-status-success-bg/20 p-2 rounded border border-status-success/20 overflow-x-auto text-text-primary max-h-40">
                              {JSON.stringify(record.supportingRecords, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Contradicting Records Preview */}
                        {record.contradictingRecords && record.contradictingRecords.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-status-danger mb-1">
                              <ShieldAlert className="w-3 h-3" />
                              <span>Contradicting Records ({record.contradictingRecords.length})</span>
                            </div>
                            <pre className="font-mono text-[11px] bg-status-danger-bg/20 p-2 rounded border border-status-danger/20 overflow-x-auto text-text-primary max-h-40">
                              {JSON.stringify(record.contradictingRecords, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
