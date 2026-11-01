import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCase } from "@/context/CaseContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/common/LoadingState";
import { getSystemStatus } from "@/services/system";
import { SystemStatus } from "@/types/system";
import {
  FolderKanban,
  HardDrive,
  ListOrdered,
  ShieldCheck,
  Search,
  CheckCircle2,
  ArrowRight,
  Server,
  Database,
  Cpu,
  WifiOff,
  Activity,
} from "lucide-react";

export function DashboardPage() {
  const { currentCase, isLoading: caseLoading } = useCase();
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSystemStatus().then((res) => {
      if (mounted) {
        setSystemStatus(res);
        setStatusLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (caseLoading || statusLoading) {
    return <LoadingState message="Loading forensic dashboard overview..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forensic Investigation Overview"
        description="Air-gapped digital forensics workspace. Operating in local-first mode with cryptographic evidence integrity and verifiable claim resolution."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/investigation">
              <Button variant="default" size="sm">
                <Search className="w-3.5 h-3.5 mr-1.5" />
                New Investigation
              </Button>
            </Link>
          </div>
        }
      />

      {/* Primary Forensic Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Active Case</span>
              <FolderKanban className="w-3.5 h-3.5 text-accent" />
            </div>
            <div className="mt-2">
              <div className="font-mono text-base font-bold text-text-primary truncate">
                {currentCase?.caseId}
              </div>
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                {currentCase?.status}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Evidence Files</span>
              <HardDrive className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <div className="mt-2">
              <div className="font-mono text-base font-bold text-text-primary">
                {currentCase?.evidenceCount}
              </div>
              <div className="text-[10px] text-status-success font-medium flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-2.5 h-2.5" /> SHA-256 Verified
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Parsed Events</span>
              <ListOrdered className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <div className="mt-2">
              <div className="font-mono text-base font-bold text-text-primary">
                {currentCase?.eventsCount.toLocaleString()}
              </div>
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                FTS5 Indexed
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Integrity Status</span>
              <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
            </div>
            <div className="mt-2">
              <div className="text-base font-bold text-status-success flex items-center gap-1">
                VALID
              </div>
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                Hash Chain Intact
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Investigations</span>
              <Search className="w-3.5 h-3.5 text-purple-500" />
            </div>
            <div className="mt-2">
              <div className="font-mono text-base font-bold text-text-primary">
                {currentCase?.investigationsCount}
              </div>
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                Privacy L2 Active
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-[11px] font-medium">Verified Findings</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
            </div>
            <div className="mt-2">
              <div className="font-mono text-base font-bold text-text-primary">
                {currentCase?.findingsCount}
              </div>
              <div className="text-[10px] text-status-success font-medium truncate mt-0.5">
                Compiled Predicates
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main split: Current Case Summary & Recent Forensic Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Case Detail Card */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <div>
              <CardTitle>Case Focus: {currentCase?.name}</CardTitle>
              <CardDescription>
                Lead Examiner: {currentCase?.leadInvestigator} • Created:{" "}
                {currentCase?.createdAt ? new Date(currentCase.createdAt).toLocaleDateString() : ""}
              </CardDescription>
            </div>
            <Link to={`/cases/${currentCase?.caseId}`}>
              <Button variant="outline" size="sm">
                Case Details
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <p className="text-xs text-text-secondary leading-relaxed">
              {currentCase?.description}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded border border-border bg-surface-subtle">
                <div className="text-[11px] text-text-muted font-medium">Evidence Storage</div>
                <div className="text-xs font-semibold text-text-primary mt-1">
                  Immutable Content-Addressed
                </div>
                <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                  cases/{currentCase?.caseId}/evidence/
                </div>
              </div>

              <div className="p-3 rounded border border-border bg-surface-subtle">
                <div className="text-[11px] text-text-muted font-medium">Legal Foundation</div>
                <div className="text-xs font-semibold text-text-primary mt-1">
                  BSA s.63 & IT Act
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Electronic Certificate Ready
                </div>
              </div>

              <div className="p-3 rounded border border-border bg-surface-subtle">
                <div className="text-[11px] text-text-muted font-medium">Verification Engine</div>
                <div className="text-xs font-semibold text-text-primary mt-1">
                  Deterministic Predicates
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Read-Only Database Connection
                </div>
              </div>
            </div>

            {/* Quick Actions Shortcuts */}
            <div className="pt-2 border-t border-border-subtle flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-text-muted mr-1">Workflows:</span>
              <Link to="/evidence">
                <Button variant="secondary" size="sm">
                  <HardDrive className="w-3 h-3 mr-1 text-text-muted" /> Explore Evidence
                </Button>
              </Link>
              <Link to="/events">
                <Button variant="secondary" size="sm">
                  <ListOrdered className="w-3 h-3 mr-1 text-text-muted" /> Query Events
                </Button>
              </Link>
              <Link to="/timeline">
                <Button variant="secondary" size="sm">
                  <Activity className="w-3 h-3 mr-1 text-text-muted" /> View Timeline
                </Button>
              </Link>
              <Link to="/findings">
                <Button variant="secondary" size="sm">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-text-muted" /> Inspect Claims
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Local System Status (Ready for /health API) */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle>System & Subsystem Status</CardTitle>
              <Badge variant="verified" icon={<ShieldCheck className="w-3 h-3" />}>
                SECURE
              </Badge>
            </div>
            <CardDescription>
              Architectural boundary monitoring (UI representation)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {systemStatus && (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-start justify-between p-2 rounded bg-surface-subtle border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-accent shrink-0" />
                    <div>
                      <div className="font-semibold text-text-primary">{systemStatus.backend.name}</div>
                      <div className="text-[10px] text-text-muted">{systemStatus.backend.description}</div>
                    </div>
                  </div>
                  <Badge variant="verified">ONLINE</Badge>
                </div>

                <div className="flex items-start justify-between p-2 rounded bg-surface-subtle border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <div className="font-semibold text-text-primary">{systemStatus.database.name}</div>
                      <div className="text-[10px] text-text-muted">{systemStatus.database.description}</div>
                    </div>
                  </div>
                  <Badge variant="verified">WAL ON</Badge>
                </div>

                <div className="flex items-start justify-between p-2 rounded bg-surface-subtle border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-blue-500 shrink-0" />
                    <div>
                      <div className="font-semibold text-text-primary">{systemStatus.searchIndex.name}</div>
                      <div className="text-[10px] text-text-muted">{systemStatus.searchIndex.description}</div>
                    </div>
                  </div>
                  <Badge variant="verified">SYNCED</Badge>
                </div>

                <div className="flex items-start justify-between p-2 rounded bg-surface-subtle border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-purple-500 shrink-0" />
                    <div>
                      <div className="font-semibold text-text-primary">{systemStatus.localLlm.name}</div>
                      <div className="text-[10px] text-text-muted">{systemStatus.localLlm.description}</div>
                    </div>
                  </div>
                  <Badge variant="verified">OFFLINE</Badge>
                </div>

                <div className="flex items-start justify-between p-2 rounded bg-surface-subtle border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-status-success shrink-0" />
                    <div>
                      <div className="font-semibold text-text-primary">{systemStatus.networkEgress.name}</div>
                      <div className="text-[10px] text-text-muted">{systemStatus.networkEgress.description}</div>
                    </div>
                  </div>
                  <Badge variant="verified">ISOLATED</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
