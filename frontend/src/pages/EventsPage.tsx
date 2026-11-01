import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
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
import { getEvents, getEventById } from "@/services/events";
import { EventSeverity, ForensicEvent, PaginatedEvents } from "@/types/event";
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
  X,
  Copy,
  HardDrive,
  SlidersHorizontal,
  FileText,
  ArrowRight,
  ShieldCheck,
  Hash,
} from "lucide-react";
import { toast } from "sonner";

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
  const [selectedEventDetail, setSelectedEventDetail] = useState<ForensicEvent | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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

  // Fetch full detail when an event is selected
  useEffect(() => {
    if (!selectedEventId || !currentCase?.caseId) {
      setSelectedEventDetail(null);
      setLoadingDetail(false);
      setDetailError(null);
      return;
    }

    let isCurrent = true;
    setLoadingDetail(true);
    setDetailError(null);

    getEventById(currentCase.caseId, selectedEventId)
      .then((detail) => {
        if (isCurrent) {
          setSelectedEventDetail(detail);
        }
      })
      .catch((err) => {
        if (isCurrent) {
          setDetailError(err instanceof Error ? err.message : "Failed to load event details");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingDetail(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedEventId, currentCase?.caseId]);

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

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
      {selectedEventId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-subtle shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">
                  Forensic Event Inspector
                </h3>
                <span className="font-mono text-xs text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
                  {selectedEventId}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedEventId, "Event ID")}
                  className="text-text-muted hover:text-text-primary p-0.5"
                  title="Copy Event ID"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="overflow-y-auto p-5 space-y-5">
              {loadingDetail && (
                <LoadingState message="Retrieving event details and raw record provenance..." />
              )}

              {detailError && (
                <ErrorState
                  title="Failed to Load Event Details"
                  message={detailError}
                  onRetry={() => {
                    if (selectedEventId && currentCase?.caseId) {
                      setLoadingDetail(true);
                      setDetailError(null);
                      getEventById(currentCase.caseId, selectedEventId)
                        .then(setSelectedEventDetail)
                        .catch((err) => setDetailError(err.message))
                        .finally(() => setLoadingDetail(false));
                    }
                  }}
                />
              )}

              {!loadingDetail && !detailError && selectedEventDetail && (
                <>
                  {/* 1. Event Details Section */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5 text-accent" />
                      Event Details
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
                      <div>
                        <span className="text-text-muted block text-[11px]">Event Type</span>
                        <span className="font-mono font-semibold text-text-primary">
                          {selectedEventDetail.eventType}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Severity</span>
                        <div className="mt-0.5">
                          <Badge
                            variant={getSeverityBadgeVariant(
                              selectedEventDetail.severity as EventSeverity
                            )}
                          >
                            {selectedEventDetail.severity}
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">User Account</span>
                        <span className="font-mono font-medium text-text-primary">
                          {selectedEventDetail.userValue || "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Source IP & Port</span>
                        <span className="font-mono text-text-primary">
                          {selectedEventDetail.srcIp
                            ? `${selectedEventDetail.srcIp}${
                                selectedEventDetail.srcPort ? `:${selectedEventDetail.srcPort}` : ""
                              }`
                            : "—"}
                        </span>
                        {selectedEventDetail.srcIpScope && (
                          <span className="ml-1 text-[10px] px-1 py-0.2 rounded bg-surface border border-border text-text-muted">
                            {selectedEventDetail.srcIpScope}
                          </span>
                        )}
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Host</span>
                        <span className="font-mono text-text-primary">
                          {selectedEventDetail.host || "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Process & PID</span>
                        <span className="font-mono text-text-primary">
                          {selectedEventDetail.process
                            ? `${selectedEventDetail.process}${
                                selectedEventDetail.pid ? ` [${selectedEventDetail.pid}]` : ""
                              }`
                            : "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Timestamp (UTC)</span>
                        <span className="font-mono text-text-primary">
                          {formatDateTime(selectedEventDetail.timestampUtc) || "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Original Timestamp</span>
                        <span className="font-mono text-text-secondary">
                          {selectedEventDetail.timestampOriginal || "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Confidence / Timezone</span>
                        <span className="font-mono text-text-secondary">
                          {selectedEventDetail.timestampConfidence || "EXACT"}{" "}
                          {selectedEventDetail.tzAssumed ? `(${selectedEventDetail.tzAssumed})` : ""}
                        </span>
                      </div>
                    </div>

                    {/* Normalized Message */}
                    <div className="p-3 rounded-lg border border-border bg-surface-subtle">
                      <span className="text-[11px] font-medium text-text-muted block mb-1">
                        Normalized Message Payload
                      </span>
                      <p className="font-mono text-xs text-text-primary break-all select-all">
                        {selectedEventDetail.message}
                      </p>
                    </div>
                  </div>

                  {/* 2. Provenance Trace Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
                        Provenance Trace
                      </h4>

                      <Link to="/evidence">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-6 text-accent hover:text-accent-hover gap-1"
                        >
                          <HardDrive className="w-3 h-3" />
                          <span>View Evidence Explorer</span>
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>

                    {/* Provenance Flow Pill */}
                    <div className="flex items-center gap-2 p-2 rounded bg-surface-subtle border border-border font-mono text-[11px] text-text-secondary flex-wrap">
                      <span className="font-semibold text-text-primary">
                        {selectedEventDetail.evidenceOriginalName ||
                          selectedEventDetail.sourceFileName ||
                          "auth.log"}
                      </span>
                      <ArrowRight className="w-3 h-3 text-text-muted" />
                      <span className="text-accent">
                        {selectedEventDetail.rawRecordId || "RAW_RECORD"}
                      </span>
                      <ArrowRight className="w-3 h-3 text-text-muted" />
                      <span className="text-status-success font-semibold">
                        {selectedEventDetail.eventId}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border border-border bg-surface-subtle text-xs">
                      <div>
                        <span className="text-text-muted block text-[11px]">Evidence File</span>
                        <span className="font-mono text-text-primary font-medium">
                          {selectedEventDetail.evidenceOriginalName ||
                            selectedEventDetail.sourceFileName ||
                            "auth.log"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Evidence ID</span>
                        <div className="flex items-center gap-1 font-mono text-text-primary">
                          <span className="truncate">{selectedEventDetail.evidenceId}</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(selectedEventDetail.evidenceId, "Evidence ID")
                            }
                            className="text-text-muted hover:text-text-primary p-0.5"
                            title="Copy Evidence ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Parser Engine</span>
                        <Badge variant="default" className="font-mono text-[11px]">
                          {selectedEventDetail.evidenceFormat ||
                            selectedEventDetail.source ||
                            "OPENSSH"}
                        </Badge>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Raw Record ID</span>
                        <span className="font-mono text-text-secondary">
                          {selectedEventDetail.rawRecordId || "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Line Number</span>
                        <span className="font-mono font-medium text-text-primary">
                          {selectedEventDetail.lineNumber != null
                            ? `Line ${selectedEventDetail.lineNumber}`
                            : "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-text-muted block text-[11px]">Byte Range Offsets</span>
                        <span className="font-mono text-text-primary">
                          {selectedEventDetail.byteStart != null &&
                          selectedEventDetail.byteEnd != null
                            ? `${selectedEventDetail.byteStart} – ${selectedEventDetail.byteEnd} (${
                                selectedEventDetail.byteEnd - selectedEventDetail.byteStart
                              } B)`
                            : "—"}
                        </span>
                      </div>

                      <div className="col-span-2 sm:col-span-3">
                        <span className="text-text-muted block text-[11px]">
                          Canonical Event Hash (SHA-256)
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-primary mt-0.5">
                          <span className="break-all">{selectedEventDetail.eventHash}</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(selectedEventDetail.eventHash, "Event Hash")
                            }
                            className="text-text-muted hover:text-text-primary p-0.5 shrink-0"
                            title="Copy SHA-256 Event Hash"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. Raw Evidence Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-accent" />
                        Raw Source Evidence Line
                      </h4>

                      <div className="flex items-center gap-2">
                        {selectedEventDetail.lineNumber != null && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted">
                            Line {selectedEventDetail.lineNumber}
                          </span>
                        )}
                        {selectedEventDetail.rawText && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-6 gap-1"
                            onClick={() =>
                              copyToClipboard(selectedEventDetail.rawText!, "Raw Evidence Line")
                            }
                          >
                            <Copy className="w-3 h-3" />
                            <span>Copy Raw Line</span>
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border border-border bg-neutral-950 text-neutral-100 font-mono text-xs overflow-x-auto select-all">
                      <pre className="whitespace-pre break-all">
                        {selectedEventDetail.rawText ||
                          `// Raw record text unavailable for ${selectedEventDetail.eventId}`}
                      </pre>
                    </div>

                    <p className="text-[11px] text-text-muted italic">
                      Immutable forensic source data captured during ingestion. Rendered strictly as
                      passive text without evaluation.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-border bg-surface-subtle flex items-center justify-end gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedEventId(null)}
              >
                Close Inspector
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}