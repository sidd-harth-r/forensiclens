import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useCase } from "@/context/CaseContext";
import { PageHeader, FilterBar } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Field, SearchField } from "@/components/ui/Input";
import { CaseStatusBadge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Dialog } from "@/components/ui/Dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { formatDateTime, describeError } from "@/lib/formatters";
import { createCase } from "@/services/cases";

type StatusFilter = "ALL" | "OPEN" | "CLOSED" | "ARCHIVED";

export function CasesPage() {
  const { cases, selectedCaseId, setSelectedCaseId, isLoading, error, refreshCases } = useCase();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form fields
  const [newCaseId, setNewCaseId] = useState("");
  const [newCaseName, setNewCaseName] = useState("");
  const [newCaseDescription, setNewCaseDescription] = useState("");
  const [newLeadInvestigator, setNewLeadInvestigator] = useState("Lead Analyst");
  const [nameError, setNameError] = useState<string | null>(null);

  const filteredCases = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return cases.filter((c) => {
      const matchesSearch =
        c.caseId.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [cases, searchTerm, statusFilter]);

  const counts = useMemo(
    () => ({
      ALL: cases.length,
      OPEN: cases.filter((c) => c.status === "OPEN").length,
      CLOSED: cases.filter((c) => c.status === "CLOSED").length,
      ARCHIVED: cases.filter((c) => c.status === "ARCHIVED").length,
    }),
    [cases]
  );

  const closeModal = () => {
    if (isSubmitting) return;
    setShowCreateModal(false);
    setNameError(null);
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseName.trim()) {
      setNameError("Case title is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createCase({
        caseId: newCaseId.trim() || undefined,
        name: newCaseName.trim(),
        description: newCaseDescription.trim() || undefined,
        leadInvestigator: newLeadInvestigator.trim() || undefined,
      });

      toast.success(`Case ${created.caseId} created`);
      setShowCreateModal(false);
      setNewCaseId("");
      setNewCaseName("");
      setNewCaseDescription("");
      setNameError(null);
      await refreshCases();
      setSelectedCaseId(created.caseId);
    } catch (err) {
      toast.error(describeError(err, "Failed to create forensic case"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtersActive = searchTerm !== "" || statusFilter !== "ALL";

  return (
    <>
      <PageHeader
        title="Cases"
        description="Each case is an isolated workspace with its own database and read-only evidence store."
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New case
          </Button>
        }
      />

      {error && !isLoading ? (
        <ErrorState title="Failed to load cases" message={error} onRetry={refreshCases} />
      ) : (
        <Card className="overflow-hidden">
          <FilterBar>
            <SearchField
              label="Search cases"
              placeholder="Search by case ID, title or description"
              value={searchTerm}
              onValueChange={setSearchTerm}
              className="sm:w-80"
            />
            <SegmentedControl<StatusFilter>
              label="Filter by case status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={(["ALL", "OPEN", "CLOSED", "ARCHIVED"] as const).map((s) => ({
                value: s,
                label: (
                  <>
                    {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                    <span className="font-mono text-text-disabled">{counts[s]}</span>
                  </>
                ),
              }))}
            />
            <span className="ml-auto text-xs text-text-muted" aria-live="polite">
              {filteredCases.length} of {cases.length} cases
            </span>
          </FilterBar>

          {isLoading ? (
            <TableSkeleton rows={5} columns={7} label="Loading cases" />
          ) : filteredCases.length === 0 ? (
            <EmptyState
              bare
              icon={<FolderKanban />}
              title={filtersActive ? "No cases match these filters" : "No cases yet"}
              description={
                filtersActive
                  ? "Adjust the search text or status filter."
                  : "Create a case to start ingesting and analyzing evidence."
              }
              actionLabel={filtersActive ? "Clear filters" : "Create case"}
              onAction={() => {
                if (filtersActive) {
                  setSearchTerm("");
                  setStatusFilter("ALL");
                } else {
                  setShowCreateModal(true);
                }
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Case</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[90px] text-right">Evidence</TableHead>
                  <TableHead className="w-[100px] text-right">Events</TableHead>
                  <TableHead className="w-[140px]">Lead examiner</TableHead>
                  <TableHead className="w-[170px]">Last activity (UTC)</TableHead>
                  <TableHead className="w-[150px] text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCases.map((c) => {
                  const isCurrent = c.caseId === selectedCaseId;
                  return (
                    <TableRow key={c.caseId} selected={isCurrent}>
                      <TableCell>
                        <Link
                          to={`/cases/${encodeURIComponent(c.caseId)}`}
                          className="rounded font-mono text-xs font-semibold text-text-primary hover:text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {c.caseId}
                        </Link>
                        {isCurrent && (
                          <span className="mt-0.5 flex items-center gap-1 text-2xs text-accent-text">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Active
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <div className="truncate text-sm text-text-primary">{c.name}</div>
                        <div className="truncate text-xs text-text-muted">{c.description || "No description"}</div>
                      </TableCell>
                      <TableCell>
                        <CaseStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.evidenceCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.eventsCount.toLocaleString()}</TableCell>
                      <TableCell className="truncate text-xs text-text-secondary">{c.leadInvestigator}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-2xs text-text-muted">
                        {formatDateTime(c.lastActivity)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {!isCurrent && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setSelectedCaseId(c.caseId)}
                              aria-label={`Set ${c.caseId} as active case`}
                            >
                              Set active
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => navigate(`/cases/${encodeURIComponent(c.caseId)}`)}
                            aria-label={`Open case ${c.caseId}`}
                          >
                            Open
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <Dialog
        open={showCreateModal}
        onClose={closeModal}
        title="New case"
        description="Creates an isolated case workspace and database on this machine."
        dismissible={!isSubmitting}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="create-case-form" variant="primary" size="sm" loading={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create case"}
            </Button>
          </>
        }
      >
        <form id="create-case-form" onSubmit={handleCreateCase} className="space-y-3.5" noValidate>
          <Field label="Case title" htmlFor="case-name" required error={nameError}>
            <Input
              id="case-name"
              data-autofocus
              placeholder="e.g. Unauthorized SSH access — web-01"
              value={newCaseName}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "case-name-error" : undefined}
              onChange={(e) => {
                setNewCaseName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>

          <Field label="Case ID" htmlFor="case-id" hint="Optional. Generated automatically when left blank.">
            <Input
              id="case-id"
              className="font-mono"
              placeholder="e.g. CASE-2026-001"
              value={newCaseId}
              aria-describedby="case-id-hint"
              onChange={(e) => setNewCaseId(e.target.value)}
            />
          </Field>

          <Field label="Description" htmlFor="case-description">
            <Textarea
              id="case-description"
              placeholder="Incident scope, background and investigative objectives"
              value={newCaseDescription}
              onChange={(e) => setNewCaseDescription(e.target.value)}
            />
          </Field>

          <Field label="Lead examiner" htmlFor="case-lead">
            <Input id="case-lead" value={newLeadInvestigator} onChange={(e) => setNewLeadInvestigator(e.target.value)} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
