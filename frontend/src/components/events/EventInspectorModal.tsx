import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { getEventById } from "@/services/events";
import { EventSeverity, ForensicEvent } from "@/types/event";
import { formatDateTime } from "@/lib/formatters";
import {
  FileText,
  X,
  Copy,
  Hash,
  ShieldCheck,
  HardDrive,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

interface EventInspectorModalProps {
  eventId: string | null;
  caseId: string | undefined;
  onClose: () => void;
}

export function EventInspectorModal({
  eventId,
  caseId,
  onClose,
}: EventInspectorModalProps) {
  const [detail, setDetail] = useState<ForensicEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !caseId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let isCurrent = true;
    setLoading(true);
    setError(null);

    getEventById(caseId, eventId)
      .then((res) => {
        if (isCurrent) {
          setDetail(res);
        }
      })
      .catch((err) => {
        if (isCurrent) {
          setError(err instanceof Error ? err.message : "Failed to load event details");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [eventId, caseId]);

  if (!eventId) {
    return null;
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  const getSeverityBadgeVariant = (severity: EventSeverity) => {
    switch (severity) {
      case "CRITICAL":
        return "danger";
      case "WARNING":
        return "warning";
      case "INFO":
      default:
        return "default";
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Forensic Event Inspector"
    >
      <div className="bg-surface border border-border rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-subtle shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text-primary">
              Forensic Event Inspector
            </h3>
            <span className="font-mono text-xs text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
              {eventId}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(eventId, "Event ID")}
              className="text-text-muted hover:text-text-primary p-0.5"
              title="Copy Event ID"
              aria-label="Copy Event ID"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="overflow-y-auto p-5 space-y-5">
          {loading && (
            <LoadingState message="Retrieving event details and raw record provenance..." />
          )}

          {error && (
            <ErrorState
              title="Failed to Load Event Details"
              message={error}
              onRetry={() => {
                if (eventId && caseId) {
                  setLoading(true);
                  setError(null);
                  getEventById(caseId, eventId)
                    .then(setDetail)
                    .catch((err) => setError(err.message))
                    .finally(() => setLoading(false));
                }
              }}
            />
          )}

          {!loading && !error && detail && (
            <>
              {/* 1. Event Details Section */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-accent" />
                  Event Details
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
                  <div>
                    <span className="text-text-muted block text-[11px]">Event Type</span>
                    <span className="font-mono font-semibold text-text-primary">
                      {detail.eventType}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Severity</span>
                    <div className="mt-0.5">
                      <Badge
                        variant={getSeverityBadgeVariant(
                          detail.severity as EventSeverity
                        )}
                      >
                        {detail.severity}
                      </Badge>
                    </div>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">User Account</span>
                    <span className="font-mono font-medium text-text-primary">
                      {detail.userValue || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Source IP & Port</span>
                    <span className="font-mono text-text-primary">
                      {detail.srcIp
                        ? `${detail.srcIp}${
                            detail.srcPort ? `:${detail.srcPort}` : ""
                          }`
                        : "—"}
                    </span>
                    {detail.srcIpScope && (
                      <span className="ml-1 text-[10px] px-1 py-0.2 rounded bg-surface border border-border text-text-muted">
                        {detail.srcIpScope}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Host</span>
                    <span className="font-mono text-text-primary">
                      {detail.host || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Process & PID</span>
                    <span className="font-mono text-text-primary">
                      {detail.process
                        ? `${detail.process}${
                            detail.pid ? ` [${detail.pid}]` : ""
                          }`
                        : "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Timestamp (UTC)</span>
                    <span className="font-mono text-text-primary">
                      {formatDateTime(detail.timestampUtc) || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Original Timestamp</span>
                    <span className="font-mono text-text-secondary">
                      {detail.timestampOriginal || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Confidence / Timezone</span>
                    <span className="font-mono text-text-secondary">
                      {detail.timestampConfidence || "EXACT"}{" "}
                      {detail.tzAssumed ? `(${detail.tzAssumed})` : ""}
                    </span>
                  </div>
                </div>

                {/* Normalized Message */}
                <div className="p-3 rounded-lg border border-border bg-surface-subtle">
                  <span className="text-[11px] font-medium text-text-muted block mb-1">
                    Normalized Message Payload
                  </span>
                  <p className="font-mono text-xs text-text-primary break-all select-all">
                    {detail.message}
                  </p>
                </div>
              </div>

              {/* 2. Provenance Trace Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
                    Provenance Trace
                  </h4>

                  <Link to="/evidence">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-6 text-accent hover:text-accent-hover gap-1"
                    >
                      <HardDrive className="w-3 h-3" />
                      <span>View Evidence Explorer</span>
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>

                {/* Provenance Flow Pill */}
                <div className="flex items-center gap-2 p-2 rounded bg-surface-subtle border border-border font-mono text-[11px] text-text-secondary flex-wrap">
                  <span className="font-semibold text-text-primary">
                    {detail.evidenceOriginalName ||
                      detail.sourceFileName ||
                      "auth.log"}
                  </span>
                  <ArrowRight className="w-3 h-3 text-text-muted" />
                  <span className="text-accent">
                    {detail.rawRecordId || "RAW_RECORD"}
                  </span>
                  <ArrowRight className="w-3 h-3 text-text-muted" />
                  <span className="text-status-success font-semibold">
                    {detail.eventId}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
                  <div>
                    <span className="text-text-muted block text-[11px]">Evidence File</span>
                    <span className="font-mono text-text-primary font-medium">
                      {detail.evidenceOriginalName ||
                        detail.sourceFileName ||
                        "auth.log"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Evidence ID</span>
                    <div className="flex items-center gap-1 font-mono text-text-primary">
                      <span className="truncate">{detail.evidenceId}</span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(detail.evidenceId, "Evidence ID")
                        }
                        className="text-text-muted hover:text-text-primary p-0.5"
                        title="Copy Evidence ID"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Parser Engine</span>
                    <Badge variant="default" className="font-mono text-[11px]">
                      {detail.evidenceFormat ||
                        detail.source ||
                        "OPENSSH"}
                    </Badge>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Raw Record ID</span>
                    <span className="font-mono text-text-secondary">
                      {detail.rawRecordId || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Line Number</span>
                    <span className="font-mono font-medium text-text-primary">
                      {detail.lineNumber != null
                        ? `Line ${detail.lineNumber}`
                        : "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-text-muted block text-[11px]">Byte Range Offsets</span>
                    <span className="font-mono text-text-primary">
                      {detail.byteStart != null &&
                      detail.byteEnd != null
                        ? `${detail.byteStart} – ${detail.byteEnd} (${
                            detail.byteEnd - detail.byteStart
                          } B)`
                        : "—"}
                    </span>
                  </div>

                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-text-muted block text-[11px]">
                      Canonical Event Hash (SHA-256)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-primary mt-0.5">
                      <span className="break-all">{detail.eventHash}</span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(detail.eventHash, "Event Hash")
                        }
                        className="text-text-muted hover:text-text-primary p-0.5 shrink-0"
                        title="Copy SHA-256 Event Hash"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Raw Evidence Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-accent" />
                    Raw Source Evidence Line
                  </h4>

                  <div className="flex items-center gap-2">
                    {detail.lineNumber != null && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted">
                        Line {detail.lineNumber}
                      </span>
                    )}
                    {detail.rawText && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-6 gap-1"
                        onClick={() =>
                          copyToClipboard(detail.rawText!, "Raw Evidence Line")
                        }
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy Raw Line</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-border bg-neutral-950 text-neutral-100 font-mono text-xs overflow-x-auto select-all">
                  <pre className="whitespace-pre break-all">
                    {detail.rawText ||
                      `// Raw record text unavailable for ${detail.eventId}`}
                  </pre>
                </div>

                <p className="text-[11px] text-text-muted italic">
                  Immutable forensic source data captured during ingestion. Rendered strictly as
                  passive text without execution.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-subtle flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Close Inspector
          </Button>
        </div>
      </div>
    </div>
  );
}

