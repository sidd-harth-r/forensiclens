import { useState, useEffect, useCallback } from "react";
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

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState<number>(1);

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
        search: searchTerm.trim() || undefined,
        eventType: typeFilter !== "ALL" ? typeFilter : undefined,
        severity: severityFilter !== "ALL" ? severityFilter : undefined,
      });
      setPaginatedData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [currentCase?.caseId, currentPage, searchTerm, typeFilter, severityFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Reset to page 1 on filter or search changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleTypeChange = (tp: string) => {
    setTypeFilter(tp);
    setCurrentPage(1);
  };

  const handleSeverityChange = (sev: string) => {
    setSeverityFilter(sev);
    setCurrentPage(1);
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
        <CardContent className="p-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="w-full lg:w-96">
              <Input
                placeholder="Search events by IP, username, event type, or message..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
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
                      onClick={() => handleTypeChange(tp)}
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
                    onClick={() => handleSeverityChange(sev)}
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
          </div>
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
                  searchTerm
                    ? `No events found matching "${searchTerm}".`
                    : `No events recorded in case ${currentCase?.caseId || ""} under this filter.`
                }
                actionLabel="Reset Filters"
                onAction={() => {
                  setSearchTerm("");
                  setTypeFilter("ALL");
                  setSeverityFilter("ALL");
                  setCurrentPage(1);
                }}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Timestamp (UTC)</TableHead>
                    <TableHead className="w-32">Event Type</TableHead>
                    <TableHead className="w-20">Severity</TableHead>
                    <TableHead className="w-28">User</TableHead>
                    <TableHead className="w-36">Source IP</TableHead>
                    <TableHead className="w-24">Process</TableHead>
                    <TableHead>Message Payload</TableHead>
                    <TableHead className="w-28">Offsets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((ev) => (
                    <TableRow key={ev.eventId}>
                      <TableCell className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-text-disabled" />
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
                            <User className="w-3 h-3 text-text-muted" />
                            <span>{ev.userValue}</span>
                          </div>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-xs">
                        {ev.srcIp ? (
                          <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-text-muted" />
                            <span>{ev.srcIp}</span>
                            {ev.srcPort && (
                              <span className="text-text-muted text-[10px]">:{ev.srcPort}</span>
                            )}
                            {ev.srcIpScope && (
                              <span className="text-[9px] px-1 rounded bg-surface-muted text-text-muted">
                                {ev.srcIpScope}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-secondary">
                        {ev.process ? `${ev.process}${ev.pid ? `[${ev.pid}]` : ""}` : "—"}
                      </TableCell>

                      <TableCell className="font-mono text-[11px] text-text-primary max-w-md truncate">
                        <span title={ev.message}>{ev.message}</span>
                      </TableCell>

                      <TableCell className="font-mono text-[10px] text-text-muted whitespace-nowrap">
                        {ev.lineNumber !== undefined ? `L${ev.lineNumber}: ` : ""}
                        {ev.byteStart !== undefined && ev.byteEnd !== undefined
                          ? `${ev.byteStart}–${ev.byteEnd}`
                          : "—"}
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
    </div>
  );
}
