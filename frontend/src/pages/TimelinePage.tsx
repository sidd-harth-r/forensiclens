import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  GanttChart,
  ShieldAlert,
  LogIn,
  LogOut,
  Activity,
  SlidersHorizontal,
  Layers,
  RefreshCw,
  FileText,
  User,
  Globe,
  Server,
} from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope, FilterBar } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select, Field } from "@/components/ui/Input";
import { SeverityBadge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Pagination, Timestamp } from "@/components/ui/DataDisplay";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getTimeline } from "@/services/timeline";
import { PaginatedTimeline, TimelineItem } from "@/types/timeline";
import { cn } from "@/lib/utils";
import { formatDateTime, isIsoTimestamp, describeError } from "@/lib/formatters";

const EVENT_TYPES = ["ALL", "AUTH_FAILURE", "AUTH_SUCCESS", "SESSION_OPENED", "SESSION_CLOSED", "DISCONNECT"] as const;
const SEVERITIES = ["ALL", "INFO", "WARNING", "CRITICAL"] as const;
type Severity = (typeof SEVERITIES)[number];
const PAGE_SIZE = 50;

type Category = "access" | "failure" | "end" | "other";

function categorize(eventType: string): Category {
  switch (eventType) {
    case "AUTH_SUCCESS":
    case "SESSION_OPENED":
      return "access";
    case "AUTH_FAILURE":
    case "INVALID_USER":
      return "failure";
    case "DISCONNECT":
    case "SESSION_CLOSED":
      return "end";
    default:
      return "other";
  }
}

const CATEGORY_META: Record<Category, { label: string; icon: typeof LogIn; tone: string }> = {
  access: { label: "Access granted", icon: LogIn, tone: "text-status-success border-status-success/40" },
  failure: { label: "Access failure", icon: ShieldAlert, tone: "text-status-danger border-status-danger/40" },
  end: { label: "Session end", icon: LogOut, tone: "text-status-warning border-status-warning/40" },
  other: { label: "Activity", icon: Activity, tone: "text-text-muted border-border-strong" },
};

function splitTimestamp(ts?: string | null): { day: string; time: string; valid: boolean } {
  if (!ts) return { day: "No timestamp", time: "--:--:--", valid: false };
  // Only ISO-8601 values are normalized; partial source timestamps (e.g. syslog
  // without a year) are shown verbatim rather than guessed.
  if (!isIsoTimestamp(ts)) return { day: "Timestamp not normalized to UTC", time: ts, valid: false };
  const iso = formatDateTime(ts); // "YYYY-MM-DD HH:MM:SS.mmm UTC"
  return { day: iso.slice(0, 10), time: iso.slice(11, 19), valid: true };
}

