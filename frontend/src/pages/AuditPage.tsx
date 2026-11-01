import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { FIXTURE_AUDIT_RECORDS, FIXTURE_AUDIT_INTEGRITY } from "@/fixtures/audit";
import { formatHash, formatDateTime } from "@/lib/formatters";
import {
  ShieldCheck,
  Hash,
  Copy,
  Link as LinkIcon,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

export function AuditPage() {
  const [records] = useState(FIXTURE_AUDIT_RECORDS);
  const integrity = FIXTURE_AUDIT_INTEGRITY;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Chain & Reproducibility Ledger"
        description="Cryptographically linked, tamper-evident audit log. Every material case action, hash re-verification, parser execution, and claim resolution appends a canonical record anchored by previous SHA-256 digests."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success("Audit chain verified: 5/5 block digests valid from Genesis")}
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1 text-status-success" />
            Verify Hash Chain
          </Button>
        }
      />

      {/* Hash Chain Integrity Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-emerald-200 dark:border-emerald-950/60 shadow-xs">
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center justify-between">
              <span>Chain Integrity</span>
              <ShieldCheck className="w-4 h-4 text-status-success" />
            </div>
            <div className="text-lg font-bold text-status-success mt-1 flex items-center gap-1.5">
              <span>INTACT & VALID</span>
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Total Sequences: {integrity.totalRecords}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center justify-between">
              <span>Genesis Digest</span>
              <Hash className="w-4 h-4 text-text-disabled" />
            </div>
            <div className="font-mono text-xs text-text-primary truncate mt-1">
              {formatHash(integrity.genesisHash, 6, 6)}
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Root Anchor Block #1
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center justify-between">
              <span>Head Hash (Latest)</span>
              <LinkIcon className="w-4 h-4 text-accent" />
            </div>
            <div className="font-mono text-xs text-accent font-semibold truncate mt-1">
              {formatHash(integrity.headHash, 6, 6)}
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Anchor for BSA Certificate
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center justify-between">
              <span>Last Verification</span>
              <RotateCcw className="w-4 h-4 text-text-disabled" />
            </div>
            <div className="font-mono text-xs text-text-primary mt-1">
              {formatDateTime(integrity.verifiedAt)}
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Local Verification Active
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Log Entries Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle>Canonical Chain Records (Chronological)</CardTitle>
          <CardDescription>
            Records are strictly append-only. Mutation of any previous entry invalidates subsequent hashes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">Seq #</TableHead>
                <TableHead className="w-32">Timestamp (UTC)</TableHead>
                <TableHead className="w-36">Event Type</TableHead>
                <TableHead className="w-28">Actor / Subsystem</TableHead>
                <TableHead className="w-32">Target Object</TableHead>
                <TableHead className="w-44">Record Hash (SHA-256)</TableHead>
                <TableHead className="w-44">Previous Hash</TableHead>
                <TableHead>Metadata Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.auditId}>
                  <TableCell className="text-center font-mono font-bold text-xs">
                    #{rec.sequenceNo}
                  </TableCell>

                  <TableCell className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                    {formatDateTime(rec.createdAt)}
                  </TableCell>

                  <TableCell>
                    <Badge variant="default" className="font-mono text-[10px]">
                      {rec.eventType}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-xs text-text-secondary font-medium">
                    {rec.actorId}
                  </TableCell>

                  <TableCell className="font-mono text-[11px] text-text-primary">
                    <span className="text-[10px] text-text-muted mr-1">[{rec.objectType}]</span>
                    {rec.objectId}
                  </TableCell>

                  <TableCell className="font-mono text-[11px] text-text-primary">
                    <div className="flex items-center gap-1">
                      <span title={rec.recordHash}>{formatHash(rec.recordHash, 6, 6)}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(rec.recordHash, "Record Hash")}
                        className="text-text-muted hover:text-text-primary p-0.5"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </TableCell>

                  <TableCell className="font-mono text-[11px] text-text-muted">
                    {rec.prevHash ? (
                      <span title={rec.prevHash}>{formatHash(rec.prevHash, 6, 6)}</span>
                    ) : (
                      <span className="text-text-disabled italic">Genesis</span>
                    )}
                  </TableCell>

                  <TableCell className="font-mono text-[11px] text-text-secondary max-w-xs truncate">
                    <span title={rec.metadataJson}>{rec.metadataJson}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
