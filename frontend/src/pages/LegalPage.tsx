import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FIXTURE_LEGAL } from "@/fixtures/legal";
import { LegalProvision, LegalStatus } from "@/types/legal";
import {
  Scale,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export function LegalPage() {
  const [provisions] = useState<LegalProvision[]>(FIXTURE_LEGAL);
  const [expandedId, setExpandedId] = useState<string | null>("LEG-BSA-63");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filteredProvisions = useMemo(() => {
    return provisions.filter(
      (p) => statusFilter === "ALL" || p.legalStatus === statusFilter
    );
  }, [provisions, statusFilter]);

  const getStatusBadge = (status: LegalStatus) => {
    switch (status) {
      case "IN_FORCE":
        return (
          <Badge variant="verified" icon={<CheckCircle2 className="w-3 h-3 text-status-success" />}>
            IN FORCE
          </Badge>
        );
      case "STRUCK_DOWN":
        return (
          <Badge variant="danger" icon={<XCircle className="w-3 h-3 text-status-danger" />}>
            STRUCK DOWN (VOID)
          </Badge>
        );
      case "SUPERSEDED":
        return (
          <Badge variant="warning" icon={<AlertTriangle className="w-3 h-3 text-status-warning" />}>
            SUPERSEDED
          </Badge>
        );
      case "REPEALED":
        return (
          <Badge variant="neutral" icon={<HelpCircle className="w-3 h-3 text-status-neutral" />}>
            REPEALED
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indian Statutory Mapping & Evidentiary Framework"
        description="Statutory reference mapping and element coverage analysis (Bharatiya Sakshya Adhiniyam, 2023, Information Technology Act, 2000, and Bharatiya Nyaya Sanhita, 2023). Maps observed technical indicators to potentially relevant provisions without executing legal conclusions."
      />

      {/* Guidance Banner */}
      <div className="p-3.5 rounded-lg border border-purple-200 dark:border-purple-950/60 bg-status-human-bg flex items-start gap-3 text-xs text-text-secondary">
        <Scale className="w-4 h-4 text-status-human shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-text-primary">
            Judicial Integrity Notice (Human-in-the-Loop Principle):
          </div>
          <p className="leading-relaxed">
            ForensicLens identifies <em>potentially relevant provisions</em> and technical element alignment for expert forensic review. Software does not determine legal guilt or statutory violations. Final legal conclusions require human judicial evaluation.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted font-medium">Filter by Status:</span>
        {(["ALL", "IN_FORCE", "SUPERSEDED", "STRUCK_DOWN"] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`text-xs px-2.5 py-1 rounded transition-colors font-medium ${
              statusFilter === st
                ? "bg-accent text-white"
                : "bg-surface text-text-secondary border border-border hover:bg-surface-muted"
            }`}
          >
            {st.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Legal Provisions List */}
      <div className="space-y-4">
        {filteredProvisions.map((item) => {
          const isExpanded = expandedId === item.provisionId;
          return (
            <Card
              key={item.provisionId}
              className={`transition-colors ${
                item.legalStatus === "IN_FORCE"
                  ? "border-border hover:border-border-strong"
                  : "opacity-75 bg-surface-subtle/30"
              }`}
            >
              <CardHeader
                className="cursor-pointer py-3.5 select-none hover:bg-surface-subtle/40 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : item.provisionId)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold text-accent">
                      {item.section}
                    </span>
                    <span className="text-xs font-semibold text-text-primary">
                      {item.act}
                    </span>
                    {getStatusBadge(item.legalStatus)}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-text-muted">
                      Relevance: {(item.relevanceScore * 100).toFixed(0)}%
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </div>

                <div className="text-xs text-text-secondary font-medium mt-1">
                  {item.title}
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="p-4 pt-2 border-t border-border-subtle space-y-4">
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {item.description}
                  </p>

                  {/* Coverage Summary */}
                  <div className="p-2.5 rounded bg-surface-subtle border border-border-subtle text-xs">
                    <span className="font-semibold text-text-primary">Coverage Assessment: </span>
                    <span className="text-text-secondary">{item.coverageSummary}</span>
                  </div>

                  {/* Elements of Offence / Admissibility */}
                  {item.elements.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Technical Element Alignment:
                      </div>
                      <div className="space-y-2">
                        {item.elements.map((elem) => (
                          <div
                            key={elem.elementId}
                            className="p-3 rounded border border-border bg-surface flex items-start gap-2.5 text-xs"
                          >
                            {elem.covered ? (
                              <CheckCircle2 className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
                            ) : (
                              <HelpCircle className="w-4 h-4 text-status-human shrink-0 mt-0.5" />
                            )}
                            <div className="space-y-1">
                              <div className="font-semibold text-text-primary flex items-center gap-2">
                                <span>{elem.name}</span>
                                <Badge variant={elem.covered ? "verified" : "human"} className="text-[10px]">
                                  {elem.covered ? "SUPPORTED IN TELEMETRY" : "REQUIRES HUMAN JUDGMENT"}
                                </Badge>
                              </div>
                              <p className="text-text-muted text-[11px]">{elem.description}</p>
                              {elem.notes && (
                                <p className="text-[11px] font-mono text-text-secondary">
                                  Note: {elem.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Caveat */}
                  <div className="p-2.5 rounded border border-amber-200 dark:border-amber-900/50 bg-status-warning-bg text-status-warning text-xs">
                    <strong>Caveat:</strong> {item.caveatNotes}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
