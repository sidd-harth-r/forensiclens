import { useState, useMemo } from "react";
import { Scale, CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Notice, PreviewModuleNotice } from "@/components/common/Notice";
import { FIXTURE_LEGAL } from "@/fixtures/legal";
import { LegalStatus } from "@/types/legal";
import { cn } from "@/lib/utils";

const FILTERS = ["ALL", "IN_FORCE", "SUPERSEDED", "STRUCK_DOWN"] as const;
type Filter = (typeof FILTERS)[number];

function LegalStatusBadge({ status }: { status: LegalStatus }) {
  switch (status) {
    case "IN_FORCE":
      return (
        <Badge variant="verified" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>
          In force
        </Badge>
      );
    case "STRUCK_DOWN":
      return (
        <Badge variant="danger" icon={<XCircle className="h-3 w-3" aria-hidden="true" />}>
          Struck down
        </Badge>
      );
    case "SUPERSEDED":
      return (
        <Badge variant="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
          Superseded
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" icon={<HelpCircle className="h-3 w-3" aria-hidden="true" />}>
          Repealed
        </Badge>
      );
  }
}

export function LegalPage() {
  const [expandedId, setExpandedId] = useState<string | null>(FIXTURE_LEGAL[0]?.provisionId ?? null);
  const [statusFilter, setStatusFilter] = useState<Filter>("ALL");

  const filtered = useMemo(
    () => FIXTURE_LEGAL.filter((p) => statusFilter === "ALL" || p.legalStatus === statusFilter),
    [statusFilter]
  );

  return (
    <>
      <PageHeader
        title="Legal Mapping"
        meta={<Badge variant="warning">Preview</Badge>}
        showFixtureBadge={false}
        description="Planned mapping of verified technical findings to potentially relevant provisions of the Bharatiya Sakshya Adhiniyam 2023, IT Act 2000 and Bharatiya Nyaya Sanhita 2023."
      />

      <div className="space-y-5">
        <PreviewModuleNotice module="Legal Mapping" />

        <Notice tone="info" title="Human-in-the-loop principle" icon={<Scale />}>
          ForensicLens is designed to surface <em>potentially relevant</em> provisions and element alignment for expert
          review. Software does not determine guilt or statutory violation; legal conclusions require human evaluation.
        </Notice>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2.5">
            <SegmentedControl<Filter>
              label="Filter by legal status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={FILTERS.map((f) => ({
                value: f,
                label: f === "ALL" ? "All" : f.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
              }))}
            />
            <Badge variant="warning" className="ml-auto">
              Sample data
            </Badge>
          </div>

          <ul className="divide-y divide-border-subtle">
            {filtered.map((item) => {
              const isExpanded = expandedId === item.provisionId;
              const panelId = `provision-${item.provisionId}`;
              return (
                <li key={item.provisionId} className={cn(item.legalStatus !== "IN_FORCE" && "bg-surface-subtle/40")}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : item.provisionId)}
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-accent-text">{item.section}</span>
                        <span className="text-xs text-text-secondary">{item.act}</span>
                        <LegalStatusBadge status={item.legalStatus} />
                      </span>
                      <span className="mt-0.5 block text-sm text-text-primary">{item.title}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-2xs text-text-muted">relevance {(item.relevanceScore * 100).toFixed(0)}%</span>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div id={panelId} className="space-y-3 px-4 pb-4">
                      <p className="text-xs leading-relaxed text-text-secondary">{item.description}</p>
                      <p className="rounded border border-border-subtle bg-surface-subtle px-3 py-2 text-xs">
                        <span className="font-medium text-text-primary">Coverage: </span>
                        <span className="text-text-secondary">{item.coverageSummary}</span>
                      </p>

                      {item.elements.length > 0 && (
                        <div>
                          <h3 className="label-caps mb-1.5">Element alignment</h3>
                          <ul className="divide-y divide-border-subtle rounded border border-border">
                            {item.elements.map((elem) => (
                              <li key={elem.elementId} className="flex items-start gap-2.5 px-3 py-2 text-xs">
                                {elem.covered ? (
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden="true" />
                                ) : (
                                  <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-human" aria-hidden="true" />
                                )}
                                <span className="min-w-0 space-y-0.5">
                                  <span className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-text-primary">{elem.name}</span>
                                    <Badge variant={elem.covered ? "verified" : "human"}>
                                      {elem.covered ? "Supported by telemetry" : "Requires human judgment"}
                                    </Badge>
                                  </span>
                                  <span className="block text-text-muted">{elem.description}</span>
                                  {elem.notes && <span className="block font-mono text-2xs text-text-secondary">Note: {elem.notes}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <p className="rounded border border-status-warning/30 bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
                        <span className="font-medium">Caveat:</span> {item.caveatNotes}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
