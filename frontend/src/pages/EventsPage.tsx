import { useState, useMemo, useEffect } from "react";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
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
import { getEvents } from "@/services/events";
import { ForensicEvent, EventSeverity } from "@/types/event";
import { formatDateTime } from "@/lib/formatters";
import {
  ListOrdered,
  Search,
  User,
  Globe,
  Clock,
} from "lucide-react";

export function EventsPage() {
  const { currentCase } = useCase();
  const [events, setEvents] = useState<ForensicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getEvents(currentCase?.caseId).then((res) => {
      if (mounted) {
        setEvents(res);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentCase?.caseId]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        ev.eventId.toLowerCase().includes(term) ||
        ev.message.toLowerCase().includes(term) ||
        (ev.userValue && ev.userValue.toLowerCase().includes(term)) ||
        (ev.srcIp && ev.srcIp.includes(term)) ||
        ev.eventType.toLowerCase().includes(term);

      const matchesType = typeFilter === "ALL" || ev.eventType === typeFilter;
      const matchesSeverity = severityFilter === "ALL" || ev.severity === severityFilter;

      return matchesSearch && matchesType && matchesSeverity;
    });
  }, [events, searchTerm, typeFilter, severityFilter]);

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

  if (loading) {
    return <LoadingState message="Loading normalized forensic events..." />;
  }

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
                onChange={(e) => setSearchTerm(e.target.value)}
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
                      onClick={() => setTypeFilter(tp)}
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
                    onClick={() => setSeverityFilter(sev)}
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
          {filteredEvents.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<ListOrdered className="w-8 h-8 text-text-disabled" />}
                title="No forensic events matched"
                description={
                  searchTerm
                    ? `No events found matching "${searchTerm}".`
                    : "No events recorded under this filter."
                }
                actionLabel="Reset Search"
                onAction={() => {
                  setSearchTerm("");
                  setTypeFilter("ALL");
                  setSeverityFilter("ALL");
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Timestamp (UTC)</TableHead>
                  <TableHead className="w-28">Event Type</TableHead>
                  <TableHead className="w-20">Severity</TableHead>
                  <TableHead className="w-28">User</TableHead>
                  <TableHead className="w-36">Source IP</TableHead>
                  <TableHead className="w-20">Process</TableHead>
                  <TableHead>Message Payload</TableHead>
                  <TableHead className="w-24">Offsets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((ev) => (
                  <TableRow key={ev.eventId}>
                    <TableCell className="font-mono text-[11px] text-text-muted whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-text-disabled" />
                        <span>{formatDateTime(ev.timestampUtc || ev.timestampOriginal)}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-xs font-semibold text-text-primary">
                        {ev.eventType}
                      </span>
                    </TableCell>

                    <TableCell>
                      <Badge variant={getSeverityBadgeVariant(ev.severity)}>
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

                    <TableCell className="font-mono text-[10px] text-text-muted">
                      L{ev.lineNumber}: {ev.byteStart}–{ev.byteEnd}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
