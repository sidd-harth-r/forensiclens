import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge, ClaimStatusBadge } from "@/components/ui/Badge";
import { PreviewModuleNotice } from "@/components/common/Notice";
import { FIXTURE_FINDINGS } from "@/fixtures/findings";
import { ClaimFinding } from "@/types/finding";
import { cn } from "@/lib/utils";

function FindingRow({ finding }: { finding: ClaimFinding }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={finding.status} />
          <span className="font-mono text-xs text-text-primary">{finding.claimId}</span>
          <span className="font-mono text-2xs text-text-muted">confidence {(finding.confidence * 100).toFixed(0)}%</span>
        </div>
        <span className="font-mono text-2xs text-text-muted">
          {finding.predicateName} v{finding.predicateVersion}
        </span>
      </div>
      <p className="text-sm text-text-primary">{finding.text}</p>
      {finding.evidenceRefs.length > 0 && (
        <ul className="space-y-1">
          {finding.evidenceRefs.map((ref, idx) => (
            <li key={idx} className="flex min-w-0 gap-2 font-mono text-2xs text-text-muted">
              <span className="shrink-0 text-text-secondary">
                {ref.sourceFileName}:{ref.lineNumber} · bytes {ref.byteStart}–{ref.byteEnd}
              </span>
              {ref.snippet && <span className="truncate">{ref.snippet}</span>}
            </li>
          ))}
        </ul>
      )}
      {finding.humanReviewReason && (
        <p
          className={cn(
            "rounded border px-2.5 py-1.5 text-xs",
            finding.status === "CONTRADICTED"
              ? "border-status-danger/30 bg-status-danger-bg text-status-danger"
              : "border-status-warning/30 bg-status-warning-bg text-status-warning"
          )}
        >
          Reason: {finding.humanReviewReason}
        </p>
      )}
    </li>
  );
}

export function FindingsPage() {
  const verified = useMemo(() => FIXTURE_FINDINGS.filter((f) => f.status === "VERIFIED"), []);
  const other = useMemo(() => FIXTURE_FINDINGS.filter((f) => f.status !== "VERIFIED"), []);

  return (
    <>
      <PageHeader
        title="Findings"
        meta={<Badge variant="warning">Preview</Badge>}
        showFixtureBadge={false}
        description="Planned compilation of verified findings, kept strictly separate from contradicted, unverified and review-required claims."
        actions={
          <LinkButton to="/claims" variant="secondary" size="sm">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Real claim verification
          </LinkButton>
        }
      />

      <div className="space-y-5">
        <PreviewModuleNotice module="Findings" />

        <Panel
          title={`Verified findings (${verified.length})`}
          description="Sample: claims a deterministic predicate would confirm"
          icon={<CheckCircle2 />}
          actions={<Badge variant="warning">Sample data</Badge>}
          flush
        >
          <ul className="divide-y divide-border-subtle">
            {verified.map((f) => (
              <FindingRow key={f.claimId} finding={f} />
            ))}
          </ul>
        </Panel>

        <Panel
          title={`Not verified (${other.length})`}
          description="Sample: contradicted, insufficient or human-review claims — excluded from findings"
          icon={<AlertTriangle />}
          actions={<Badge variant="warning">Sample data</Badge>}
          flush
        >
          <ul className="divide-y divide-border-subtle">
            {other.map((f) => (
              <FindingRow key={f.claimId} finding={f} />
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
