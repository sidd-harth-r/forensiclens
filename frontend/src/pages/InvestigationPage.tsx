import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, ClaimStatusBadge } from "@/components/ui/Badge";
import { FIXTURE_INVESTIGATIONS } from "@/fixtures/investigations";
import { FIXTURE_FINDINGS } from "@/fixtures/findings";
import {
  Search,
  Sparkles,
  Shield,
  FileCheck,
  Cpu,
  Info,
  CheckCircle2,
  Send,
} from "lucide-react";
import { toast } from "sonner";

export function InvestigationPage() {
  const [queryInput, setQueryInput] = useState(
    "Identify public IP addresses conducting brute-force authentication against port 22 between 10:00 and 11:00 UTC"
  );
  const [privacyLevel, setPrivacyLevel] = useState<"L0" | "L1" | "L2" | "L3">("L2");
  const [activeTab, setActiveTab] = useState<"findings" | "evidence" | "provenance">("findings");

  const sampleInvestigation = FIXTURE_INVESTIGATIONS[0];
  const sampleFindings = FIXTURE_FINDINGS.filter((f) => f.investigationId === sampleInvestigation.investigationId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.info("Investigation Query Submitted (Fixture Mode)", {
      description: "In Phase 3, this executes hybrid RRF retrieval + llama.cpp structured verification.",
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investigation Workspace"
        description="Natural-language investigative query interface. Queries undergo L2 pseudonymization, hybrid lexical/vector candidate retrieval, cross-encoder reranking, and deterministic predicate claim verification."
      />

      {/* Query Formulation Card */}
      <Card className="border-accent/40 shadow-xs">
        <CardHeader className="py-3 bg-surface-subtle/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              <CardTitle>Investigative Hypothesis Query</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted font-medium">Privacy Redaction:</span>
              {(["L0", "L1", "L2", "L3"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setPrivacyLevel(lvl)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold transition-colors ${
                    privacyLevel === lvl
                      ? "bg-accent text-white"
                      : "bg-surface text-text-secondary border border-border hover:bg-surface-muted"
                  }`}
                  title={
                    lvl === "L2"
                      ? "L2 Recommended: Usernames & private IPs pseudonymized"
                      : `Privacy level ${lvl}`
                  }
                >
                  {lvl} {lvl === "L2" && "(Rec.)"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              rows={3}
              className="w-full rounded border border-border bg-surface p-3 text-xs text-text-primary placeholder:text-text-disabled shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent resize-none font-sans"
              placeholder="Formulate your investigative query (e.g. Detect failed logins from external IPs followed by successful privilege escalation)..."
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
            />

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <Info className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>
                  Query execution is air-gapped and strictly compiler-verified via read-only DB connection.
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button type="submit" variant="default" size="sm">
                  <Send className="w-3 h-3 mr-1.5" /> Execute Investigation
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Investigation Pipeline / Progress Area */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded border border-border bg-surface flex items-start gap-2.5">
          <div className="p-1.5 rounded bg-surface-muted text-accent">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-text-primary">1. Privacy Gate</div>
            <div className="text-[10px] text-text-muted mt-0.5">Level {privacyLevel} Pseudonymized</div>
            <div className="text-[10px] text-status-success font-medium mt-1">✓ Complete</div>
          </div>
        </div>

        <div className="p-3 rounded border border-border bg-surface flex items-start gap-2.5">
          <div className="p-1.5 rounded bg-surface-muted text-blue-500">
            <Search className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-text-primary">2. Hybrid Retrieval</div>
            <div className="text-[10px] text-text-muted mt-0.5">FTS5 + Vector + RRF (k=60)</div>
            <div className="text-[10px] text-status-success font-medium mt-1">✓ 3 Artifacts Retriev.</div>
          </div>
        </div>

        <div className="p-3 rounded border border-border bg-surface flex items-start gap-2.5">
          <div className="p-1.5 rounded bg-surface-muted text-purple-500">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-text-primary">3. Local LLM Claims</div>
            <div className="text-[10px] text-text-muted mt-0.5">llama.cpp JSON Schema GBNF</div>
            <div className="text-[10px] text-status-success font-medium mt-1">✓ 3 Typed Claims Extracted</div>
          </div>
        </div>

        <div className="p-3 rounded border border-border bg-surface flex items-start gap-2.5">
          <div className="p-1.5 rounded bg-surface-muted text-status-success">
            <FileCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-text-primary">4. Predicate Compiler</div>
            <div className="text-[10px] text-text-muted mt-0.5">Deterministic SQL Verification</div>
            <div className="text-[10px] text-status-success font-medium mt-1">✓ Read-Only Verified</div>
          </div>
        </div>
      </div>

      {/* Results Workspace: Tabs for Findings, Retrieved Context, and Audit Provenance */}
      <Card>
        <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("findings")}
              className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                activeTab === "findings"
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-subtle"
              }`}
            >
              Verified Claims & Findings ({sampleFindings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("evidence")}
              className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                activeTab === "evidence"
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-subtle"
              }`}
            >
              Retrieved Context (3)
            </button>
          </div>

          <Badge variant="verified" icon={<CheckCircle2 className="w-3 h-3" />}>
            Investigation ID: {sampleInvestigation.investigationId}
          </Badge>
        </CardHeader>

        <CardContent className="p-5">
          {activeTab === "findings" && (
            <div className="space-y-4">
              <div className="text-xs text-text-muted mb-2">
                Compiler-evaluated forensic findings grounded in bit-level evidence:
              </div>

              {sampleFindings.map((finding) => (
                <div
                  key={finding.claimId}
                  className="rounded-lg border border-border p-4 bg-surface hover:border-border-strong transition-all space-y-3"
                >
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

                    <div className="text-[10px] font-mono text-text-muted">
                      Predicate: {finding.predicateName} (v{finding.predicateVersion})
                    </div>
                  </div>

                  <p className="text-xs font-medium text-text-primary leading-relaxed">
                    {finding.text}
                  </p>

                  {/* Evidence References */}
                  {finding.evidenceRefs.length > 0 && (
                    <div className="pt-2 border-t border-border-subtle">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                        Evidentiary Anchor:
                      </div>
                      <div className="space-y-1.5">
                        {finding.evidenceRefs.map((ref, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-surface-subtle border border-border-subtle font-mono text-[11px] flex items-center justify-between text-text-secondary"
                          >
                            <span>
                              <strong className="text-text-primary">{ref.sourceFileName}</strong>:
                              line {ref.lineNumber} (bytes {ref.byteStart}–{ref.byteEnd})
                            </span>
                            <span className="text-[10px] text-text-muted truncate max-w-sm ml-2">
                              {ref.snippet}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {finding.humanReviewReason && (
                    <div className="p-2 rounded bg-status-warning-bg text-status-warning text-xs border border-amber-200 dark:border-amber-900/40">
                      <strong>Reason for Review:</strong> {finding.humanReviewReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === "evidence" && (
            <div className="space-y-3 text-xs">
              <div className="text-text-muted">
                Chunks retrieved via Reciprocal Rank Fusion (RRF) and Cross-Encoder reranking:
              </div>
              <div className="p-3 rounded border border-border bg-surface-subtle font-mono text-[11px] space-y-1">
                <div className="text-accent font-semibold">auth.log (Rank #1, Score: 0.94)</div>
                <div className="text-text-primary">
                  Jan 15 10:20:30 auth-gw sshd[1001]: Failed password for invalid user hacker from 93.184.216.34 port 45678 ssh2
                </div>
              </div>
              <div className="p-3 rounded border border-border bg-surface-subtle font-mono text-[11px] space-y-1">
                <div className="text-accent font-semibold">auth.log (Rank #2, Score: 0.91)</div>
                <div className="text-text-primary">
                  Jan 15 10:20:40 auth-gw sshd[1003]: Invalid user admin from 10.0.0.99 port 33333
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
