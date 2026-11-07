import { useEffect, useRef } from "react";
import type { RetrievalResultItem } from "@/types/retrieval";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/formatters";
import {
  FileText,
  X,
  Copy,
  Hash,
  ShieldCheck,
  TrendingUp,
  ExternalLink,
  Info,
} from "lucide-react";
import { toast } from "sonner";

interface RetrievalResultInspectorModalProps {
  item: RetrievalResultItem | null;
  onClose: () => void;
  onOpenEventInspector?: (eventId: string) => void;
}

export function RetrievalResultInspectorModal({
  item,
  onClose,
  onOpenEventInspector,
}: RetrievalResultInspectorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus management and Escape key handling
  useEffect(() => {
    if (!item) return;

    // Save previously focused element to restore when modal closes
    previousActiveElement.current = document.activeElement as HTMLElement | null;

    // Focus the modal container on mount
    const timer = setTimeout(() => {
      if (modalRef.current) {
        modalRef.current.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Focus trap for Tab key
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus on close
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
        previousActiveElement.current.focus();
      }
    };
  }, [item, onClose]);

  if (!item) return null;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API is not supported in this environment");
      }
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Clipboard write failed";
      toast.error(`Failed to copy ${label}: ${msg}`);
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retrieval-inspector-title"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden outline-none animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-subtle shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
            <h3 id="retrieval-inspector-title" className="text-sm font-semibold text-text-primary truncate">
              Retrieval Evidence Provenance
            </h3>
            <span className="font-mono text-xs text-text-muted px-2 py-0.5 rounded bg-surface border border-border shrink-0">
              Rank #{item.finalRank}
            </span>
            <span className="font-mono text-xs text-text-muted px-2 py-0.5 rounded bg-surface border border-border truncate max-w-[140px]">
              {item.documentId}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(item.documentId, "Document ID")}
              className="text-text-muted hover:text-text-primary p-0.5 rounded hover:bg-surface transition-colors"
              title="Copy Document ID"
              aria-label="Copy Document ID"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface transition-colors shrink-0"
            aria-label="Close Inspector dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* 1. Retrieval Ranking & Fusion Metrics */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
              Retrieval Ranking & Fusion Scores
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
              <div>
                <span className="text-text-muted block text-[11px]">Final Output Rank</span>
                <span className="font-mono font-bold text-base text-accent">
                  #{item.finalRank}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Lexical Rank (FTS5)</span>
                <span className="font-mono font-semibold text-text-primary">
                  {item.lexicalRank != null ? `#${item.lexicalRank}` : "—"}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Semantic Rank (BGE)</span>
                <span className="font-mono font-semibold text-text-primary">
                  {item.semanticRank != null ? `#${item.semanticRank}` : "—"}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">RRF Score</span>
                <span className="font-mono text-text-primary">
                  {item.rrfScore != null ? item.rrfScore.toFixed(5) : "—"}
                </span>
              </div>

              {item.rerankScore != null && (
                <div className="col-span-2 sm:col-span-4 pt-2 border-t border-border">
                  <span className="text-text-muted block text-[11px]">
                    Cross-Encoder Reranker Relevance Score
                  </span>
                  <span className="font-mono font-semibold text-status-success">
                    {item.rerankScore.toFixed(4)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 2. Forensic Provenance Trace */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-status-success" aria-hidden="true" />
              Forensic Source Provenance
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
              <div>
                <span className="text-text-muted block text-[11px]">Evidence File</span>
                <span className="font-mono font-medium text-text-primary">
                  {item.originalFilename}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Evidence ID</span>
                <div className="flex items-center gap-1 font-mono text-text-primary">
                  <span className="truncate">{item.evidenceId}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.evidenceId, "Evidence ID")}
                    className="text-text-muted hover:text-text-primary p-0.5 rounded hover:bg-surface transition-colors"
                    title="Copy Evidence ID"
                    aria-label="Copy Evidence ID"
                  >
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Raw Record ID</span>
                <div className="flex items-center gap-1 font-mono text-text-primary">
                  <span className="truncate">{item.rawRecordId}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.rawRecordId, "Raw Record ID")}
                    className="text-text-muted hover:text-text-primary p-0.5 rounded hover:bg-surface transition-colors"
                    title="Copy Raw Record ID"
                    aria-label="Copy Raw Record ID"
                  >
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Record Number</span>
                <span className="font-mono text-text-primary">
                  #{item.recordNo}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Line Number</span>
                <span className="font-mono text-text-primary">
                  {item.lineNumber != null ? `Line ${item.lineNumber}` : "—"}
                </span>
              </div>

              <div>
                <span className="text-text-muted block text-[11px]">Byte Range Offsets</span>
                <span className="font-mono text-text-primary">
                  {item.byteStart != null && item.byteEnd != null
                    ? `${item.byteStart} – ${item.byteEnd} (${item.byteEnd - item.byteStart} B)`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Event Association */}
            <div className="p-3 rounded-lg border border-border bg-surface-subtle flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <span className="text-text-muted text-[11px] block">
                    Associated Normalized Event
                  </span>
                  {item.eventId ? (
                    <span className="font-mono font-semibold text-text-primary truncate block">
                      {item.eventId}
                    </span>
                  ) : (
                    <span className="text-text-muted italic flex items-center gap-1">
                      <Info className="w-3 h-3 text-text-muted inline shrink-0" aria-hidden="true" />
                      Unnormalized record (indexed directly without parsed event)
                    </span>
                  )}
                </div>
              </div>

              {item.eventId && onOpenEventInspector && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 gap-1.5 shrink-0 text-accent hover:text-accent-hover"
                  onClick={() => onOpenEventInspector(item.eventId!)}
                  aria-label={`Inspect event details for ${item.eventId}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Inspect Event</span>
                </Button>
              )}
            </div>
          </div>

          {/* 3. Structured Metadata (if present) */}
          {(item.timestamp || item.eventType || item.severity || item.user || item.srcIp) && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                Extracted Event Metadata
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
                <div>
                  <span className="text-text-muted block text-[11px]">Timestamp</span>
                  <span className="font-mono text-text-primary">
                    {formatDateTime(item.timestamp) || "—"}
                  </span>
                </div>

                <div>
                  <span className="text-text-muted block text-[11px]">Event Type</span>
                  <span className="font-mono font-semibold text-text-primary">
                    {item.eventType || "—"}
                  </span>
                </div>

                <div>
                  <span className="text-text-muted block text-[11px]">Severity</span>
                  <div className="mt-0.5">
                    {item.severity ? (
                      <Badge variant={getSeverityBadgeVariant(item.severity)}>
                        {item.severity}
                      </Badge>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-text-muted block text-[11px]">User / Actor</span>
                  <span className="font-mono text-text-primary">
                    {item.user || "—"}
                  </span>
                </div>

                {item.srcIp && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-text-muted block text-[11px]">Source IP</span>
                    <span className="font-mono text-text-primary">
                      {item.srcIp}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. Raw Source Evidence Record */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                Raw Source Evidence Line
              </h4>

              <Button
                variant="outline"
                size="sm"
                className="text-xs h-6 gap-1"
                onClick={() => copyToClipboard(item.text, "Raw Evidence Record")}
                aria-label="Copy raw evidence text"
              >
                <Copy className="w-3 h-3" aria-hidden="true" />
                <span>Copy Raw Text</span>
              </Button>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-neutral-950 text-neutral-100 font-mono text-xs overflow-x-auto select-all">
              <pre className="whitespace-pre break-all">{item.text}</pre>
            </div>

            <p className="text-[11px] text-text-muted italic">
              Immutable forensic evidence captured during ingestion. Rendered as passive text without execution.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-subtle flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} aria-label="Close Inspector dialog">
            Close Inspector
          </Button>
        </div>
      </div>
    </div>
  );
}
