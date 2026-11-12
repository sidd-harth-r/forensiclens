import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FolderKanban,
  HardDrive,
  ListTree,
  Search,
  ClipboardCheck,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { CaseStatusBadge, Badge } from "@/components/ui/Badge";
import { KeyValueGrid, StatTile, IdValue } from "@/components/ui/DataDisplay";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { getCaseById } from "@/services/cases";
import { useCase } from "@/context/CaseContext";
import { Case } from "@/types/case";
import { formatDateTime, describeError } from "@/lib/formatters";

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
      setError(describeError(err, "Failed to load case profile"));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  const back = (
    <LinkButton to="/cases" variant="ghost" size="sm" className="-ml-2 mb-2">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      All cases
    </LinkButton>
  );

  if (loading) {
    return (
      <>
        {back}
        <div className="space-y-4">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {back}
        <ErrorState title="Could not load case" message={error} onRetry={loadCase} />
      </>
    );
  }

  if (!caseItem) {
    return (
      <>
        {back}
        <EmptyState
          icon={<FolderKanban />}
          title="Case not found"
          description={`No case with ID ${caseId} exists in the repository.`}
        />
      </>
    );
  }

  const isCurrentActive = caseItem.caseId === selectedCaseId;

  return (
    <>
      {back}
      <PageHeader
        eyebrow={<IdValue value={caseItem.caseId} label="case ID" />}
        title={caseItem.name}
        meta={
          <>
            <CaseStatusBadge status={caseItem.status} />
            {isCurrentActive && (
              <Badge variant="accent" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>
                Active case
              </Badge>
            )}
          </>
        }
        description={caseItem.description || "No description recorded."}
        actions={
          !isCurrentActive && (
            <Button variant="primary" size="sm" onClick={() => setSelectedCaseId(caseItem.caseId)}>
              Set as active case
            </Button>
          )
        }
      />

      <section aria-label="Case artifacts" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Evidence files" value={caseItem.evidenceCount.toLocaleString()} icon={<HardDrive />} />
        <StatTile label="Parsed events" value={caseItem.eventsCount.toLocaleString()} icon={<ListTree />} />
        <StatTile label="Investigations" value={caseItem.investigationsCount.toLocaleString()} icon={<Search />} />
        <StatTile label="Findings" value={caseItem.findingsCount.toLocaleString()} icon={<ClipboardCheck />} />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Case metadata" className="lg:col-span-2">
          <KeyValueGrid
            columns={2}
            items={[
              { label: "Case ID", value: caseItem.caseId, mono: true },
              { label: "Status", value: <CaseStatusBadge status={caseItem.status} /> },
              { label: "Lead examiner", value: caseItem.leadInvestigator },
              { label: "Created (UTC)", value: formatDateTime(caseItem.createdAt), mono: true },
              { label: "Last activity (UTC)", value: formatDateTime(caseItem.lastActivity), mono: true },
              // The backend does not report the database path (it resolves it from DATA_DIR),
              // so only the storage engine is stated here rather than a client-constructed path.
              { label: "Case database", value: "Isolated per-case SQLite database (case.db)" },
            ]}
          />
        </Panel>

        <Panel title="Continue in this case" flush>
          {!isCurrentActive && (
            <p className="border-b border-border-subtle px-4 py-2.5 text-xs text-text-muted">
              Workspace pages operate on the active case. Opening one below switches the active case to{" "}
              <span className="font-mono text-text-secondary">{caseItem.caseId}</span>.
            </p>
          )}
          <ul className="divide-y divide-border-subtle">
            {[
              { to: "/evidence", label: "Evidence", detail: `${caseItem.evidenceCount} files` },
              { to: "/events", label: "Event Explorer", detail: `${caseItem.eventsCount.toLocaleString()} events` },
              { to: "/timeline", label: "Timeline", detail: "Chronological view" },
              { to: "/retrieval", label: "Retrieval Explorer", detail: "Hybrid search" },
              { to: "/claims", label: "Claim Verification", detail: "Extract & verify" },
            ].map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setSelectedCaseId(caseItem.caseId)}
                  className="group flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="text-sm text-text-primary">{l.label}</span>
                  <span className="flex items-center gap-2 font-mono text-2xs text-text-muted">
                    {l.detail}
                    <ArrowRight className="h-3.5 w-3.5 text-text-disabled group-hover:text-text-secondary" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
