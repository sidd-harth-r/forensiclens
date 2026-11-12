import { describeError } from "@/lib/formatters";
import { useState, useEffect, useCallback, useMemo } from "react";
import { ListTree, SlidersHorizontal, RefreshCw } from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { PageHeader, CaseScope, FilterBar } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Field, SearchField } from "@/components/ui/Input";
import { SeverityBadge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Pagination, Timestamp } from "@/components/ui/DataDisplay";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getEvents } from "@/services/events";
import { PaginatedEvents } from "@/types/event";
import { cn } from "@/lib/utils";

const EVENT_TYPES = ["ALL", "AUTH_FAILURE", "AUTH_SUCCESS", "INVALID_USER", "DISCONNECT"] as const;
const SEVERITIES = ["ALL", "INFO", "WARNING", "CRITICAL"] as const;
type Severity = (typeof SEVERITIES)[number];

const PAGE_SIZE = 50;

export function EventsPage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedEvents>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<Severity>("ALL");
  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadEvents = useCallback(async () => {
    if (!currentCase?.caseId) {
      setPaginatedData({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await getEvents(currentCase.caseId, {
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: searchTerm || undefined,
        eventType: typeFilter !== "ALL" ? typeFilter : undefined,
        severity: severityFilter !== "ALL" ? severityFilter : undefined,
        user: userFilter.trim() || undefined,
        srcIp: ipFilter.trim() || undefined,
        from: fromTime.trim() || undefined,
        to: toTime.trim() || undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(describeError(err, "Failed to load events"));
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId, currentPage, searchTerm, typeFilter, severityFilter, userFilter, ipFilter, fromTime, toTime]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleResetFilters = () => {
    setSearchInput("");
    setSearchTerm("");
    setTypeFilter("ALL");
    setSeverityFilter("ALL");
    setUserFilter("");
    setIpFilter("");
    setFromTime("");
    setToTime("");
    setCurrentPage(1);
  };

  const advancedCount = [userFilter, ipFilter, fromTime, toTime].filter((v) => v.trim()).length;

  const activeFiltersCount = useMemo(() => {
    let count = advancedCount;
    if (searchTerm) count++;
    if (typeFilter !== "ALL") count++;
    if (severityFilter !== "ALL") count++;
    return count;
  }, [advancedCount, searchTerm, typeFilter, severityFilter]);

  const { items, total, page, pageSize, totalPages } = paginatedData;
  const initialLoad = loading && items.length === 0;

  return (
    <>
      <PageHeader
        title="Event Explorer"
        eyebrow={<CaseScope caseId={currentCase?.caseId} name={currentCase?.name} />}
        description="Normalized events parsed from evidence. Every row traces back to its raw record and byte range."
        actions={
          <Button variant="outline" size="sm" onClick={loadEvents} disabled={loading} aria-label="Refresh events">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {!currentCase && !loading ? (
        <EmptyState icon={<ListTree />} title="No case selected" description="Select a case to explore its parsed events." />
      ) : error ? (
        <ErrorState title="Failed to load events" message={error} onRetry={loadEvents} />
      ) : (
        <Card className="overflow-hidden">
          <FilterBar>
            <SearchField
              label="Search events"
              placeholder="Search IP, user, type or message"
              value={searchInput}
              onValueChange={setSearchInput}
              className="sm:w-72"
            />
            <Select
              aria-label="Event type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              wrapperClassName="w-auto"
              className="w-44 font-mono text-xs"
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
              aria-controls="events-advanced-filters"
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
            <span className="ml-auto font-mono text-xs text-text-muted" aria-live="polite">
              {total.toLocaleString()} events
            </span>
          </FilterBar>

          {showAdvancedFilters && (
            <div
              id="events-advanced-filters"
              className="grid grid-cols-1 gap-3 border-b border-border-subtle bg-surface-subtle px-3 py-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Field label="User" htmlFor="ev-user">
                <Input
                  id="ev-user"
                  placeholder="e.g. root"
                  value={userFilter}
                  onChange={(e) => {
                    setUserFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Source IP" htmlFor="ev-ip">
                <Input
                  id="ev-ip"
                  placeholder="e.g. 192.168.1.100"
                  value={ipFilter}
                  onChange={(e) => {
                    setIpFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="From (UTC, ISO 8601)" htmlFor="ev-from">
                <Input
                  id="ev-from"
                  placeholder="2026-01-15T10:00:00"
                  value={fromTime}
                  onChange={(e) => {
                    setFromTime(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="To (UTC, ISO 8601)" htmlFor="ev-to">
                <Input
                  id="ev-to"
                  placeholder="2026-01-15T11:00:00"
                  value={toTime}
                  onChange={(e) => {
                    setToTime(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          )}

          {initialLoad ? (
            <TableSkeleton rows={10} columns={7} label="Loading events" />
          ) : items.length === 0 ? (
            <EmptyState
              bare
              icon={<ListTree />}
              title={activeFiltersCount > 0 ? "No events match these filters" : "No events in this case"}
              description={
                activeFiltersCount > 0
                  ? "Adjust or clear the filters to widen the search."
                  : "Process ingested evidence to populate normalized events."
              }
              actionLabel={activeFiltersCount > 0 ? "Clear filters" : undefined}
              onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
            />
          ) : (
            <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]" title="UTC when normalized; dotted values are source timestamps as recorded">Timestamp</TableHead>
                    <TableHead className="w-[140px]">Event type</TableHead>
                    <TableHead className="w-[100px]">Severity</TableHead>
                    <TableHead className="w-[110px]">User</TableHead>
                    <TableHead className="w-[150px]">Source</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-[170px]">Evidence · line</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((ev) => (
                    <TableRow
                      key={ev.eventId}
                      selected={selectedEventId === ev.eventId}
                      onActivate={() => setSelectedEventId(ev.eventId)}
                      aria-label={`Inspect ${ev.eventType} event ${ev.eventId}`}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-2xs text-text-secondary">
                        <Timestamp utc={ev.timestampUtc} original={ev.timestampOriginal} />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{ev.eventType}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={ev.severity} />
                      </TableCell>
                      <TableCell className="max-w-[110px] truncate font-mono text-xs">
                        {ev.userValue || <span className="text-text-disabled">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {ev.srcIp ? (
                          <>
                            {ev.srcIp}
                            {ev.srcPort ? <span className="text-text-muted">:{ev.srcPort}</span> : null}
                          </>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                        {ev.host && <div className="truncate text-2xs text-text-muted">{ev.host}</div>}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <span className="block truncate font-mono text-xs text-text-secondary" title={ev.message}>
                          {ev.message}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[170px]">
                        <span className="block truncate font-mono text-2xs text-text-muted" title={ev.sourceFileName || ev.evidenceId}>
                          {ev.sourceFileName || ev.evidenceId}
                          {ev.lineNumber != null && <span className="text-text-disabled"> · L{ev.lineNumber}</span>}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
