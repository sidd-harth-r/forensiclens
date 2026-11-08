import { useState, useEffect, useRef } from "react";
import type { Claim, ClaimVerificationResult } from "@/types/claims";
import { ClaimStatusBadge, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/formatters";
import { getClaimHistory } from "@/services/claims";
import { ClaimVerificationHistory } from "./ClaimVerificationHistory";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import {
  FileText,
  X,
  Copy,
  ShieldCheck,
  History,
  Layers,
  ExternalLink,
  Cpu,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface ClaimDetailInspectorProps {
  claim: Claim | null;
  caseId: string;
  onClose: () => void;
  onVerify?: (claim: Claim) => Promise<void>;
  isVerifying?: boolean;
  initialTab?: "details" | "provenance" | "history";
}

export function ClaimDetailInspector({
  claim,
  caseId,
  onClose,
  onVerify,
  isVerifying = false,
  initialTab = "details",
}: ClaimDetailInspectorProps) {
  const [activeTab, setActiveTab] = useState<"details" | "provenance" | "history">(initialTab);
  const [history, setHistory] = useState<ClaimVerificationResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Nested event inspector state
  const [inspectedEventId, setInspectedEventId] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Reset tab when claim changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [claim?.claimId, initialTab]);

  // Focus management and Escape key handling
  useEffect(() => {
    if (!claim) return;

    previousActiveElement.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      if (modalRef.current) {
        modalRef.current.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't close if nested event modal is active
      if (inspectedEventId) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === modalRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
        previousActiveElement.current.focus();
      }
    };
  }, [claim, onClose, inspectedEventId]);

  // Fetch history when history tab is activated
  useEffect(() => {
    if (!claim || activeTab !== "history") return;

    let isCurrent = true;
    setHistoryLoading(true);
    setHistoryError(null);

    getClaimHistory(caseId, claim.claimId)
      .then((res) => {
        if (isCurrent) {
          setHistory(res);
        }
      })
      .catch((err) => {
        if (isCurrent) {
          setHistoryError(err instanceof Error ? err.message : "Failed to load verification history");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setHistoryLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [claim?.claimId, caseId, activeTab]);

  if (!claim) return null;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API is not available");
      }
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard`);
    } catch {
      toast.error(`Failed to copy ${label}`);
    }
  };

  // Safe confidence score formatting: never substitute missing confidence with 1.0 or 0.0
  const renderConfidence = () => {
    if (claim.confidence === null || claim.confidence === undefined) {
      return (
        <span className="text-text-muted italic" title="Extractor did not produce a confidence score">
          Unavailable
        </span>
      );
    }
    const pct = Math.round(claim.confidence * 100);
    return (
      <span className="font-mono font-semibold text-text-primary">
        {pct}% ({claim.confidence.toFixed(2)})
      </span>
    );
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-inspector-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="bg-surface border border-border rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Modal Header */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-surface-subtle shrink-0">
            <div className="space-y-1.5 pr-4 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface border border-border text-text-secondary">
                  CLAIM
                </span>
                <ClaimStatusBadge status={claim.currentStatus} />
                <span className="text-xs font-mono font-medium text-text-muted">
                  ID: {claim.claimId}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(claim.claimId, "Claim ID")}
                  className="text-text-muted hover:text-text-primary transition-colors p-0.5 rounded"
                  title="Copy Claim ID"
                  aria-label="Copy Claim ID"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              <h2
                id="claim-inspector-title"
                className="text-base font-semibold text-text-primary break-words leading-snug"
              >
                {claim.statement}
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onVerify && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onVerify(claim)}
                  disabled={isVerifying}
                  className="gap-1.5"
                >
                  {isVerifying ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verify Claim</span>
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close Claim Inspector"
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 px-6 border-b border-border bg-surface shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "details"
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Claim Details</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("provenance")}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "provenance"
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Evidence Citations ({claim.evidenceReferences?.length ?? 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "history"
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Verification Audit Trail</span>
            </button>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0 space-y-6">
            {/* TAB 1: DETAILS */}
            {activeTab === "details" && (
              <div className="space-y-6">
                {/* Core Assertions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Claim Type
                    </span>
                    <p className="font-mono text-xs font-semibold text-text-primary">
                      {claim.claimType}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Asserted Action
                    </span>
                    <p className="font-mono text-xs font-semibold text-text-primary">
                      {claim.action}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Asserted Subject / Actor
                    </span>
                    <p className="font-mono text-xs font-medium text-text-primary">
                      {claim.subject || "—"}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Asserted Object / Target
                    </span>
                    <p className="font-mono text-xs font-medium text-text-primary">
                      {claim.object || "—"}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Source IP & Port
                    </span>
                    <p className="font-mono text-xs font-medium text-text-primary">
                      {claim.sourceIp || "—"}
                      {claim.sourcePort !== null && claim.sourcePort !== undefined && (
                        <span className="text-text-muted">:{claim.sourcePort}</span>
                      )}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Destination IP
                    </span>
                    <p className="font-mono text-xs font-medium text-text-primary">
                      {claim.destinationIp || "—"}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Claimed Timestamp
                    </span>
                    <p className="font-mono text-xs text-text-primary">
                      {formatDateTime(claim.timestampClaimed)}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Claimed Time Window
                    </span>
                    <p className="font-mono text-xs text-text-secondary">
                      {claim.timeRangeStart ? formatDateTime(claim.timeRangeStart) : "—"}
                      <span className="text-text-muted"> to </span>
                      {claim.timeRangeEnd ? formatDateTime(claim.timeRangeEnd) : "—"}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-subtle/50 border border-border/60 space-y-1">
                    <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      Extractor Confidence
                    </span>
                    <div className="text-xs">{renderConfidence()}</div>
                  </div>
                </div>

                {/* Provenance Metadata */}
                <div className="border border-border/60 rounded-lg p-4 bg-surface space-y-3">
                  <h3 className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-text-muted" />
                    <span>Extraction Provenance</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-text-muted">Extraction Method: </span>
                      <span className="font-mono font-medium text-text-primary">
                        {claim.extractionMethod}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-muted">Compiler Version: </span>
                      <span className="font-mono text-text-secondary">
                        {claim.compilerVersion || "1.0.0"}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-muted">Extracted At: </span>
                      <span className="font-mono text-text-secondary">
                        {formatDateTime(claim.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-muted">Investigation ID: </span>
                      <span className="font-mono text-text-secondary">
                        {claim.investigationId || "None"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Attributes Metadata */}
                {claim.attributes && Object.keys(claim.attributes).length > 0 && (
                  <div className="border border-border/60 rounded-lg p-4 bg-surface space-y-2">
                    <h3 className="text-xs font-semibold text-text-primary">
                      Structured Claim Attributes
                    </h3>
                    <pre className="font-mono text-xs bg-surface-subtle p-3 rounded border border-border/50 overflow-x-auto text-text-primary">
                      {JSON.stringify(claim.attributes, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: PROVENANCE / CITATIONS */}
            {activeTab === "provenance" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>
                    Showing {claim.evidenceReferences?.length ?? 0} evidence citation(s) grounding this claim.
                  </span>
                  <span className="text-[11px] italic">
                    Snippets rendered strictly as verbatim untrusted text.
                  </span>
                </div>

                {(!claim.evidenceReferences || claim.evidenceReferences.length === 0) ? (
                  <div className="py-8 text-center border border-dashed border-border rounded-lg bg-surface-subtle/50 text-text-muted text-xs">
                    No evidence citations attached to this claim.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {claim.evidenceReferences.map((citation, idx) => (
                      <div
                        key={citation.claimEvidenceId || idx}
                        className="border border-border rounded-lg bg-surface p-4 space-y-3 hover:border-border/80 transition-colors shadow-xs"
                      >
                        {/* Citation Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border/50 text-xs">
                          <div className="flex items-center gap-2">
                            <Badge variant="neutral" className="font-mono text-[10px]">
                              {citation.role}
                            </Badge>
                            <span className="font-mono text-text-primary font-semibold">
                              Evidence: {citation.evidenceId}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted">
                            {citation.recordNo !== null && citation.recordNo !== undefined && (
                              <span>Rec #{citation.recordNo}</span>
                            )}
                            {citation.lineNumber !== null && citation.lineNumber !== undefined && (
                              <span>Line {citation.lineNumber}</span>
                            )}
                            {citation.byteStart !== null && citation.byteStart !== undefined && (
                              <span>
                                Offset [{citation.byteStart} - {citation.byteEnd ?? "?"}]
                              </span>
                            )}
                            {citation.relevanceScore !== null && citation.relevanceScore !== undefined && (
                              <span className="text-text-secondary">
                                Score: {citation.relevanceScore.toFixed(3)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Citation Targets & Inspect Action */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
                            {citation.rawRecordId && (
                              <span>
                                Raw Record ID: <strong className="text-text-primary">{citation.rawRecordId}</strong>
                              </span>
                            )}
                            {citation.eventId && (
                              <span>
                                Event ID: <strong className="text-text-primary">{citation.eventId}</strong>
                              </span>
                            )}
                          </div>

                          {citation.eventId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setInspectedEventId(citation.eventId!)}
                              className="gap-1 h-6 text-[11px]"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Inspect Normalized Event</span>
                            </Button>
                          )}
                        </div>

                        {/* Verbatim Snippet */}
                        {citation.snippet ? (
                          <div className="space-y-1">
                            <span className="text-[11px] font-medium text-text-muted">
                              Verbatim Cited Content:
                            </span>
                            <pre className="font-mono text-xs whitespace-pre-wrap bg-surface-subtle p-2.5 rounded border border-border/50 text-text-primary max-h-36 overflow-y-auto select-text">
                              {citation.snippet}
                            </pre>
                          </div>
                        ) : (
                          <p className="text-[11px] italic text-text-muted">
                            No verbatim snippet text stored for this citation.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: VERIFICATION HISTORY */}
            {activeTab === "history" && (
              <ClaimVerificationHistory
                history={history}
                loading={historyLoading}
                error={historyError}
              />
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-border bg-surface-subtle flex items-center justify-between text-xs text-text-muted shrink-0">
            <span>Case ID: <strong className="font-mono text-text-primary">{caseId}</strong></span>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close Inspector
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-modal: Normalized Event Inspector */}
      {inspectedEventId && (
        <EventInspectorModal
          eventId={inspectedEventId}
          caseId={caseId}
          onClose={() => setInspectedEventId(null)}
        />
      )}
    </>
  );
}