export function TimelinePage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedTimeline>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<Severity>("ALL");
  // Deep links from Sessions pass ?user=…&src_ip=… to pre-filter the timeline
  const [searchParams] = useSearchParams();
  const [userFilter, setUserFilter] = useState(() => searchParams.get("user") ?? "");
  const [ipFilter, setIpFilter] = useState(() => searchParams.get("src_ip") ?? "");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(
    () => !!(searchParams.get("user") || searchParams.get("src_ip"))
  );
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const loadTimeline = useCallback(async () => {
    if (!currentCase?.caseId) {
      setPaginatedData({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await getTimeline(currentCase.caseId, {
        page: currentPage,
        pageSize: PAGE_SIZE,
        eventType: typeFilter !== "ALL" ? typeFilter : undefined,
        severity: severityFilter !== "ALL" ? severityFilter : undefined,
        user: userFilter.trim() || undefined,
        srcIp: ipFilter.trim() || undefined,
        from: fromTime.trim() || undefined,
        to: toTime.trim() || undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(describeError(err, "Failed to load forensic timeline"));
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId, currentPage, typeFilter, severityFilter, userFilter, ipFilter, fromTime, toTime]);

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

  const advancedCount = [userFilter, ipFilter, fromTime, toTime].filter((v) => v.trim()).length;
  const activeFiltersCount = advancedCount + (typeFilter !== "ALL" ? 1 : 0) + (severityFilter !== "ALL" ? 1 : 0);

  const { items, total, page, pageSize, totalPages } = paginatedData;

  // Group consecutive items by UTC day, preserving backend order.
  const groups = useMemo(() => {
    const out: { day: string; entries: { item: TimelineItem; time: string }[] }[] = [];
    for (const item of items) {
      const { day, time } = splitTimestamp(item.timestamp || item.timestampOriginal);
      const last = out[out.length - 1];
      if (last && last.day === day) last.entries.push({ item, time });
      else out.push({ day, entries: [{ item, time }] });
    }
    return out;
  }, [items]);

  const range = useMemo(() => {
    const valid = items.map((i) => i.timestamp).filter(isIsoTimestamp);
    if (valid.length === 0) return null;
    return { first: formatDateTime(valid[0]).slice(0, 19), last: formatDateTime(valid[valid.length - 1]).slice(0, 19) };
  }, [items]);

  return (
    <>
      <PageHeader
        title="Timeline"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description="Chronological reconstruction of case events, ordered deterministically by timestamp and record sequence."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadTimeline} disabled={loading} aria-label="Refresh timeline">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
            <LinkButton to="/sessions" variant="secondary" size="sm">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              Correlated sessions
            </LinkButton>
          </>
        }
      />

      {!currentCase && !loading ? (
        <EmptyState icon={<GanttChart />} title="No case selected" description="Select a case to reconstruct its timeline." />
      ) : error ? (
        <ErrorState title="Failed to load timeline" message={error} onRetry={loadTimeline} />
      ) : (
        <Card className="overflow-hidden">
          <FilterBar>
            <Select
              aria-label="Event type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              wrapperClassName="w-auto"
              className="w-48 font-mono text-xs"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "ALL" ? "All event types" : t}
                </option>
              ))}
            </Select>
            <SegmentedControl<Severity>
              label="Filter by severity"
              value={severityFilter}
              onChange={(v) => {
                setSeverityFilter(v);
                setCurrentPage(1);
              }}
              options={SEVERITIES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase() }))}
            />
            <Button
              variant={showAdvancedFilters || advancedCount > 0 ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowAdvancedFilters((p) => !p)}
              aria-expanded={showAdvancedFilters}
              aria-controls="timeline-advanced-filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              More filters
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
              <span className="font-mono text-text-primary">{total.toLocaleString()}</span> events
              {range && (
                <span className="hidden md:inline">
                  {" "}
                  · page spans <span className="font-mono">{range.first}</span> →{" "}
                  <span className="font-mono">{range.last}</span> UTC
                </span>
              )}
            </span>
          </FilterBar>

          {showAdvancedFilters && (
            <div
              id="timeline-advanced-filters"
              className="grid grid-cols-1 gap-3 border-b border-border-subtle bg-surface-subtle px-3 py-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Field label="User" htmlFor="tl-user">
                <Input id="tl-user" placeholder="e.g. root" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
              <Field label="Source IP" htmlFor="tl-ip">
                <Input id="tl-ip" placeholder="e.g. 192.168.1.100" value={ipFilter} onChange={(e) => { setIpFilter(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
              <Field label="From (UTC, ISO 8601)" htmlFor="tl-from">
                <Input id="tl-from" placeholder="2026-01-15T10:00:00" value={fromTime} onChange={(e) => { setFromTime(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
              <Field label="To (UTC, ISO 8601)" htmlFor="tl-to">
                <Input id="tl-to" placeholder="2026-01-15T11:00:00" value={toTime} onChange={(e) => { setToTime(e.target.value); setCurrentPage(1); }} className="font-mono text-xs" />
              </Field>
            </div>
          )}

          {/* Category legend — text + icon, never color alone */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-1.5 text-2xs text-text-muted" aria-label="Legend">
            {(Object.keys(CATEGORY_META) as Category[]).map((k) => {
              const M = CATEGORY_META[k];
              const Icon = M.icon;
              return (
                <span key={k} className="inline-flex items-center gap-1">
                  <Icon className={cn("h-3 w-3", M.tone.split(" ")[0])} aria-hidden="true" />
                  {M.label}
                </span>
              );
            })}
          </div>

          {loading && items.length === 0 ? (
            <div className="space-y-3 p-4" role="status" aria-live="polite">
              <span className="sr-only">Reconstructing timeline</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-12 flex-1" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              bare
              icon={<GanttChart />}
              title={activeFiltersCount > 0 ? "No events match these filters" : "No events to sequence"}
              description={
                activeFiltersCount > 0
                  ? "Adjust or clear the filters."
                  : `No forensic events are recorded for ${currentCase?.caseId ?? "this case"}. Process evidence first.`
              }
              actionLabel={activeFiltersCount > 0 ? "Clear filters" : undefined}
              onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
            />
          ) : (
            <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
              {groups.map((g) => (
                <section key={g.day} aria-label={`Events on ${g.day}`}>
                  <h2 className="sticky top-0 z-[1] border-b border-border-subtle bg-surface-subtle/95 px-4 py-1.5 font-mono text-xs font-medium text-text-secondary backdrop-blur-sm">
                    {g.day}
                    <span className="ml-2 font-sans text-2xs text-text-muted">{g.entries.length} on this page</span>
                  </h2>
                  <ol className="relative">
                    {g.entries.map(({ item: ev, time }) => {
                      const cat = categorize(ev.eventType);
                      const M = CATEGORY_META[cat];
                      const Icon = M.icon;
                      return (
                        <li key={ev.eventId} className="relative grid grid-cols-[64px_28px_1fr] gap-x-2 sm:grid-cols-[84px_32px_1fr]">
                          <span className="break-words pt-3 text-right font-mono text-xs leading-tight text-text-secondary">
                            {isIsoTimestamp(ev.timestamp) ? (
                              <time dateTime={ev.timestamp} title={ev.timestampOriginal ? `Source: ${ev.timestampOriginal}` : undefined}>
                                {time}
                              </time>
                            ) : (
                              <Timestamp original={ev.timestamp || ev.timestampOriginal} />
                            )}
                          </span>
                          <div className="relative flex justify-center" aria-hidden="true">
                            <span className="absolute inset-y-0 w-px bg-border" />
                            <span className={cn("relative mt-2.5 flex h-6 w-6 items-center justify-center rounded-full border bg-surface", M.tone)}>
                              <Icon className="h-3 w-3" />
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedEventId(ev.eventId)}
                            className={cn(
                              "my-1 mr-3 min-w-0 rounded border border-transparent px-3 py-2 text-left transition-colors",
                              "hover:border-border hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              selectedEventId === ev.eventId && "border-border-strong bg-surface-subtle"
                            )}
                            aria-label={`${M.label}: ${ev.eventType} at ${time}. ${ev.summary}. Inspect provenance`}
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-text-primary">{ev.eventType}</span>
                              <SeverityBadge severity={ev.severity} />
                            </span>
                            <span className="mt-1 block break-words font-mono text-xs text-text-secondary">{ev.summary}</span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-text-muted">
                              {ev.user && (
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <User className="h-3 w-3" aria-hidden="true" />
                                  {ev.user}
                                </span>
                              )}
                              {ev.srcIp && (
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <Globe className="h-3 w-3" aria-hidden="true" />
                                  {ev.srcIp}
                                  {ev.srcPort ? `:${ev.srcPort}` : ""}
                                </span>
                              )}
                              {ev.host && (
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <Server className="h-3 w-3" aria-hidden="true" />
                                  {ev.host}
                                </span>
                              )}
                              {(ev.evidenceOriginalName || ev.evidenceId) && (
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <FileText className="h-3 w-3" aria-hidden="true" />
                                  {ev.evidenceOriginalName || ev.evidenceId}
                                  {ev.lineNumber != null && `:${ev.lineNumber}`}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                noun="events"
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
