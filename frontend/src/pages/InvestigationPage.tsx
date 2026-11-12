import { useState } from "react";
import { Search, Sparkles, Shield, FileCheck, Cpu, ScanSearch, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { Badge, ClaimStatusBadge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { EvidenceText } from "@/components/ui/DataDisplay";
import { PreviewModuleNotice } from "@/components/common/Notice";
import { FIXTURE_INVESTIGATIONS } from "@/fixtures/investigations";
import { FIXTURE_FINDINGS } from "@/fixtures/findings";

const PIPELINE = [
  { n: 1, title: "Privacy gate", detail: "Pseudonymize identities at the selected level (L0–L3)", icon: Shield },
  { n: 2, title: "Hybrid retrieval", detail: "FTS5 + vector search fused with RRF", icon: Search },
  { n: 3, title: "Local claim extraction", detail: "Schema-constrained output from a local model", icon: Cpu },
  { n: 4, title: "Deterministic verification", detail: "Read-only predicate evaluation per claim", icon: FileCheck },
];

const SAMPLE_CONTEXT = [
  "Jan 15 10:20:30 auth-gw sshd[1001]: Failed password for invalid user hacker from 93.184.216.34 port 45678 ssh2",
  "Jan 15 10:20:40 auth-gw sshd[1003]: Invalid user admin from 10.0.0.99 port 33333",
];

export function InvestigationPage() {
  const [queryInput, setQueryInput] = useState(
    "Identify public IP addresses conducting brute-force authentication against port 22 between 10:00 and 11:00 UTC"
  );
  const [activeTab, setActiveTab] = useState<"findings" | "evidence">("findings");

  const sampleInvestigation = FIXTURE_INVESTIGATIONS[0];
  const sampleFindings = FIXTURE_FINDINGS.filter((f) => f.investigationId === sampleInvestigation.investigationId);

  return (
    <>
      <PageHeader
        title="Investigation"
        meta={<Badge variant="warning">Preview</Badge>}
        showFixtureBadge={false}
        description="Planned end-to-end workflow: one investigative question runs privacy gating, retrieval, claim extraction and verification in sequence."
      />

      <div className="space-y-5">
        <PreviewModuleNotice module="Investigation" />

        <Panel title="Use the working equivalents today" icon={<Sparkles />}>
          <p className="mb-3 text-xs text-text-muted">
            The individual stages are implemented and connected to the backend. Run them step by step:
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton to="/retrieval" variant="secondary" size="sm">
              <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
              Retrieval Explorer
            </LinkButton>
            <LinkButton to="/claims" variant="secondary" size="sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Claim Verification
            </LinkButton>
          </div>
        </Panel>

        <Panel title="Investigative question" icon={<Search />} actions={<Badge variant="outline">Not connected</Badge>}>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
            <label htmlFor="investigation-query" className="sr-only">
              Investigative question
            </label>
            <Textarea
              id="investigation-query"
              rows={3}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              aria-describedby="investigation-query-note"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="investigation-query-note" className="text-2xs text-text-muted">
                Execution is disabled: no investigation endpoint exists on the backend yet.
              </p>
              <Button type="submit" variant="primary" size="sm" disabled>
                Run investigation
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Planned pipeline" flush>
          <ol className="grid grid-cols-1 divide-y divide-border-subtle md:grid-cols-4 md:divide-x md:divide-y-0">
            {PIPELINE.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.n} className="flex items-start gap-2.5 px-4 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-surface-subtle font-mono text-2xs text-text-muted">
                    {s.n}
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5 text-sm text-text-primary">
                      <Icon className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                      {s.title}
                    </span>
                    <span className="block text-2xs text-text-muted">{s.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel
          title="Sample output"
          description="Illustrative fixture data showing the intended result layout — not derived from any case."
          flush
          actions={<Badge variant="warning">Sample data</Badge>}
        >
          <div className="border-b border-border">
            <Tabs<"findings" | "evidence">
              label="Sample output sections"
              idPrefix="inv-sample"
              value={activeTab}
              onChange={setActiveTab}
              items={[
                { id: "findings", label: "Findings", count: sampleFindings.length },
                { id: "evidence", label: "Retrieved context", count: SAMPLE_CONTEXT.length },
              ]}
            />
          </div>
          <div className="p-4">
            {activeTab === "findings" && (
              <TabPanel idPrefix="inv-sample" id="findings">
                <ul className="space-y-3">
                  {sampleFindings.map((finding) => (
                    <li key={finding.claimId} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-text-primary">{finding.claimId}</span>
                        <ClaimStatusBadge status={finding.status} />
                        <span className="font-mono text-2xs text-text-muted">
                          {finding.predicateName} v{finding.predicateVersion}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary">{finding.text}</p>
                      {finding.evidenceRefs.map((ref, i) => (
                        <p key={i} className="font-mono text-2xs text-text-muted">
                          {ref.sourceFileName}:{ref.lineNumber} · bytes {ref.byteStart}–{ref.byteEnd}
                        </p>
                      ))}
                      {finding.humanReviewReason && (
                        <p className="text-xs text-status-human">Review reason: {finding.humanReviewReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </TabPanel>
            )}
            {activeTab === "evidence" && (
              <TabPanel idPrefix="inv-sample" id="evidence">
                <div className="space-y-2">
                  {SAMPLE_CONTEXT.map((line, i) => (
                    <div key={i}>
                      <p className="mb-1 font-mono text-2xs text-text-muted">Sample record #{i + 1}</p>
                      <EvidenceText>{line}</EvidenceText>
                    </div>
                  ))}
                </div>
              </TabPanel>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
