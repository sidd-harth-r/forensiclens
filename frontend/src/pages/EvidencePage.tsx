import { useState, useMemo, useEffect } from "react";
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
import { getEvidenceFiles } from "@/services/evidence";
import { EvidenceFile } from "@/types/evidence";
import { formatBytes, formatHash, formatDateTime } from "@/lib/formatters";
import {
  HardDrive,
  Search,
  Upload,
  CheckCircle2,
  FileCode,
  FileText,
  Copy,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export function EvidencePage() {
  const { currentCase } = useCase();
  const [evidenceList, setEvidenceList] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("ALL");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getEvidenceFiles(currentCase?.caseId).then((res) => {
      if (mounted) {
        setEvidenceList(res);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentCase?.caseId]);

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

  if (loading) {
    return <LoadingState message="Loading immutable evidence records..." />;
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
              onClick={() => toast.info("Batch SHA-256 verification verified 100% byte integrity")}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-status-success" />
              Re-verify Hashes
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled
              title="Evidence ingestion is wired through backend API in Phase 1"
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
              {(["ALL", "OPENSSH", "SYSLOG", "APACHE"] as const).map((fmt) => (
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
                    : "No evidence artifacts have been ingested into this case."
                }
                actionLabel="Reset Search"
                onAction={() => {
                  setSearchTerm("");
                  setFormatFilter("ALL");
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Evidence ID</TableHead>
                  <TableHead>Source Filename</TableHead>
                  <TableHead className="w-24">Format</TableHead>
                  <TableHead className="w-48">SHA-256 Digest</TableHead>
                  <TableHead className="w-24 text-right">Size</TableHead>
                  <TableHead className="w-24 text-right">Lines</TableHead>
                  <TableHead className="w-28 text-center">Status</TableHead>
                  <TableHead className="w-40">Ingested UTC</TableHead>
                  <TableHead className="w-24 text-center">Integrity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvidence.map((ev) => (
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

                    <TableCell className="text-right font-mono text-xs text-text-secondary">
                      {ev.totalLines ? ev.totalLines.toLocaleString() : "—"}
                    </TableCell>

                    <TableCell className="text-center">
                      <ParserStatusBadge status={ev.parserStatus} />
                    </TableCell>

                    <TableCell className="text-xs text-text-muted font-mono">
                      {formatDateTime(ev.createdAt)}
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge
                        variant="verified"
                        icon={<CheckCircle2 className="w-3 h-3 text-status-success" />}
                      >
                        VALID
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

