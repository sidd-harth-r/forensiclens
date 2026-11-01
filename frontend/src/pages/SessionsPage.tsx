import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { getSessions } from "@/services/sessions";
import { ForensicSession, PaginatedSessions, SessionEvent, SessionStatus } from "@/types/session";
import { formatDateTime } from "@/lib/formatters";
import {
  Layers,
  Clock,
  User,
  Globe,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Eye,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Activity,
  HardDrive,
} from "lucide-react";

export function SessionsPage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedSessions>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Inspector & detail selection
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());

  const loadSessions = useCallback(async () => {
    if (!currentCase?.caseId) {
      setPaginatedData({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await getSessions(currentCase.caseId, {
        page: currentPage,
        pageSize: 20,
        user: userFilter.trim() || undefined,
        srcIp: ipFilter.trim() || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reconstructed sessions");
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId, currentPage, userFilter, ipFilter, statusFilter]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleResetFilters = () => {
    setUserFilter("");
    setIpFilter("");
    setStatusFilter("ALL");
    setCurrentPage(1);
  };

  const toggleExpand = (sessionId: string) => {
    setExpandedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (userFilter.trim()) count++;
    if (ipFilter.trim()) count++;
    if (statusFilter !== "ALL") count++;
    return count;
  }, [userFilter, ipFilter, statusFilter]);

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return "< 1s";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = (status: SessionStatus) => {
    switch (status) {
      case "CLOSED":
        return (
          <Badge variant="verified" icon={<CheckCircle2 className="w-3 h-3 text-status-success" />}>
            CLOSED
          </Badge>
        );
      case "OPEN":
        return (
          <Badge variant="accent" icon={<Activity className="w-3 h-3 text-accent" />}>
            OPEN
          </Badge>
        );
      case "INCOMPLETE":
      default:
        return (
          <Badge variant="warning" icon={<AlertTriangle className="w-3 h-3 text-status-warning" />}>
            INCOMPLETE
          </Badge>
        );
    }
  };

  if (loading && paginatedData.items.length === 0) {
    return <LoadingState message="Reconstructing forensic sessions from persisted events..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="SESSION RECONSTRUCTION"
          description="Deterministic temporal and identity correlation of forensic events into investigative sessions."
        />
        <ErrorState
          title="Failed to Load Sessions"
          message={error}
          onRetry={loadSessions}
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
        title="SESSION RECONSTRUCTION"
        description="Deterministic temporal and identity correlation of forensic events into investigative sessions. Correlation basis is explicit and auditable."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/timeline">
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <Clock className="w-3.5 h-3.5 text-accent" />
                <span>View Timeline</span>
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-text-muted">Status:</span>
              {(["ALL", "CLOSED", "OPEN", "INCOMPLETE"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStatusFilter(st);
                    setCurrentPage(1);
                  }}
                  className={`text-[11px] px-2.5 py-0.5 rounded transition-colors font-medium ${
                    statusFilter === st
                      ? "bg-accent text-white"
                      : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={`text-xs h-7 gap-1.5 ${
                  showFilters ? "bg-accent-subtle text-accent border-accent/40" : ""
                }`}
                onClick={() => setShowFilters((prev) => !prev)}
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

          {/* Expandable filters */}
          {showFilters && (
            <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  User Account Filter
                </label>
                <Input
                  placeholder="e.g. admin, root"
                  value={userFilter}
                  onChange={(e) => {
                    setUserFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Source IP Filter
                </label>
                <Input
                  placeholder="e.g. 192.168.1.10"
                  value={ipFilter}
                  onChange={(e) => {
                    setIpFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sessions List */}
      <Card>
        <CardHeader className="py-3 px-5 flex flex-row items-center justify-between border-b border-border bg-surface-subtle">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent" />
            <CardTitle className="text-sm font-semibold">Reconstructed Forensic Sessions</CardTitle>
          </div>
          <Badge variant="accent" className="font-mono text-xs">
            {total} Sessions Correlated
          </Badge>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {items.length === 0 ? (
            <div className="py-8">
              <EmptyState
                icon={<Layers className="w-8 h-8 text-text-disabled" />}
                title="No forensic sessions found"
                description={
                  activeFiltersCount > 0
                    ? "No sessions match current filter criteria."
                    : `No sessions could be reconstructed from case ${currentCase?.caseId || ""}. Process evidence artifacts to generate events.`
                }
                actionLabel={activeFiltersCount > 0 ? "Reset Filters" : undefined}
                onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
              />
            </div>
          ) : (
            <>
              <div className="space-y-4" role="feed" aria-label="Forensic Sessions Feed">
                {items.map((session: ForensicSession) => {
                  const isExpanded = expandedSessionIds.has(session.sessionId);

                  return (
                    <article
                      key={session.sessionId}
                      className="rounded-lg border border-border bg-surface shadow-xs hover:border-border-strong transition-all overflow-hidden"
                      aria-labelledby={`session-title-${session.sessionId}`}
                    >
                      {/* Session Header Strip */}
                      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span
                            id={`session-title-${session.sessionId}`}
                            className="font-mono text-xs font-bold text-text-primary px-2 py-0.5 rounded bg-surface border border-border"
                          >
                            {session.sessionId}
                          </span>
                          {getStatusBadge(session.status)}
                          <span className="font-mono text-xs text-text-secondary">
                            {session.eventCount} {session.eventCount === 1 ? "Event" : "Events"}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                          <div className="flex items-center gap-1 font-mono">
                            <Clock className="w-3.5 h-3.5 text-text-disabled" />
                            <span>
                              {formatDateTime(session.startTime)} → {formatDateTime(session.endTime)}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-surface border border-border font-medium text-text-primary">
                            Duration: {formatDuration(session.durationSeconds)}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                        {/* Actor Identity & Host Meta */}
                        <div className="flex items-center gap-4 text-xs flex-wrap">
                          <div className="flex items-center gap-1.5 font-mono">
                            <User className="w-3.5 h-3.5 text-accent" />
                            <span className="text-text-muted">User:</span>
                            <strong className="text-text-primary font-medium">
                              {session.user || "Unattributed"}
                            </strong>
                          </div>

                          <div className="flex items-center gap-1.5 font-mono">
                            <Globe className="w-3.5 h-3.5 text-accent" />
                            <span className="text-text-muted">Source IP:</span>
                            <strong className="text-text-primary font-medium">
                              {session.srcIp || "Local / None"}
                            </strong>
                          </div>

                          {session.host && (
                            <div className="text-text-muted font-mono text-[11px]">
                              Host: <span className="text-text-primary">{session.host}</span>
                            </div>
                          )}
                        </div>

                        {/* Event Sequence Visual Flow */}
                        <div>
                          <div className="text-[11px] font-medium text-text-muted mb-2 uppercase tracking-wider">
                            Event Sequence Flow (Click to Inspect)
                          </div>

                          <div
                            className="flex items-center gap-1.5 flex-wrap py-2 px-3 rounded bg-surface-subtle border border-border overflow-x-auto"
                            role="list"
                            aria-label={`Event flow for ${session.sessionId}`}
                          >
                            {session.events.map((ev: SessionEvent, evIdx: number) => (
                              <React.Fragment key={ev.eventId}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEventId(ev.eventId)}
                                  className="font-mono text-xs px-2.5 py-1 rounded border border-border bg-surface hover:border-accent hover:bg-accent-subtle hover:text-accent font-semibold transition-all focus:outline-none focus:ring-1 focus:ring-accent"
                                  title={`${ev.eventType}: ${ev.summary} (${formatDateTime(ev.timestamp || ev.timestampOriginal)})`}
                                  aria-label={`Inspect event ${ev.eventType}`}
                                >
                                  {ev.eventType}
                                </button>
                                {evIdx < session.events.length - 1 && (
                                  <ArrowRight className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden="true" />
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>

                        {/* Correlation Transparency Basis */}
                        <div className="p-3 rounded-lg border border-border-subtle bg-surface-subtle/60 text-xs">
                          <div className="font-semibold text-text-muted text-[11px] mb-1.5 flex items-center gap-1.5">
                            <HelpCircle className="w-3.5 h-3.5 text-accent" />
                            <span>Deterministic Correlation Basis</span>
                          </div>
                          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-text-secondary font-mono">
                            {session.correlationBasis.map((basis: string, bIdx: number) => (
                              <li key={bIdx}>{basis}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Expand / Collapse Action */}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => toggleExpand(session.sessionId)}
                            className="text-xs text-accent hover:underline font-medium flex items-center gap-1"
                          >
                            <span>{isExpanded ? "Hide Detailed Event List" : "Show Detailed Event List"}</span>
                            <span>({session.events.length})</span>
                          </button>

                          <Link
                            to={`/timeline?user=${encodeURIComponent(session.user || "")}&src_ip=${encodeURIComponent(
                              session.srcIp || ""
                            )}`}
                            className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 font-mono"
                          >
                            <span>View in Timeline</span>
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>

                        {/* Expanded Detailed Events List */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border space-y-2">
                            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                              Correlated Event Records
                            </div>
                            <div className="space-y-1.5">
                              {session.events.map((ev: SessionEvent) => (
                                <div
                                  key={ev.eventId}
                                  onClick={() => setSelectedEventId(ev.eventId)}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded bg-surface-subtle border border-border hover:border-accent cursor-pointer transition-colors text-xs gap-2"
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedEventId(ev.eventId);
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-2 flex-wrap font-mono">
                                    <span className="font-bold text-text-primary">{ev.eventType}</span>
                                    <span className="text-[11px] text-text-muted truncate max-w-sm">
                                      {ev.summary}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted shrink-0">
                                    <span>{formatDateTime(ev.timestamp || ev.timestampOriginal)}</span>
                                    {ev.evidenceOriginalName && (
                                      <span className="flex items-center gap-1 text-text-secondary">
                                        <HardDrive className="w-3 h-3" />
                                        {ev.evidenceOriginalName}
                                      </span>
                                    )}
                                    <span className="text-accent flex items-center gap-0.5">
                                      <Eye className="w-3 h-3" />
                                      Inspect
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Bounded Pagination Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-border text-xs text-text-secondary">
                <div className="font-mono">
                  Showing <span className="font-semibold text-text-primary">{startCount}</span> to{" "}
                  <span className="font-semibold text-text-primary">{endCount}</span> of{" "}
                  <span className="font-semibold text-text-primary">{total}</span> sessions
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

