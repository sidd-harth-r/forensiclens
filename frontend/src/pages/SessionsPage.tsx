import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Layers,
  User,
  Globe,
  ArrowRight,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  Activity,
  GanttChart,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Server,
  Info,
} from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope, FilterBar } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Badge, SeverityBadge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Pagination, IdValue } from "@/components/ui/DataDisplay";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getSessions } from "@/services/sessions";
import { ForensicSession, PaginatedSessions, SessionEvent, SessionStatus } from "@/types/session";
import { formatDateTime, describeError } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const STATUSES = ["ALL", "CLOSED", "OPEN", "INCOMPLETE"] as const;
type StatusFilter = (typeof STATUSES)[number];
const PAGE_SIZE = 20;

function formatDuration(seconds: number) {
  if (seconds <= 0) return "< 1s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function SessionStatusBadge({ status }: { status: SessionStatus }) {
  switch (status) {
    case "CLOSED":
      return (
        <Badge variant="verified" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>
          Closed
        </Badge>
      );
    case "OPEN":
      return (
        <Badge variant="accent" icon={<Activity className="h-3 w-3" aria-hidden="true" />}>
          Open
        </Badge>
      );
    default:
      return (
        <Badge variant="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
          Incomplete
        </Badge>
      );
  }
}

export function SessionsPage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedSessions>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());

  const loadSessions = useCallback(async () => {
    if (!currentCase?.caseId) {
      setPaginatedData({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await getSessions(currentCase.caseId, {
        page: currentPage,
        pageSize: PAGE_SIZE,
        user: userFilter.trim() || undefined,
        srcIp: ipFilter.trim() || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(describeError(err, "Failed to load reconstructed sessions"));
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
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const advancedCount = [userFilter, ipFilter].filter((v) => v.trim()).length;
  const activeFiltersCount = useMemo(() => advancedCount + (statusFilter !== "ALL" ? 1 : 0), [advancedCount, statusFilter]);

  const { items, total, page, pageSize, totalPages } = paginatedData;

  return (
    <>
      <PageHeader
        title="Sessions"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description="Events correlated into sessions by identity and time. The correlation basis for every session is listed explicitly."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading} aria-label="Refresh sessions">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
            <LinkButton to="/timeline" variant="secondary" size="sm">
              <GanttChart className="h-3.5 w-3.5" aria-hidden="true" />
              Timeline
            </LinkButton>
          </>
        }
      />

      {!currentCase && !loading ? (
        <EmptyState icon={<Layers />} title="No case selected" description="Select a case to reconstruct its sessions." />
      ) : error ? (
        <ErrorState title="Failed to load sessions" message={error} onRetry={loadSessions} />
      ) : (
        <Card className="overflow-hidden">
          <FilterBar>
            <SegmentedControl<StatusFilter>
              label="Filter by session status"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setCurrentPage(1);
              }}
              options={STATUSES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase() }))}
            />
            <Button
              variant={showFilters || advancedCount > 0 ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowFilters((p) => !p)}
              aria-expanded={showFilters}
              aria-controls="sessions-filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Identity filters
              {advancedCount > 0 && (
                <span className="rounded-sm bg-accent-subtle px-1 font-mono text-2xs text-accent-text">{advancedCount}</span>
              )}
            </Button>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                Clear all
              </Button>
            )}
            <span className="ml-auto text-xs text-text-muted" aria-live="polite">
              <span className="font-mono text-text-primary">{total}</span> sessions
            </span>
          </FilterBar>

          {showFilters && (
            <div id="sessions-filters" className="grid grid-cols-1 gap-3 border-b border-border-subtle bg-surface-subtle px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="User account" htmlFor="ss-user">
                <Input id="ss-user" placeholder="e.g. admin" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
              <Field label="Source IP" htmlFor="ss-ip">
                <Input id="ss-ip" placeholder="e.g. 192.168.1.10" value={ipFilter} onChange={(e) => { setIpFilter(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="space-y-3 p-4">
              <CardSkeleton lines={3} />
              <CardSkeleton lines={3} />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              bare
              icon={<Layers />}
              title={activeFiltersCount > 0 ? "No sessions match these filters" : "No sessions reconstructed"}
              description={
                activeFiltersCount > 0
                  ? "Adjust or clear the filters."
                  : `No sessions could be correlated from ${currentCase?.caseId ?? "this case"}. Process evidence to generate events first.`
              }
              actionLabel={activeFiltersCount > 0 ? "Clear filters" : undefined}
              onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
            />
          ) : (
            <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
              <ul className="divide-y divide-border-subtle" aria-label="Reconstructed sessions">
                {items.map((session: ForensicSession) => {
                  const isExpanded = expandedSessionIds.has(session.sessionId);
                  const listId = `session-events-${session.sessionId}`;
                  const timelineParams = new URLSearchParams();
                  if (session.user) timelineParams.set("user", session.user);
                  if (session.srcIp) timelineParams.set("src_ip", session.srcIp);

                  return (
                    <li key={session.sessionId}>
                      <article aria-labelledby={`session-title-${session.sessionId}`} className="px-4 py-3">
                        {/* Header row */}
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 id={`session-title-${session.sessionId}`} className="sr-only">
                              Session {session.sessionId}
                            </h2>
                            <IdValue value={session.sessionId} label="session ID" />
                            <SessionStatusBadge status={session.status} />
                            <span className="font-mono text-xs text-text-muted">
                              {session.eventCount} {session.eventCount === 1 ? "event" : "events"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-text-muted">
                            <span>
                              {formatDateTime(session.startTime).replace(" UTC", "")} → {formatDateTime(session.endTime).replace(" UTC", "")} UTC
                            </span>
                            <span className="rounded-sm border border-border px-1.5 py-px text-text-secondary">
                              {formatDuration(session.durationSeconds)}
                            </span>
                          </div>
                        </div>

                        {/* Identity */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                            <span className="text-text-muted">User</span>
                            <span className="font-mono text-text-primary">{session.user || "Unattributed"}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                            <span className="text-text-muted">Source</span>
                            <span className="font-mono text-text-primary">{session.srcIp || "None recorded"}</span>
                          </span>
                          {session.host && (
                            <span className="inline-flex items-center gap-1.5">
                              <Server className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                              <span className="text-text-muted">Host</span>
                              <span className="font-mono text-text-primary">{session.host}</span>
                            </span>
                          )}
                        </div>

                        {/* Event sequence */}
                        <ol className="mt-2.5 flex flex-wrap items-center gap-1" aria-label={`Event sequence for ${session.sessionId}`}>
                          {session.events.map((ev: SessionEvent, i: number) => (
                            <React.Fragment key={ev.eventId}>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEventId(ev.eventId)}
                                  className="rounded-sm border border-border bg-surface-subtle px-1.5 py-0.5 font-mono text-2xs text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  title={`${ev.summary} (${formatDateTime(ev.timestamp || ev.timestampOriginal)})`}
                                  aria-label={`Inspect event ${i + 1}: ${ev.eventType}`}
                                >
                                  {ev.eventType}
                                </button>
                              </li>
                              {i < session.events.length - 1 && (
                                <ArrowRight className="h-3 w-3 shrink-0 text-text-disabled" aria-hidden="true" />
                              )}
                            </React.Fragment>
                          ))}
                        </ol>

                        {/* Correlation basis */}
                        <div className="mt-2.5 flex items-start gap-1.5 text-2xs text-text-muted">
                          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>
                            <span className="font-medium text-text-secondary">Correlated by: </span>
                            <span className="font-mono">{session.correlationBasis.join(" · ") || "—"}</span>
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(session.sessionId)}
                            aria-expanded={isExpanded}
                            aria-controls={listId}
                            className="inline-flex items-center gap-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                            Event records ({session.events.length})
                          </button>
                          <Link
                            to={`/timeline${timelineParams.toString() ? `?${timelineParams.toString()}` : ""}`}
                            className="inline-flex items-center gap-1 rounded text-xs text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            Open in timeline
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </div>

                        {isExpanded && (
                          <ul id={listId} className="mt-2 divide-y divide-border-subtle overflow-hidden rounded border border-border">
                            {session.events.map((ev: SessionEvent) => (
                              <li key={ev.eventId}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEventId(ev.eventId)}
                                  className="grid w-full grid-cols-1 gap-1 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:grid-cols-[150px_140px_90px_1fr]"
                                >
                                  <span className="font-mono text-2xs text-text-muted">
                                    {formatDateTime(ev.timestamp || ev.timestampOriginal).replace(" UTC", "")}
                                  </span>
                                  <span className="font-mono font-medium text-text-primary">{ev.eventType}</span>
                                  <span>
                                    <SeverityBadge severity={ev.severity} />
                                  </span>
                                  <span className="min-w-0 truncate font-mono text-text-secondary" title={ev.summary}>
                                    {ev.summary}
                                    {ev.evidenceOriginalName && (
                                      <span className="text-text-muted">
                                        {" "}
                                        · {ev.evidenceOriginalName}
                                        {ev.lineNumber != null ? `:${ev.lineNumber}` : ""}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                noun="sessions"
                onPageChange={setCurrentPage}
                disabled={loading}
              />
            </div>
          )}
        </Card>
      )}

      <EventInspectorModal eventId={selectedEventId} caseId={currentCase?.caseId} onClose={() => setSelectedEventId(null)} />
    </>
  );
}
