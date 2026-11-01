import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getTimeline } from "@/services/timeline";
import { PaginatedTimeline, TimelineItem } from "@/types/timeline";
import { EventSeverity } from "@/types/event";
import { formatDateTime } from "@/lib/formatters";
import {
  Clock,
  ShieldAlert,
  LogIn,
  LogOut,
  Activity,
  SlidersHorizontal,
  Layers,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Eye,
  User,
  Globe,
  ArrowRight,
} from "lucide-react";

export function TimelinePage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedTimeline>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Event Inspector Modal
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const loadTimeline = useCallback(async () => {
    if (!currentCase?.caseId) {
      setPaginatedData({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await getTimeline(currentCase.caseId, {
        page: currentPage,
        pageSize: 50,
        eventType: typeFilter !== "ALL" ? typeFilter : undefined,
        severity: severityFilter !== "ALL" ? severityFilter : undefined,
        user: userFilter.trim() || undefined,
        srcIp: ipFilter.trim() || undefined,
        from: fromTime.trim() || undefined,
        to: toTime.trim() || undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forensic timeline");
    } finally {
      setLoading(false);
    }
  }, [
    currentCase?.caseId,
    currentPage,
    typeFilter,
    severityFilter,
    userFilter,
    ipFilter,
    fromTime,
    toTime,
  ]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const handleResetFilters = () => {
    setTypeFilter("ALL");
    setSeverityFilter("ALL");
    setUserFilter("");
    setIpFilter("");
    setFromTime("");
    setToTime("");
    setCurrentPage(1);
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (typeFilter !== "ALL") count++;
    if (severityFilter !== "ALL") count++;
    if (userFilter.trim()) count++;
    if (ipFilter.trim()) count++;
    if (fromTime.trim()) count++;
    if (toTime.trim()) count++;
    return count;
  }, [typeFilter, severityFilter, userFilter, ipFilter, fromTime, toTime]);

  const getTimelineIcon = (eventType: string) => {
    switch (eventType) {
      case "AUTH_SUCCESS":
      case "SESSION_OPENED":
        return <LogIn className="w-3.5 h-3.5 text-status-success" aria-hidden="true" />;
      case "AUTH_FAILURE":
      case "INVALID_USER":
        return <ShieldAlert className="w-3.5 h-3.5 text-status-danger" aria-hidden="true" />;
      case "DISCONNECT":
      case "SESSION_CLOSED":
        return <LogOut className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-accent" aria-hidden="true" />;
    }
  };

  const getSeverityBadgeVariant = (severity: EventSeverity) => {
    switch (severity) {
      case "CRITICAL":
        return "danger";
      case "WARNING":
        return "warning";
      case "INFO":
      default:
        return "default";
    }
  };

  if (loading && paginatedData.items.length === 0) {
    return <LoadingState message="Reconstructing forensic event timeline..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="FORENSIC TIMELINE"
          description="Chronological reconstruction of events across the selected case."
        />
        <ErrorState
          title="Failed to Load Timeline"
          message={error}
          onRetry={loadTimeline}
        />
      </div>
    );
  }

  const { items, total, page, pageSize, totalPages } = paginatedData;
  const startCount = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endCount = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="FORENSIC TIMELINE"
        description="Chronological reconstruction of events across the selected case. Order derived deterministically from timestamp and audit sequence."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/sessions">
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <Layers className="w-3.5 h-3.5 text-accent" />
                <span>View Correlated Sessions</span>
                <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
              </Button>
            </Link>
          </div>
        }
      />

      {/* Filter Card */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">Type:</span>
                {(
                  [
                    "ALL",
                    "AUTH_FAILURE",
                    "AUTH_SUCCESS",
                    "SESSION_OPENED",
                    "SESSION_CLOSED",
                    "DISCONNECT",
                  ] as const
                ).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => {
                      setTypeFilter(tp);
                      setCurrentPage(1);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors font-medium ${
                      typeFilter === tp
                        ? "bg-accent text-white"
                        : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                    }`}
                  >
                    {tp}
                  </button>
                ))}
              </div>

              <div className="h-4 w-[1px] bg-border hidden sm:block" />

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">Severity:</span>
                {(["ALL", "INFO", "WARNING", "CRITICAL"] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => {
                      setSeverityFilter(sev);
                      setCurrentPage(1);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors font-medium ${
                      severityFilter === sev
                        ? "bg-accent text-white"
                        : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={`text-xs h-7 gap-1.5 ${
                  showAdvancedFilters ? "bg-accent-subtle text-accent border-accent/40" : ""
                }`}
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-accent text-white font-mono">
                    {activeFiltersCount}
                  </span>
                )}
              </Button>

              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-text-muted hover:text-text-primary"
                  onClick={handleResetFilters}
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Collapsible Filter Expansion */}
          {showAdvancedFilters && (
            <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  User Filter
                </label>
                <Input
                  placeholder="e.g. root, admin"
                  value={userFilter}
                  onChange={(e) => {
                    setUserFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Source IP Filter
                </label>
                <Input
                  placeholder="e.g. 192.168.1.100"
                  value={ipFilter}
                  onChange={(e) => {
                    setIpFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  From Timestamp
                </label>
                <Input
                  placeholder="e.g. 2026-01-15T10:00:00"
                  value={fromTime}
                  onChange={(e) => {
                    setFromTime(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  To Timestamp
                </label>
                <Input
                  placeholder="e.g. 2026-01-15T11:00:00"
                  value={toTime}
                  onChange={(e) => {
                    setToTime(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline View */}
      <Card>
        <CardHeader className="py-3 px-5 flex flex-row items-center justify-between border-b border-border bg-surface-subtle">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <CardTitle className="text-sm font-semibold">Chronological Event Sequence</CardTitle>
          </div>
          <Badge variant="accent" className="font-mono text-xs">
            {total} Events Sequenced
          </Badge>
        </CardHeader>

        <CardContent className="p-6">
          {items.length === 0 ? (
            <div className="py-8">
              <EmptyState
                icon={<Clock className="w-8 h-8 text-text-disabled" />}
                title="No timeline events found"
                description={
                  activeFiltersCount > 0
                    ? "No events match current filter criteria."
                    : `No forensic events recorded for case ${currentCase?.caseId || ""}.`
                }
                actionLabel={activeFiltersCount > 0 ? "Reset Filters" : undefined}
                onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
              />
            </div>
          ) : (
            <>
              {/* Semantic list with accessible role */}
              <ol
                className="relative border-l-2 border-border ml-3 sm:ml-6 space-y-6 pl-6 py-2"
                aria-label="Chronological Forensic Events"
              >
                {items.map((ev: TimelineItem) => (
                  <li key={ev.eventId} className="relative group">
                    {/* Node marker */}
                    <div
                      className="absolute -left-[31px] top-2 w-6 h-6 rounded-full bg-surface border-2 border-border group-hover:border-accent flex items-center justify-center transition-colors shadow-xs"
                      aria-hidden="true"
                    >
                      {getTimelineIcon(ev.eventType)}
                    </div>

                    {/* Interactive Event Card */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedEventId(ev.eventId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedEventId(ev.eventId);
                        }
                      }}
                      className="rounded-lg border border-border bg-surface p-4 hover:border-border-strong hover:shadow-xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
                      aria-label={`Event ${ev.eventType} at ${ev.timestamp || ev.timestampOriginal}: ${ev.summary}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border-subtle">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-text-primary">
                            {ev.eventType}
                          </span>
                          <Badge variant={getSeverityBadgeVariant(ev.severity)}>
                            {ev.severity}
                          </Badge>
                          {ev.evidenceOriginalName && (
                            <span className="text-[11px] text-text-muted font-mono flex items-center gap-1">
                              <HardDrive className="w-3 h-3 text-text-disabled" />
                              {ev.evidenceOriginalName}
                            </span>
                          )}
                        </div>

                        <div className="font-mono text-[11px] text-text-muted flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 text-text-disabled" />
                          <span title={`Original: ${ev.timestampOriginal || "N/A"}`}>
                            {formatDateTime(ev.timestamp || ev.timestampOriginal)}
                          </span>
                        </div>
                      </div>

                      {/* Summary message */}
                      <div className="mt-2.5 font-mono text-xs text-text-primary bg-surface-subtle p-2.5 rounded border border-border-subtle break-all">
                        {ev.summary}
                      </div>

                      {/* Metadata Chips & Inspector Hint */}
                      <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-muted flex-wrap gap-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          {ev.user && (
                            <span className="flex items-center gap-1 font-mono">
                              <User className="w-3 h-3 text-text-disabled" />
                              <strong className="text-text-primary font-medium">{ev.user}</strong>
                            </span>
                          )}

                          {ev.srcIp && (
                            <span className="flex items-center gap-1 font-mono">
                              <Globe className="w-3 h-3 text-text-disabled" />
                              <strong className="text-text-primary font-medium">{ev.srcIp}</strong>
                              {ev.srcPort && (
                                <span className="text-[10px] text-text-muted">:{ev.srcPort}</span>
                              )}
                            </span>
                          )}

                          {ev.host && (
                            <span className="font-mono text-text-secondary">Host: {ev.host}</span>
                          )}

                          {ev.lineNumber != null && (
                            <span className="font-mono text-[10px] text-text-muted">
                              Line {ev.lineNumber}
                            </span>
                          )}
                        </div>

                        <span className="inline-flex items-center gap-1 text-[11px] text-accent font-medium group-hover:underline">
                          <Eye className="w-3 h-3" />
                          <span>Inspect Provenance</span>
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              {/* Bounded Pagination Footer */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-border text-xs text-text-secondary">
                <div className="font-mono">
                  Showing <span className="font-semibold text-text-primary">{startCount}</span> to{" "}
                  <span className="font-semibold text-text-primary">{endCount}</span> of{" "}
                  <span className="font-semibold text-text-primary">{total}</span> timeline events
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                    Previous
                  </Button>
                  <span className="font-mono text-xs px-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Shared Event Inspector Modal */}
      <EventInspectorModal
        eventId={selectedEventId}
        caseId={currentCase?.caseId}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}
