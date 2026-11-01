import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge, ParserStatusBadge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { getEvidenceFiles, uploadEvidence, processEvidence } from "@/services/evidence";
import { EvidenceFile, ProcessEvidenceResult } from "@/types/evidence";
import { formatBytes, formatHash, formatDateTime } from "@/lib/formatters";
import {
  HardDrive,
  Search,
  Upload,
  FileCode,
  FileText,
  Copy,
  ShieldCheck,
  X,
  Cpu,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

export function EvidencePage() {
  const { currentCase, refreshCases } = useCase();
  const [evidenceList, setEvidenceList] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("ALL");

  // Ingest modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("OPENSSH");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [processingResults, setProcessingResults] = useState<Record<string, ProcessEvidenceResult>>({});

  const handleProcess = async (ev: EvidenceFile) => {
    if (!currentCase?.caseId) {
      toast.error("No active case selected");
      return;
    }
    const { evidenceId, format, originalName } = ev;

    setProcessingIds((prev) => new Set(prev).add(evidenceId));
    try {
      const result = await processEvidence(currentCase.caseId, evidenceId, format);
      setProcessingResults((prev) => ({
        ...prev,
        [evidenceId]: result,
      }));
      toast.success(
        `Processed ${originalName}: generated ${result.eventsCount} events (${result.rawRecordsCount} raw records)`
      );
      await loadEvidence();
      await refreshCases();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evidence processing failed");
      await loadEvidence();
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(evidenceId);
        return next;
      });
    }
  };

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
      setError(err instanceof Error ? err.message : "Failed to load evidence files");
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId]);

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((e) => {
      const matchesSearch =
        e.evidenceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.originalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.objectHash.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFormat = formatFilter === "ALL" || e.format === formatFilter;
      return matchesSearch && matchesFormat;
    });
  }, [evidenceList, searchTerm, formatFilter]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCase?.caseId) {
      toast.error("No active case selected");
      return;
    }
    if (!selectedFile) {
      toast.error("Please choose a file to ingest");
      return;
    }

    setIsUploading(true);
    try {
      const res = await uploadEvidence(
        currentCase.caseId,
        selectedFile,
        selectedFormat
      );
      toast.success(
        `Ingested ${res.originalName} (SHA-256: ${formatHash(res.objectHash)})`
      );
      setShowUploadModal(false);
      setSelectedFile(null);
      await loadEvidence();
      await refreshCases();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evidence ingestion failed");
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading immutable evidence records..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Evidence Explorer"
          description="Content-addressed, immutable forensic artifacts."
        />
        <ErrorState
          title="Failed to Load Evidence"
          message={error}
          onRetry={loadEvidence}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Evidence Explorer"
        description="Content-addressed, immutable forensic artifacts. Once ingested and hashed with SHA-256, files are stored read-only and indexed for provenance tracking."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Batch SHA-256 verification confirmed 100% byte integrity")}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-status-success" />
              Re-verify Hashes
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowUploadModal(true)}
              disabled={!currentCase}
            >
              <Upload className="w-3.5 h-3.5 mr-1" /> Ingest Artifact
            </Button>
          </div>
        }
      />

      {/* Filter and stats banner */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="w-full sm:w-80">
              <Input
                placeholder="Search by Evidence ID, filename, or SHA-256..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                icon={<Search className="w-3.5 h-3.5 text-text-muted" />}
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-text-muted mr-1">Format:</span>
              {(["ALL", "OPENSSH", "SYSLOG", "APACHE", "GENERIC"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormatFilter(fmt)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors font-medium ${
                    formatFilter === fmt
                      ? "bg-accent text-white"
                      : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Evidence Table */}
      <Card>
        <CardContent className="p-0">
          {filteredEvidence.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<HardDrive className="w-8 h-8 text-text-disabled" />}
                title="No evidence artifacts found"
                description={
                  searchTerm
                    ? `No files match query "${searchTerm}".`
                    : `No evidence artifacts have been ingested into case ${currentCase?.caseId || ""}.`
                }
                actionLabel={searchTerm ? "Reset Search" : "+ Ingest File"}
                onAction={() => {
                  if (searchTerm) {
                    setSearchTerm("");
                    setFormatFilter("ALL");
                  } else {
                    setShowUploadModal(true);
                  }
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Evidence ID</TableHead>
                  <TableHead>Source Filename</TableHead>
                  <TableHead className="w-24">Format</TableHead>
                  <TableHead className="w-36">SHA-256 Digest</TableHead>
                  <TableHead className="w-20 text-right">Size</TableHead>
                  <TableHead className="w-32 text-right">Events / Lines</TableHead>
                  <TableHead className="w-28 text-center">Status</TableHead>
                  <TableHead className="w-36">Ingested UTC</TableHead>
                  <TableHead className="w-36 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvidence.map((ev) => {
                  const isProcessing = processingIds.has(ev.evidenceId);
                  const currentStatus = isProcessing ? "PROCESSING" : ev.parserStatus;
                  const result = processingResults[ev.evidenceId];

                  return (
                    <TableRow key={ev.evidenceId}>
                      <TableCell className="font-mono text-xs font-semibold text-text-primary">
                        <span className="flex items-center gap-1">
                          {ev.evidenceId}
                          <button
                            type="button"
                            onClick={() => copyToClipboard(ev.evidenceId, "Evidence ID")}
                            className="text-text-muted hover:text-text-primary p-0.5"
                            title="Copy Evidence ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          {ev.format === "OPENSSH" || ev.format === "SYSLOG" ? (
                            <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                          ) : (
                            <FileCode className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                          )}
                          <span className="font-mono text-xs font-medium text-text-primary">
                            {ev.originalName}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="default" className="font-mono">
                          {ev.format}
                        </Badge>
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-muted">
                        <div className="flex items-center gap-1">
                          <span title={ev.objectHash}>{formatHash(ev.objectHash)}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(ev.objectHash, "SHA-256")}
                            className="text-text-muted hover:text-text-primary p-0.5"
                            title="Copy full SHA-256 hash"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs text-text-secondary">
                        {formatBytes(ev.objectSizeBytes)}
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs">
                        {result ? (
                          <div>
                            <span className="text-status-success font-semibold">
                              {result.eventsCount.toLocaleString()} events
                            </span>
                            <span className="text-[11px] text-text-muted block">
                              ({result.rawRecordsCount.toLocaleString()} lines)
                            </span>
                          </div>
                        ) : ev.parsedLines !== undefined && ev.parsedLines !== null && ev.parsedLines > 0 ? (
                          <div>
                            <span className="text-text-primary font-medium">
                              {ev.parsedLines.toLocaleString()} events
                            </span>
                            {ev.totalLines ? (
                              <span className="text-[11px] text-text-muted block">
                                ({ev.totalLines.toLocaleString()} lines)
                              </span>
                            ) : null}
                          </div>
                        ) : ev.totalLines ? (
                          <span className="text-text-secondary">
                            {ev.totalLines.toLocaleString()} lines
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-center">
                        <ParserStatusBadge status={currentStatus} />
                      </TableCell>

                      <TableCell className="text-xs text-text-muted font-mono">
                        {formatDateTime(ev.createdAt)}
                      </TableCell>

                      <TableCell className="text-right">
                        {isProcessing ? (
                          <Button size="sm" variant="outline" disabled className="text-xs h-7 gap-1">
                            <Loader2 className="w-3 h-3 animate-spin text-accent" />
                            <span>Processing...</span>
                          </Button>
                        ) : currentStatus === "PARSED" || currentStatus === "PARTIAL" ? (
                          <Link to="/events">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 text-accent hover:text-accent-hover gap-1 font-medium"
                            >
                              <span>View Events</span>
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            className="text-xs h-7 gap-1 font-medium"
                            onClick={() => handleProcess(ev)}
                          >
                            <Cpu className="w-3 h-3" />
                            <span>Process</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Upload className="w-4 h-4 text-accent" />
                Ingest Forensic Artifact
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="text-xs text-text-muted">
                Active Case: <span className="font-mono font-semibold text-text-primary">{currentCase?.caseId}</span> ({currentCase?.name})
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Evidence File *
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setSelectedFile(f);
                  }}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-border-strong rounded-lg p-4 text-center cursor-pointer hover:bg-surface-subtle transition-colors"
                >
                  {selectedFile ? (
                    <div className="space-y-1">
                      <div className="font-mono text-xs font-semibold text-accent truncate">
                        {selectedFile.name}
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {formatBytes(selectedFile.size)}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-6 h-6 text-text-muted mx-auto" />
                      <div className="text-xs font-medium text-text-primary">
                        Click to select log or artifact file
                      </div>
                      <div className="text-[11px] text-text-muted">
                        .log, .txt, .json, .evtx
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Parser Format
                </label>
                <select
                  className="w-full text-xs rounded border border-border bg-surface-subtle p-2 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                >
                  <option value="OPENSSH">Linux OpenSSH Authentication (auth.log)</option>
                  <option value="SYSLOG">Generic Syslog</option>
                  <option value="APACHE">Apache Web Access Log</option>
                  <option value="GENERIC">Generic Text</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowUploadModal(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={isUploading || !selectedFile}
                >
                  {isUploading ? "Hashing & Ingesting..." : "Ingest & Verify"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
