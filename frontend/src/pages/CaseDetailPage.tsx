import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { getCaseById } from "@/services/cases";
import { useCase } from "@/context/CaseContext";
import { Case } from "@/types/case";
import { formatDateTime } from "@/lib/formatters";
import {
  FolderKanban,
  HardDrive,
  ListOrdered,
  Search,
  CheckCircle2,
  ArrowLeft,
  Check,
  Calendar,
  User,
  Shield,
  FileText,
} from "lucide-react";

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { selectedCaseId, setSelectedCaseId } = useCase();
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCase = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getCaseById(caseId);
      setCaseItem(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load case profile");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  if (loading) {
    return <LoadingState message="Loading case profile..." />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/cases">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Cases
          </Button>
        </Link>
        <ErrorState
          title="Error Loading Case Profile"
          message={error}
          onRetry={loadCase}
        />
      </div>
    );
  }

  if (!caseItem) {
    return (
      <div className="space-y-4">
        <Link to="/cases">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Cases
          </Button>
        </Link>
        <EmptyState
          icon={<FolderKanban className="w-10 h-10 text-text-disabled" />}
          title="Case Not Found"
          description={`Forensic case ${caseId} does not exist in the repository.`}
        />
      </div>
    );
  }

  const isCurrentActive = caseItem.caseId === selectedCaseId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/cases">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> All Cases
          </Button>
        </Link>
        {!isCurrentActive && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setSelectedCaseId(caseItem.caseId)}
          >
            <Check className="w-3.5 h-3.5 mr-1" /> Set as Active Workspace
          </Button>
        )}
      </div>

      <PageHeader
        title={`${caseItem.caseId}: ${caseItem.name}`}
        description={caseItem.description || "No description recorded."}
        actions={
          <Badge
            variant={caseItem.status === "OPEN" ? "verified" : "neutral"}
            className="text-xs px-2.5 py-1"
          >
            {caseItem.status}
          </Badge>
        }
      />

      {/* Case Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-accent" /> Lead Examiner
            </div>
            <div className="text-sm font-semibold text-text-primary mt-1">
              {caseItem.leadInvestigator}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-accent" /> Inception Date
            </div>
            <div className="text-xs font-mono text-text-primary mt-1">
              {formatDateTime(caseItem.createdAt)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-status-success" /> Isolation Directory
            </div>
            <div className="text-xs font-mono text-text-primary truncate mt-1">
              data/cases/{caseItem.caseId}/
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-muted font-medium flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-500" /> Database File
            </div>
            <div className="text-xs font-mono text-text-primary truncate mt-1">
              case.db (SQLCipher / SQLite)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subsystem Artifact Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted font-medium">Evidence Files</div>
              <div className="text-xl font-bold font-mono text-text-primary mt-1">
                {caseItem.evidenceCount}
              </div>
              <Link to="/evidence" className="text-[11px] text-accent hover:underline mt-2 inline-block">
                View Evidence →
              </Link>
            </div>
            <HardDrive className="w-8 h-8 text-border-strong" />
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted font-medium">Parsed Events</div>
              <div className="text-xl font-bold font-mono text-text-primary mt-1">
                {caseItem.eventsCount.toLocaleString()}
              </div>
              <Link to="/events" className="text-[11px] text-accent hover:underline mt-2 inline-block">
                Query Events →
              </Link>
            </div>
            <ListOrdered className="w-8 h-8 text-border-strong" />
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted font-medium">Investigations</div>
              <div className="text-xl font-bold font-mono text-text-primary mt-1">
                {caseItem.investigationsCount}
              </div>
              <Link to="/investigation" className="text-[11px] text-accent hover:underline mt-2 inline-block">
                Open Workspace →
              </Link>
            </div>
            <Search className="w-8 h-8 text-border-strong" />
          </CardContent>
        </Card>

        <Card className="hover:border-border-strong transition-colors">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted font-medium">Compiled Findings</div>
              <div className="text-xl font-bold font-mono text-text-primary mt-1">
                {caseItem.findingsCount}
              </div>
              <Link to="/findings" className="text-[11px] text-accent hover:underline mt-2 inline-block">
                Inspect Findings →
              </Link>
            </div>
            <CheckCircle2 className="w-8 h-8 text-status-success/70" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
