import { ShieldCheck, Hash, Link as LinkIcon, History } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { HashValue, StatTile } from "@/components/ui/DataDisplay";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { PreviewModuleNotice } from "@/components/common/Notice";
import { FIXTURE_AUDIT_RECORDS, FIXTURE_AUDIT_INTEGRITY } from "@/fixtures/audit";
import { formatHash, formatDateTime } from "@/lib/formatters";

export function AuditPage() {
  const records = FIXTURE_AUDIT_RECORDS;
  const integrity = FIXTURE_AUDIT_INTEGRITY;

  return (
    <>
      <PageHeader
        title="Audit Ledger"
        meta={<Badge variant="warning">Preview</Badge>}
        showFixtureBadge={false}
        description="Planned tamper-evident ledger: each material case action appends a record anchored to the previous record's SHA-256 digest."
        actions={
          <Button variant="outline" size="sm" disabled title="Chain verification is not implemented yet">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Verify hash chain
          </Button>
        }
      />

      <div className="space-y-5">
        <PreviewModuleNotice module="Audit Ledger" />

        <section aria-label="Sample chain summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Records (sample)" value={integrity.totalRecords} icon={<History />} hint="Not verified — sample" />
          <StatTile label="Genesis digest" value={<span className="text-sm">{formatHash(integrity.genesisHash, 6, 6)}</span>} icon={<Hash />} hint="Sample value" />
          <StatTile label="Head digest" value={<span className="text-sm">{formatHash(integrity.headHash, 6, 6)}</span>} icon={<LinkIcon />} hint="Sample value" />
          <StatTile label="Sample timestamp" value={<span className="text-sm">{formatDateTime(integrity.verifiedAt).slice(0, 10)}</span>} hint="Fixture metadata" />
        </section>

        <Panel
          title="Chain records"
          description="Sample layout — append-only; mutating an entry would invalidate every later hash."
          actions={<Badge variant="warning">Sample data</Badge>}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px] text-right">Seq</TableHead>
                <TableHead className="w-[170px]">Timestamp (UTC)</TableHead>
                <TableHead className="w-[150px]">Event</TableHead>
                <TableHead className="w-[120px]">Actor</TableHead>
                <TableHead className="w-[170px]">Object</TableHead>
                <TableHead className="w-[170px]">Record hash</TableHead>
                <TableHead className="w-[150px]">Previous hash</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.auditId}>
                  <TableCell className="text-right font-mono text-xs">{rec.sequenceNo}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-2xs text-text-muted">{formatDateTime(rec.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" mono>
                      {rec.eventType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-text-secondary">{rec.actorId}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="text-2xs text-text-muted">{rec.objectType} </span>
                    {rec.objectId}
                  </TableCell>
                  <TableCell>
                    <HashValue value={rec.recordHash} label="record hash" leading={6} trailing={6} />
                  </TableCell>
                  <TableCell className="font-mono text-2xs text-text-muted">
                    {rec.prevHash ? <span title={rec.prevHash}>{formatHash(rec.prevHash, 6, 6)}</span> : <span className="italic">genesis</span>}
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-2xs text-text-secondary">
                    <span title={rec.metadataJson}>{rec.metadataJson}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
