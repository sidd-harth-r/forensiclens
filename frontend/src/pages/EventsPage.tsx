import { useState, useEffect, useCallback, useMemo } from "react";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { EventInspectorModal } from "@/components/events/EventInspectorModal";
import { getEvents } from "@/services/events";
import { EventSeverity, PaginatedEvents } from "@/types/event";
import { formatDateTime } from "@/lib/formatters";
import {
  ListOrdered,
  Search,
  User,
  Globe,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

export function EventsPage() {
  const { currentCase } = useCase();
  const [paginatedData, setPaginatedData] = useState<PaginatedEvents>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Inspector / Detail Modal State
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load events list from API or fixtures
  const loadEvents = useCallback(async () => {
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
      const res = await getEvents(currentCase.caseId, {
        page: currentPage,
        pageSize: 50,
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
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [
    currentCase?.caseId,
    currentPage,
    searchTerm,
    typeFilter,
    severityFilter,
    userFilter,
    ipFilter,
    fromTime,
    toTime,
  ]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Reset all filters
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

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm) count++;
    if (typeFilter !== "ALL") count++;
    if (severityFilter !== "ALL") count++;
    if (userFilter.trim()) count++;
    if (ipFilter.trim()) count++;
    if (fromTime.trim()) count++;
    if (toTime.trim()) count++;
    return count;
  }, [searchTerm, typeFilter, severityFilter, userFilter, ipFilter, fromTime, toTime]);

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
    return <LoadingState message="Loading normalized forensic events..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Events Explorer"
          description="Normalized forensic events synchronized from raw records."
        />
        <ErrorState
          title="Failed to Load Events"
          message={error}
          onRetry={loadEvents}
        />
      </div>
    );
  }

  const { items, total, page, pageSize, totalPages } = paginatedData;
  const startCount = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endCount = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Events Explorer"
        description="Normalized forensic events synchronized from raw records. Indexed in SQLite FTS5 for sub-millisecond lexical queries with exact byte-offset provenance."
      />

      {/* Filter and Search Controls */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="w-full lg:w-96">
              <Input
                placeholder="Search events by IP, username, type, or message..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                icon={<Search className="w-3.5 h-3.5 text-text-muted" />}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">Type:</span>
                {(["ALL", "AUTH_FAILURE", "AUTH_SUCCESS", "INVALID_USER", "DISCONNECT"] as const).map(
                  (tp) => (
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
                  )
                )}
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

              <div className="h-4 w-[1px] bg-border hidden sm:block" />

              <Button
                variant="outline"
                size="sm"
                className={`text-xs h-7 gap-1.5 ${showAdvancedFilters ? "bg-accent-subtle text-accent border-accent/40" : ""}`}
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

          {/* Advanced Filter Expansion Panel */}
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
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  From Timestamp (UTC or ISO)
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
                  To Timestamp (UTC or ISO)
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

      {/* Events Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<ListOrdered className="w-8 h-8 text-text-disabled" />}
                title="No forensic events matched"
                description={
                  activeFiltersCount > 0
                    ? `No events found matching current search and filter criteria.`
                    : `No events recorded in case ${currentCase?.caseId || ""}. Process ingested evidence artifacts to populate events.`
                }
                actionLabel={activeFiltersCount > 0 ? "Reset Filters" : undefined}
                onAction={activeFiltersCount > 0 ? handleResetFilters : undefined}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">Timestamp</TableHead>
                    <TableHead className="w-32">Event Type</TableHead>
                    <TableHead className="w-20">Severity</TableHead>
                    <TableHead className="w-24">User</TableHead>
                    <TableHead className="w-32">Source IP</TableHead>
                    <TableHead className="w-24">Host</TableHead>
                    <TableHead>Message Payload</TableHead>
                    <TableHead className="w-28">Evidence</TableHead>
                    <TableHead className="w-16 text-right">Inspect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((ev) => (
                    <TableRow
                      key={ev.eventId}
                      onClick={() => setSelectedEventId(ev.eventId)}
                      className="cursor-pointer hover:bg-surface-subtle transition-colors group"
                    >
                      <TableCell className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-text-disabled shrink-0" />
                          <span title={`Original: ${ev.timestampOriginal || "N/A"}`}>
                            {formatDateTime(ev.timestampUtc || ev.timestampOriginal)}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="font-mono text-xs font-semibold text-text-primary">
                          {ev.eventType}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Badge variant={getSeverityBadgeVariant(ev.severity as EventSeverity)}>
                          {ev.severity}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-xs">
                        {ev.userValue ? (
                          <div className="flex items-center gap-1 font-mono text-text-primary">
                            <User className="w-3 h-3 text-text-muted shrink-0" />
                            <span className="truncate max-w-[80px]">{ev.userValue}</span>
                          </div>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-xs">
                        {ev.srcIp ? (
                          <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-text-muted shrink-0" />
                            <span>{ev.srcIp}</span>
                            {ev.srcPort && (
                              <span className="text-text-muted text-[10px]">:{ev.srcPort}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-secondary truncate max-w-[90px]">
                        {ev.host || "—"}
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-primary max-w-sm truncate">
                        <span title={ev.message}>{ev.message}</span>
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-muted truncate max-w-[110px]">
                        <span title={`Evidence: ${ev.sourceFileName || ev.evidenceId}`}>
                          {ev.sourceFileName || ev.evidenceId}
                        </span>
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-text-muted group-hover:text-accent group-hover:bg-accent-subtle"
                          title="Inspect Event Provenance"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(ev.eventId);
                          }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface-subtle text-xs text-text-secondary">
                <div className="font-mono">
                  Showing <span className="font-semibold text-text-primary">{startCount}</span> to{" "}
                  <span className="font-semibold text-text-primary">{endCount}</span> of{" "}
                  <span className="font-semibold text-text-primary">{total}</span> events
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

      {/* Forensic Event Inspector Modal */}
      <EventInspectorModal
        eventId={selectedEventId}
        caseId={currentCase?.caseId}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}