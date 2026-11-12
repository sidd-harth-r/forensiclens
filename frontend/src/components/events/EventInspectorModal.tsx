import { useState, useEffect, useCallback } from "react";
import { ArrowRight, FileText, Hash, ShieldCheck } from "lucide-react";
import { Drawer } from "@/components/ui/Dialog";
import { Badge, SeverityBadge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { HashValue, IdValue, KeyValueGrid, CopyButton, EvidenceText, Timestamp } from "@/components/ui/DataDisplay";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { getEventById } from "@/services/events";
import { ForensicEvent } from "@/types/event";
import { formatDateTime, describeError } from "@/lib/formatters";

interface EventInspectorModalProps {
  eventId: string | null;
  caseId: string | undefined;
  onClose: () => void;
}

/**
 * Normalized event inspector with full provenance chain:
 * evidence file → raw record → normalized event.
 * Rendered as a side drawer so the originating list stays in view.
 */
export function EventInspectorModal({ eventId, caseId, onClose }: EventInspectorModalProps) {
  const [detail, setDetail] = useState<ForensicEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (isCurrent: () => boolean = () => true) => {
      if (!eventId || !caseId) return;
      setLoading(true);
      setError(null);
      getEventById(caseId, eventId)
        .then((res) => {
          if (isCurrent()) setDetail(res);
        })
        .catch((err) => {
          if (isCurrent()) setError(describeError(err, "Failed to load event details"));
        })
        .finally(() => {
          if (isCurrent()) setLoading(false);
        });
    },
    [eventId, caseId]
  );

  useEffect(() => {
    if (!eventId || !caseId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }
    let current = true;
    load(() => current);
    return () => {
      current = false;
    };
  }, [eventId, caseId, load]);

  const fileName = detail?.evidenceOriginalName || detail?.sourceFileName || null;

  return (
    <Drawer
      open={!!eventId}
      onClose={onClose}
      width="lg"
      eyebrow={
        <>
          <Badge variant="outline" icon={<FileText className="h-3 w-3" aria-hidden="true" />}>
            Event
          </Badge>
          {detail && <SeverityBadge severity={detail.severity} />}
          {eventId && <IdValue value={eventId} label="event ID" className="text-text-muted" />}
        </>
      }
      title={detail ? <span className="font-mono">{detail.eventType}</span> : "Event inspector"}
      description={detail ? <Timestamp utc={detail.timestampUtc} original={detail.timestampOriginal} showZone className="font-mono" /> : undefined}
      footer={
        <>
          <span className="text-2xs text-text-muted">Source data is rendered as passive text, never executed.</span>
          <LinkButton to="/evidence" variant="outline" size="sm" onClick={onClose}>
            Evidence
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </LinkButton>
        </>
      }
    >
      {loading && (
        <div className="space-y-3">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
      )}

      {error && !loading && <ErrorState title="Could not load event" message={error} onRetry={() => load()} />}

      {!loading && !error && detail && (
        <div className="space-y-6">
          {/* Provenance chain */}
          <section aria-labelledby="evt-chain">
            <h3 id="evt-chain" className="label-caps mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Provenance chain
            </h3>
            <ol className="grid grid-cols-1 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-3">
              {[
                { k: "Evidence file", v: fileName ?? detail.evidenceId, sub: detail.evidenceId },
                {
                  k: "Raw record",
                  v: detail.rawRecordId ?? "Not recorded",
                  sub:
                    detail.lineNumber != null
                      ? `line ${detail.lineNumber}${detail.recordNo != null ? ` · rec #${detail.recordNo}` : ""}`
                      : detail.recordNo != null
                      ? `rec #${detail.recordNo}`
                      : undefined,
                },
                { k: "Normalized event", v: detail.eventId, sub: detail.eventType },
              ].map((step, i) => (
                <li key={step.k} className="relative bg-surface-subtle px-3 py-2">
                  <span className="label-caps">
                    {i + 1}. {step.k}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-text-primary" title={step.v}>
                    {step.v}
                  </span>
                  {step.sub && <span className="block truncate font-mono text-2xs text-text-muted">{step.sub}</span>}
                </li>
              ))}
            </ol>
          </section>

          {/* Raw source */}
          <section aria-labelledby="evt-raw">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="evt-raw" className="label-caps flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Raw source line
              </h3>
              {detail.rawText && <CopyButton value={detail.rawText} label="raw line" />}
            </div>
            {detail.rawText ? (
              <EvidenceText wrap={false}>{detail.rawText}</EvidenceText>
            ) : (
              <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-text-muted">
                Raw record text is not available for this event.
              </p>
            )}
            {detail.parseError && (
              <p className="mt-2 text-xs text-status-warning">Parse error: {detail.parseError}</p>
            )}
          </section>

          {/* Normalized fields */}
          <section aria-labelledby="evt-fields">
            <h3 id="evt-fields" className="label-caps mb-2 flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" aria-hidden="true" />
              Normalized fields
            </h3>
            <KeyValueGrid
              columns={3}
              items={[
                { label: "Event type", value: detail.eventType, mono: true },
                { label: "Severity", value: <SeverityBadge severity={detail.severity} /> },
                { label: "Parse status", value: detail.parseStatus, mono: true },
                { label: "User", value: detail.userValue, mono: true },
                {
                  label: "Source IP",
                  value: detail.srcIp ? (
                    <span className="inline-flex items-center gap-1.5">
                      {detail.srcIp}
                      {detail.srcPort ? `:${detail.srcPort}` : ""}
                      {detail.srcIpScope && (
                        <Badge variant="outline" className="font-sans">
                          {detail.srcIpScope}
                        </Badge>
                      )}
                    </span>
                  ) : null,
                  mono: true,
                },
                { label: "Host", value: detail.host, mono: true },
                {
                  label: "Process",
                  value: detail.process ? `${detail.process}${detail.pid ? ` [${detail.pid}]` : ""}` : null,
                  mono: true,
                },
                { label: "Command", value: detail.commandValue, mono: true },
                { label: "Resource", value: detail.resource, mono: true },
                { label: "Source", value: detail.source, mono: true },
                { label: "Message", value: detail.message, mono: true, wide: true },
              ]}
            />
          </section>

          {/* Time */}
          <section aria-labelledby="evt-time">
            <h3 id="evt-time" className="label-caps mb-2">
              Time
            </h3>
            <KeyValueGrid
              columns={3}
              items={[
                {
                  label: "Timestamp (UTC)",
                  value: detail.timestampUtc ? formatDateTime(detail.timestampUtc) : <span className="text-text-muted">Not normalized</span>,
                  mono: true,
                },
                { label: "Original timestamp", value: detail.timestampOriginal, mono: true },
                {
                  label: "Confidence",
                  value: detail.timestampConfidence
                    ? `${detail.timestampConfidence}${detail.tzAssumed ? ` (tz ${detail.tzAssumed})` : ""}`
                    : null,
                  mono: true,
                },
              ]}
            />
          </section>

          {/* Location in evidence */}
          <section aria-labelledby="evt-location">
            <h3 id="evt-location" className="label-caps mb-2">
              Location in evidence
            </h3>
            <KeyValueGrid
              columns={3}
              items={[
                { label: "Evidence file", value: fileName, mono: true },
                { label: "Evidence ID", value: <IdValue value={detail.evidenceId} label="evidence ID" /> },
                { label: "Format", value: detail.evidenceFormat, mono: true },
                { label: "Line", value: detail.lineNumber, mono: true },
                { label: "Record #", value: detail.recordNo, mono: true },
                {
                  label: "Byte range",
                  value:
                    detail.byteStart != null && detail.byteEnd != null
                      ? `${detail.byteStart}–${detail.byteEnd} (${detail.byteEnd - detail.byteStart} B)`
                      : null,
                  mono: true,
                },
                {
                  label: "Event hash (SHA-256)",
                  value: <HashValue value={detail.eventHash} label="event hash" truncate={false} />,
                  wide: true,
                },
              ]}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}
