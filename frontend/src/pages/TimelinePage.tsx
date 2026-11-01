import { useState, useEffect } from "react";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/common/LoadingState";
import { getEvents } from "@/services/events";
import { ForensicEvent } from "@/types/event";
import { formatDateTime } from "@/lib/formatters";
import {
  Clock,
  ShieldAlert,
  LogIn,
  LogOut,
  Activity,
} from "lucide-react";

export function TimelinePage() {
  const { currentCase } = useCase();
  const [events, setEvents] = useState<ForensicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getEvents(currentCase?.caseId).then((res) => {
      if (mounted) {
        // Sort chronologically
        const rawItems = Array.isArray(res) ? res : res.items;
        const sorted = [...rawItems].sort((a, b) => {
          const tA = a.timestampUtc || a.timestampOriginal || "";
          const tB = b.timestampUtc || b.timestampOriginal || "";
          return tA.localeCompare(tB);
        });
        setEvents(sorted);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentCase?.caseId]);

  if (loading) {
    return <LoadingState message="Reconstructing forensic event timeline..." />;
  }

  const getTimelineIcon = (eventType: string) => {
    switch (eventType) {
      case "AUTH_SUCCESS":
      case "SESSION_OPENED":
        return <LogIn className="w-3.5 h-3.5 text-status-success" />;
      case "AUTH_FAILURE":
      case "INVALID_USER":
        return <ShieldAlert className="w-3.5 h-3.5 text-status-danger" />;
      case "DISCONNECT":
      case "SESSION_CLOSED":
        return <LogOut className="w-3.5 h-3.5 text-amber-500" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-accent" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forensic Timeline Explorer"
        description="Temporal reconstruction of security events and authentication attempts. Chronological ordering preserves original timestamp references and audit chain integrity."
      />

      {/* Timeline view */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <CardTitle>Session Chronology</CardTitle>
          </div>
          <Badge variant="accent" className="font-mono text-xs">
            {events.length} Events Sequenced
          </Badge>
        </CardHeader>
        <CardContent className="p-6">
          <div className="relative border-l-2 border-border ml-3 sm:ml-6 space-y-8 pl-6 py-2">
            {events.map((ev) => (
              <div key={ev.eventId} className="relative group">
                {/* Timeline node marker */}
                <div className="absolute -left-[31px] top-1.5 w-6 h-6 rounded-full bg-surface border-2 border-border group-hover:border-accent flex items-center justify-center transition-colors shadow-xs">
                  {getTimelineIcon(ev.eventType)}
                </div>

                {/* Event Card */}
                <div className="rounded-lg border border-border bg-surface p-3.5 hover:border-border-strong transition-all shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2 border-b border-border-subtle">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-text-primary">
                        {ev.eventType}
                      </span>
                      <Badge
                        variant={
                          ev.severity === "CRITICAL"
                            ? "danger"
                            : ev.severity === "WARNING"
                            ? "warning"
                            : "default"
                        }
                      >
                        {ev.severity}
                      </Badge>
                      <span className="text-[11px] text-text-muted font-mono">
                        {ev.source}
                      </span>
                    </div>

                    <div className="font-mono text-[11px] text-text-muted flex items-center gap-1">
                      <Clock className="w-3 h-3 text-text-disabled" />
                      <span>{formatDateTime(ev.timestampUtc || ev.timestampOriginal)}</span>
                    </div>
                  </div>

                  {/* Message body */}
                  <div className="mt-2.5 font-mono text-xs text-text-primary bg-surface-subtle p-2.5 rounded border border-border-subtle">
                    {ev.message}
                  </div>

                  {/* Context chips */}
                  <div className="mt-2.5 flex items-center gap-3 text-[11px] text-text-muted flex-wrap">
                    {ev.srcIp && (
                      <span className="flex items-center gap-1 font-mono">
                        IP: <strong className="text-text-primary font-medium">{ev.srcIp}</strong>
                        {ev.srcIpScope && (
                          <span className="text-[9px] px-1 rounded bg-surface-muted text-text-muted ml-0.5">
                            {ev.srcIpScope}
                          </span>
                        )}
                      </span>
                    )}

                    {ev.userValue && (
                      <span className="flex items-center gap-1 font-mono">
                        User: <strong className="text-text-primary font-medium">{ev.userValue}</strong>
                      </span>
                    )}

                    {ev.host && (
                      <span className="flex items-center gap-1 font-mono">
                        Host: <strong className="text-text-primary font-medium">{ev.host}</strong>
                      </span>
                    )}

                    <span className="ml-auto text-[10px] text-text-disabled font-mono">
                      Event ID: {ev.eventId}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
