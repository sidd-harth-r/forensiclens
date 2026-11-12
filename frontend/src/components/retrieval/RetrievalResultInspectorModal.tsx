import { ExternalLink, FileText, Hash, TrendingUp, ShieldCheck } from "lucide-react";
import type { RetrievalMode, RetrievalResultItem } from "@/types/retrieval";
import { Drawer } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge, SeverityBadge } from "@/components/ui/Badge";
import { IdValue, KeyValueGrid, EvidenceText, CopyButton } from "@/components/ui/DataDisplay";
import { formatDateTime } from "@/lib/formatters";
import { MatchChannels } from "./MatchChannels";

interface RetrievalResultInspectorModalProps {
  item: RetrievalResultItem | null;
  onClose: () => void;
  onOpenEventInspector?: (eventId: string) => void;
  /** Retrieval mode of the search that produced this item */
  mode?: RetrievalMode;
}

/**
 * Provenance and ranking breakdown for a single retrieval hit.
 */
export function RetrievalResultInspectorModal({ item, onClose, onOpenEventInspector, mode }: RetrievalResultInspectorModalProps) {
  return (
    <Drawer
      open={!!item}
      onClose={onClose}
      width="lg"
      eyebrow={
        item && (
          <>
            <Badge variant="accent" mono>
              Rank #{item.finalRank}
            </Badge>
            <MatchChannels item={item} mode={mode} />
          </>
        )
      }
      title={item ? <span className="font-mono text-sm">{item.originalFilename}</span> : "Retrieval result"}
      description={
        item ? (
          <span className="font-mono">
            {item.lineNumber != null ? `line ${item.lineNumber}` : `record #${item.recordNo}`}
            {item.byteStart != null && item.byteEnd != null ? ` · bytes ${item.byteStart}–${item.byteEnd}` : ""}
          </span>
        ) : undefined
      }
      footer={
        item && (
          <>
            <span className="text-2xs text-text-muted">Retrieved text is verbatim, untrusted evidence.</span>
            {item.eventId && onOpenEventInspector && (
              <Button variant="outline" size="sm" onClick={() => onOpenEventInspector(item.eventId!)}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Inspect event
              </Button>
            )}
          </>
        )
      }
    >
      {item && (
        <div className="space-y-6">
          <section aria-labelledby="rr-text">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="rr-text" className="label-caps flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Retrieved record
              </h3>
              <CopyButton value={item.text} label="record text" />
            </div>
            <EvidenceText>{item.text}</EvidenceText>
          </section>

          <section aria-labelledby="rr-rank">
            <h3 id="rr-rank" className="label-caps mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              Ranking breakdown
            </h3>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
              {[
                { k: "Final rank", v: `#${item.finalRank}`, hint: "Output position" },
                { k: "Lexical", v: item.lexicalRank != null ? `#${item.lexicalRank}` : "—", hint: "FTS5 / BM25 rank" },
                { k: "Semantic", v: item.semanticRank != null ? `#${item.semanticRank}` : "—", hint: "Embedding rank" },
                { k: "RRF score", v: item.rrfScore != null ? item.rrfScore.toFixed(5) : "—", hint: "Rank fusion" },
                { k: "Rerank", v: item.rerankScore != null ? item.rerankScore.toFixed(4) : "—", hint: "Cross-encoder" },
              ].map((m) => (
                <div key={m.k} className="bg-surface px-3 py-2">
                  <div className="label-caps">{m.k}</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-text-primary">{m.v}</div>
                  <div className="text-2xs text-text-muted">{m.hint}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-2xs text-text-muted">
              A dash means the record was not returned by that channel for this query.
            </p>
          </section>

          <section aria-labelledby="rr-prov">
            <h3 id="rr-prov" className="label-caps mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Provenance
            </h3>
            <KeyValueGrid
              columns={2}
              items={[
                { label: "Evidence file", value: item.originalFilename, mono: true },
                { label: "Evidence ID", value: <IdValue value={item.evidenceId} label="evidence ID" /> },
                { label: "Raw record ID", value: <IdValue value={item.rawRecordId} label="raw record ID" /> },
                { label: "Record #", value: item.recordNo, mono: true },
                { label: "Line", value: item.lineNumber, mono: true },
                {
                  label: "Byte range",
                  value:
                    item.byteStart != null && item.byteEnd != null
                      ? `${item.byteStart}–${item.byteEnd} (${item.byteEnd - item.byteStart} B)`
                      : null,
                  mono: true,
                },
                { label: "Linked event", value: item.eventId ? <IdValue value={item.eventId} label="event ID" /> : <span className="text-text-muted">No normalized event</span> },
                { label: "Document ID", value: <IdValue value={item.documentId} label="document ID" /> },
              ]}
            />
          </section>

          {(item.timestamp || item.eventType || item.severity || item.user || item.srcIp) && (
            <section aria-labelledby="rr-meta">
              <h3 id="rr-meta" className="label-caps mb-2 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                Event metadata
              </h3>
              <KeyValueGrid
                columns={3}
                items={[
                  { label: "Timestamp (UTC)", value: item.timestamp ? formatDateTime(item.timestamp) : null, mono: true },
                  { label: "Event type", value: item.eventType, mono: true },
                  { label: "Severity", value: item.severity ? <SeverityBadge severity={item.severity} /> : null },
                  { label: "User", value: item.user, mono: true },
                  { label: "Source IP", value: item.srcIp, mono: true },
                ]}
              />
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
