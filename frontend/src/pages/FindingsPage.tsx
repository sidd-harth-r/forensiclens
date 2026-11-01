import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, ClaimStatusBadge } from "@/components/ui/Badge";
import { FIXTURE_FINDINGS } from "@/fixtures/findings";
import { ClaimFinding } from "@/types/finding";
import {
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export function FindingsPage() {
  const [findings] = useState<ClaimFinding[]>(FIXTURE_FINDINGS);

  // Strict separation: Verified findings vs Non-verified/contested claims
  const verifiedFindings = useMemo(() => {
    return findings.filter((f) => f.status === "VERIFIED");
  }, [findings]);

  const nonVerifiedClaims = useMemo(() => {
    return findings.filter((f) => f.status !== "VERIFIED");
  }, [findings]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Findings & Claim Verifications"
        description="Formal claim verifications compiled by deterministic predicate execution against read-only case databases. Unverified claims are strictly separated from verified findings."
      />

      {/* SECTION 1: VERIFIED FINDINGS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-status-success" />
            <h2 className="text-base font-bold text-text-primary">
              Section 1: Verified Findings ({verifiedFindings.length})
            </h2>
          </div>
          <Badge variant="verified">
            DETERMINISTICALLY PROVED
          </Badge>
        </div>

        <p className="text-xs text-text-muted">
          The following assertions have been verified by compiler-owned predicates evaluated against immutable evidence objects. These qualify for Section 63 BSA certificate inclusion.
        </p>

        <div className="space-y-3">
          {verifiedFindings.map((finding) => (
            <Card key={finding.claimId} className="border-emerald-200 dark:border-emerald-950/60 shadow-xs">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-text-primary">
                      {finding.claimId}
                    </span>
                    <ClaimStatusBadge status={finding.status} />
                    <span className="text-[11px] font-mono text-text-muted">
                      Confidence: {(finding.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-text-muted">
                    Predicate: {finding.predicateName} (v{finding.predicateVersion})
                  </span>
                </div>

                <div className="text-xs font-semibold text-text-primary leading-relaxed">
                  {finding.text}
                </div>

                {finding.evidenceRefs.length > 0 && (
                  <div className="pt-2 border-t border-border-subtle">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Evidentiary Provenance:
                    </div>
                    <div className="space-y-1">
                      {finding.evidenceRefs.map((ref, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded bg-surface-subtle border border-border-subtle font-mono text-[11px] text-text-secondary flex items-center justify-between"
                        >
                          <span>
                            <strong>{ref.sourceFileName}</strong>: line {ref.lineNumber} (bytes {ref.byteStart}–{ref.byteEnd})
                          </span>
                          <span className="text-[10px] text-text-muted truncate max-w-md">
                            {ref.snippet}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* SECTION 2: CONTRADICTED, UNVERIFIED & HUMAN REVIEW CLAIMS */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-text-primary">
              Section 2: Contradicted, Unverified & Review Claims ({nonVerifiedClaims.length})
            </h2>
          </div>
          <Badge variant="warning">
            NOT VERIFIED — ADMISSIBILITY EXCLUDED
          </Badge>
        </div>

        <p className="text-xs text-text-muted">
          The following statements were generated during investigative reasoning or hypothesis testing, but either contradict evidentiary facts, lack sufficient grounding, or mandate human examiner evaluation.
        </p>

        <div className="space-y-3">
          {nonVerifiedClaims.map((claim) => (
            <Card
              key={claim.claimId}
              className={
                claim.status === "CONTRADICTED"
                  ? "border-red-200 dark:border-red-950/60 bg-red-50/10"
                  : claim.status === "REQUIRES_HUMAN_JUDGMENT"
                  ? "border-purple-200 dark:border-purple-950/60"
                  : "border-border bg-surface"
              }
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-text-primary">
                      {claim.claimId}
                    </span>
                    <ClaimStatusBadge status={claim.status} />
                    <span className="text-[11px] font-mono text-text-muted">
                      Confidence: {(claim.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-text-muted">
                    Predicate: {claim.predicateName}
                  </span>
                </div>

                <div className="text-xs font-medium text-text-primary leading-relaxed">
                  {claim.text}
                </div>

                {claim.humanReviewReason && (
                  <div
                    className={`p-2.5 rounded text-xs border ${
                      claim.status === "CONTRADICTED"
                        ? "bg-status-danger-bg text-status-danger border-red-200 dark:border-red-900/50"
                        : "bg-status-warning-bg text-status-warning border-amber-200 dark:border-amber-900/50"
                    }`}
                  >
                    <strong>Reason for Status:</strong> {claim.humanReviewReason}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
