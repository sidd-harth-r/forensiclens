import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  HardDrive,
  Upload,
  FileText,
  Cpu,
  ArrowRight,
  ShieldCheck,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope, FilterBar } from "@/components/layout/PageHeader";
import { Card, Panel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Field, SearchField } from "@/components/ui/Input";
import { Badge, ParserStatusBadge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Dialog, Drawer } from "@/components/ui/Dialog";
import { HashValue, IdValue, KeyValueList, StatTile } from "@/components/ui/DataDisplay";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Notice } from "@/components/common/Notice";
import { getEvidenceFiles, uploadEvidence, processEvidence } from "@/services/evidence";
import { EvidenceFile, ProcessEvidenceResult } from "@/types/evidence";
import { formatBytes, formatDateTime, describeError } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const FORMAT_FILTERS = ["ALL", "OPENSSH", "SYSLOG", "APACHE", "GENERIC"] as const;
type FormatFilter = (typeof FORMAT_FILTERS)[number];

const PARSER_FORMATS = [
  { value: "OPENSSH", label: "OpenSSH authentication log (auth.log)" },
  { value: "SYSLOG", label: "Generic syslog" },
  { value: "APACHE", label: "Apache web access log" },
  { value: "GENERIC", label: "Generic text" },
];

export function EvidencePage() {
  const { currentCase, refreshCases } = useCase();
  const navigate = useNavigate();
  const [evidenceList, setEvidenceList] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("ALL");
  const [inspected, setInspected] = useState<EvidenceFile | null>(null);

  // Ingest modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("OPENSSH");
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [processingResults, setProcessingResults] = useState<Record<string, ProcessEvidenceResult>>({});

  const loadEvidence = useCallback(async () => {
    if (!currentCase?.caseId) {
      setEvidenceList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getEvidenceFiles(currentCase.caseId);
      setEvidenceList(res);
    } catch (err) {
      setError(describeError(err, "Failed to load evidence files"));
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId]);

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  // Keep the inspector in sync with refreshed rows
  useEffect(() => {
    if (!inspected) return;
    const fresh = evidenceList.find((e) => e.evidenceId === inspected.evidenceId);
    if (fresh && fresh !== inspected) setInspected(fresh);
  }, [evidenceList, inspected]);

  const handleProcess = async (ev: EvidenceFile) => {
    if (!currentCase?.caseId) {
      toast.error("No active case selected");
      return;
    }
    const { evidenceId, format, originalName } = ev;

    setProcessingIds((prev) => new Set(prev).add(evidenceId));
    try {
      const result = await processEvidence(currentCase.caseId, evidenceId, format);
      setProcessingResults((prev) => ({ ...prev, [evidenceId]: result }));
      toast.success(
        `Processed ${originalName}: ${result.eventsCount} events from ${result.rawRecordsCount} raw records`
      );
      await loadEvidence();
      await refreshCases();
    } catch (err) {
      toast.error(describeError(err, "Evidence processing failed"));
      await loadEvidence();
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(evidenceId);
        return next;
      });
    }
  };

  const filteredEvidence = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return evidenceList.filter((e) => {
      const matchesSearch =
        e.evidenceId.toLowerCase().includes(q) ||
        e.originalName.toLowerCase().includes(q) ||
        e.objectHash.toLowerCase().includes(q);
      const matchesFormat = formatFilter === "ALL" || e.format === formatFilter;
      return matchesSearch && matchesFormat;
    });
  }, [evidenceList, searchTerm, formatFilter]);

  const stats = useMemo(() => {
    const parsed = evidenceList.filter((e) => e.parserStatus === "PARSED" || e.parserStatus === "PARTIAL").length;
    const pending = evidenceList.filter((e) => e.parserStatus === "PENDING").length;
    const failed = evidenceList.filter((e) => e.parserStatus === "FAILED" || e.parserStatus === "UNSUPPORTED").length;
    const bytes = evidenceList.reduce((s, e) => s + (e.objectSizeBytes || 0), 0);
    return { parsed, pending, failed, bytes };
  }, [evidenceList]);

  const closeUpload = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setSelectedFile(null);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCase?.caseId) {
      toast.error("No active case selected");
      return;
    }
    if (!selectedFile) {
      toast.error("Choose a file to ingest");
      return;
    }

    setIsUploading(true);
    try {
      const res = await uploadEvidence(currentCase.caseId, selectedFile, selectedFormat);
      toast.success(`Ingested ${res.originalName}`, {
        description: `SHA-256 ${res.objectHash}`,
      });
      setShowUploadModal(false);
      setSelectedFile(null);
      await loadEvidence();
      await refreshCases();
    } catch (err) {
      toast.error(describeError(err, "Evidence ingestion failed"));
    } finally {
      setIsUploading(false);
    }
  };

  const filtersActive = searchTerm !== "" || formatFilter !== "ALL";

  // Parsed lines / total lines as stored on the evidence record (backend parsed_lines /
  // total_lines). Event counts differ from parsed lines and are shown only in the
  // inspector's processing-run summary, never mixed into this column.
  const renderCounts = (ev: EvidenceFile) => {
    if (ev.parsedLines != null && ev.parsedLines > 0) {
      return (
        <>
          <span className="text-text-primary">{ev.parsedLines.toLocaleString()}</span>
          {ev.totalLines ? <span className="text-text-muted"> / {ev.totalLines.toLocaleString()}</span> : null}
        </>
      );
    }
    if (ev.totalLines) return <span className="text-text-muted">— / {ev.totalLines.toLocaleString()}</span>;
    return <span className="text-text-disabled">—</span>;
  };

  const renderAction = (ev: EvidenceFile) => {
    const isProcessing = processingIds.has(ev.evidenceId);
    const status = isProcessing ? "PROCESSING" : ev.parserStatus;
    if (isProcessing) {
      return (
        <Button size="xs" variant="outline" loading>
          Processing
        </Button>
      );
    }
    if (status === "PARSED" || status === "PARTIAL") {
      return (
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            navigate("/events");
          }}
          aria-label={`View events parsed from ${ev.originalName}`}
        >
          Events
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Button>
      );
    }
    return (
      <Button
        size="xs"
        variant="primary"
        onClick={(e) => {
          e.stopPropagation();
          void handleProcess(ev);
        }}
        aria-label={`Parse ${ev.originalName} into events`}
      >
        <Cpu className="h-3 w-3" aria-hidden="true" />
        Process
      </Button>
    );
  };

  return (
    <>
      <PageHeader
        title="Evidence"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description="Artifacts are hashed with SHA-256 on ingestion, copied into the case evidence store and parsed into normalized events. The application never modifies a stored artifact."
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowUploadModal(true)} disabled={!currentCase}>
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Ingest evidence
          </Button>
        }
      />

      {!currentCase && !loading ? (
        <EmptyState
          icon={<HardDrive />}
          title="No case selected"
          description="Select a case from the case selector to view and ingest its evidence."
        />
      ) : error ? (
        <ErrorState title="Failed to load evidence" message={error} onRetry={loadEvidence} />
      ) : (
        <>
          <section aria-label="Evidence summary" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Artifacts" value={loading ? "…" : evidenceList.length} hint={loading ? undefined : formatBytes(stats.bytes)} icon={<HardDrive />} />
            <StatTile label="Parsed" value={loading ? "…" : stats.parsed} hint="Parsed or partial" tone="success" />
            <StatTile label="Awaiting processing" value={loading ? "…" : stats.pending} tone={stats.pending > 0 ? "warning" : "default"} />
            <StatTile label="Failed / unsupported" value={loading ? "…" : stats.failed} tone={stats.failed > 0 ? "danger" : "default"} />
          </section>

          <Card className="overflow-hidden">
            <FilterBar>
              <SearchField
                label="Search evidence"
                placeholder="Search by evidence ID, filename or SHA-256"
                value={searchTerm}
                onValueChange={setSearchTerm}
                className="sm:w-80"
              />
              <SegmentedControl<FormatFilter>
                label="Filter by format"
                value={formatFilter}
                onChange={setFormatFilter}
                mono
                options={FORMAT_FILTERS.map((f) => ({ value: f, label: f === "ALL" ? "All formats" : f }))}
              />
              <span className="ml-auto text-xs text-text-muted" aria-live="polite">
                {filteredEvidence.length} of {evidenceList.length}
              </span>
            </FilterBar>

            {loading ? (
              <TableSkeleton rows={6} columns={8} label="Loading evidence" />
            ) : filteredEvidence.length === 0 ? (
              <EmptyState
                bare
                icon={<HardDrive />}
                title={filtersActive ? "No evidence matches these filters" : "No evidence ingested"}
                description={
                  filtersActive
                    ? "Adjust the search text or format filter."
                    : `Ingest a log or artifact into ${currentCase?.caseId ?? "this case"} to hash it and parse it into events.`
                }
                actionLabel={filtersActive ? "Clear filters" : "Ingest evidence"}
                onAction={() => {
                  if (filtersActive) {
                    setSearchTerm("");
                    setFormatFilter("ALL");
                  } else {
                    setShowUploadModal(true);
                  }
                }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artifact</TableHead>
                    <TableHead className="w-[100px]">Format</TableHead>
                    <TableHead className="w-[210px]">SHA-256</TableHead>
                    <TableHead className="w-[80px] text-right">Size</TableHead>
                    <TableHead className="w-[130px] text-right" title="Lines parsed / total lines in the artifact">
                      Parsed / lines
                    </TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[170px]">Ingested (UTC)</TableHead>
                    <TableHead className="w-[110px] text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvidence.map((ev) => {
                    const status = processingIds.has(ev.evidenceId) ? "PROCESSING" : ev.parserStatus;
                    return (
                      <TableRow
                        key={ev.evidenceId}
                        selected={inspected?.evidenceId === ev.evidenceId}
                        onActivate={() => setInspected(ev)}
                        aria-label={`Inspect ${ev.originalName}`}
                      >
                        <TableCell className="max-w-[280px]">
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs text-text-primary" title={ev.originalName}>
                                {ev.originalName}
                              </div>
                              <div className="font-mono text-2xs text-text-muted">{ev.evidenceId}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" mono>
                            {ev.format}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <HashValue value={ev.objectHash} label="SHA-256" />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-xs text-text-secondary">
                          {formatBytes(ev.objectSizeBytes)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{renderCounts(ev)}</TableCell>
                        <TableCell>
                          <ParserStatusBadge status={status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-2xs text-text-muted">
                          {formatDateTime(ev.createdAt)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {renderAction(ev)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      {/* Evidence detail inspector */}
      <Drawer
        open={!!inspected}
        onClose={() => setInspected(null)}
        width="md"
        eyebrow={
          inspected && (
            <>
              <Badge variant="outline" mono>
                {inspected.format}
              </Badge>
              <ParserStatusBadge status={processingIds.has(inspected.evidenceId) ? "PROCESSING" : inspected.parserStatus} />
            </>
          )
        }
        title={<span className="font-mono text-sm">{inspected?.originalName}</span>}
        footer={
          inspected && (
            <>
              <span className="text-2xs text-text-muted">Not modified by the application</span>
              {renderAction(inspected)}
            </>
          )
        }
      >
        {inspected && (
          <div className="space-y-5">
            <section aria-labelledby="ev-integrity">
              <h3 id="ev-integrity" className="label-caps mb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Integrity
              </h3>
              <div className="rounded border border-border bg-surface-subtle p-3">
                <div className="label-caps mb-1">SHA-256 digest</div>
                <HashValue value={inspected.objectHash} label="SHA-256" truncate={false} className="text-text-primary" />
              </div>
              <KeyValueList
                className="mt-2"
                items={[
                  {
                    label: "Hash last verified (backend)",
                    value: inspected.hashVerifiedAt ? (
                      <span title="Recorded by the backend when the stored copy was re-hashed and matched (at ingestion). No re-verification can be triggered from the UI, so this is not a live integrity check.">
                        {formatDateTime(inspected.hashVerifiedAt)}
                        <span className="block font-sans text-2xs text-text-muted">
                          Set at ingestion · not a live check
                        </span>
                      </span>
                    ) : (
                      <span className="text-text-muted">Not recorded</span>
                    ),
                    mono: true,
                  },
                  { label: "Size", value: `${formatBytes(inspected.objectSizeBytes)} (${inspected.objectSizeBytes.toLocaleString()} bytes)`, mono: true },
                ]}
              />
            </section>

            <section aria-labelledby="ev-provenance">
              <h3 id="ev-provenance" className="label-caps mb-2">
                Provenance
              </h3>
              <KeyValueList
                items={[
                  { label: "Evidence ID", value: <IdValue value={inspected.evidenceId} label="evidence ID" /> },
                  { label: "Case", value: inspected.caseId, mono: true },
                  { label: "Original filename", value: inspected.originalName, mono: true },
                  { label: "Media type", value: inspected.mediaType, mono: true },
                  { label: "Storage path", value: inspected.storagePath, mono: true },
                  { label: "Ingested (UTC)", value: formatDateTime(inspected.createdAt), mono: true },
                ]}
              />
            </section>

            <section aria-labelledby="ev-parse">
              <h3 id="ev-parse" className="label-caps mb-2">
                Parsing
              </h3>
              <KeyValueList
                items={[
                  { label: "Parser format", value: inspected.format, mono: true },
                  { label: "Total lines", value: inspected.totalLines?.toLocaleString(), mono: true },
                  { label: "Parsed lines", value: inspected.parsedLines?.toLocaleString(), mono: true },
                ]}
              />
              {processingResults[inspected.evidenceId] && (
                <Panel title="Last processing run (this session)" className="mt-3" headingLevel="h3">
                  <KeyValueList
                    items={[
                      { label: "Parser", value: `${processingResults[inspected.evidenceId].parserName} ${processingResults[inspected.evidenceId].parserVersion ?? ""}`, mono: true },
                      { label: "Raw records", value: processingResults[inspected.evidenceId].rawRecordsCount.toLocaleString(), mono: true },
                      { label: "Events", value: processingResults[inspected.evidenceId].eventsCount.toLocaleString(), mono: true },
                      { label: "Unparsed records", value: processingResults[inspected.evidenceId].unparsedRecordsCount.toLocaleString(), mono: true },
                      { label: "Errors", value: processingResults[inspected.evidenceId].errorSummary },
                    ]}
                  />
                </Panel>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {/* Ingest dialog */}
      <Dialog
        open={showUploadModal}
        onClose={closeUpload}
        title="Ingest evidence"
        description={
          currentCase ? (
            <>
              Into <span className="font-mono text-text-secondary">{currentCase.caseId}</span> · {currentCase.name}
            </>
          ) : undefined
        }
        dismissible={!isUploading}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeUpload} disabled={isUploading}>
              Cancel
            </Button>
            <Button type="submit" form="ingest-form" variant="primary" size="sm" loading={isUploading} disabled={!selectedFile}>
              {isUploading ? "Hashing & ingesting…" : "Ingest"}
            </Button>
          </>
        }
      >
        <form id="ingest-form" onSubmit={handleUploadSubmit} className="space-y-4">
          <div className="space-y-1">
            <span className="block text-xs font-medium text-text-secondary">
              Evidence file<span className="ml-0.5 text-status-danger" aria-hidden="true">*</span>
            </span>
            <input
              id="evidence-file-input"
              type="file"
              ref={fileInputRef}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setSelectedFile(f);
              }}
            />
            <button
              type="button"
              data-autofocus
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setSelectedFile(f);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-1 rounded border border-dashed px-4 py-6 text-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                dragOver ? "border-accent bg-accent-subtle" : "border-border-strong bg-surface-subtle hover:border-accent/60"
              )}
              aria-describedby="evidence-file-hint"
            >
              {selectedFile ? (
                <>
                  <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
                  <span className="max-w-full truncate font-mono text-xs font-medium text-text-primary">{selectedFile.name}</span>
                  <span className="text-2xs text-text-muted">{formatBytes(selectedFile.size)} · click to change</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-text-muted" aria-hidden="true" />
                  <span className="text-xs font-medium text-text-primary">Choose a file or drop it here</span>
                  <span className="text-2xs text-text-muted">.log, .txt, .json, .evtx</span>
                </>
              )}
            </button>
            <p id="evidence-file-hint" className="flex items-center gap-1 text-2xs text-text-muted">
              <Info className="h-3 w-3" aria-hidden="true" />
              The file is hashed with SHA-256 and a copy is stored in the case. Your original file is not modified.
            </p>
          </div>

          <Field label="Parser format" htmlFor="parser-format">
            <Select id="parser-format" value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}>
              {PARSER_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>

          <Notice tone="info">Ingestion stores and hashes the artifact. Run “Process” afterwards to parse it into events.</Notice>
        </form>
      </Dialog>
    </>
  );
}
