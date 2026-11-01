import { useState, useMemo } from "react";
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
import { formatDateTime } from "@/lib/formatters";
import { Search, FolderKanban, Check, Filter } from "lucide-react";

export function CasesPage() {
  const { cases, selectedCaseId, setSelectedCaseId } = useCase();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchesSearch =
        c.caseId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [cases, searchTerm, statusFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Case Repository"
        description="Forensic investigation workspaces. Each case operates with isolated databases, cryptographic vaults, and immutable evidence directories."
        actions={
          <Button variant="default" size="sm" disabled title="Case creation will connect to backend API in Phase 1">
            + New Forensic Case
          </Button>
        }
      />

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="w-full sm:w-80">
              <Input
                placeholder="Search by Case ID, title, or keywords..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                icon={<Search className="w-3.5 h-3.5 text-text-muted" />}
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-muted">Status:</span>
              {(["ALL", "OPEN", "CLOSED", "ARCHIVED"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors font-medium ${
                    statusFilter === st
                      ? "bg-accent text-white"
                      : "bg-surface-subtle text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases Table */}
      <Card>
        <CardContent className="p-0">
          {filteredCases.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<FolderKanban className="w-8 h-8 text-text-disabled" />}
                title="No forensic cases found"
                description={
                  searchTerm
                    ? `No cases match the query "${searchTerm}". Try resetting search or status filters.`
                    : "No cases exist matching the selected criteria."
                }
                actionLabel="Reset Filters"
                onAction={() => {
                  setSearchTerm("");
                  setStatusFilter("ALL");
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">Active</TableHead>
                  <TableHead className="w-32">Case ID</TableHead>
                  <TableHead>Investigation Name</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-24 text-right">Evidence</TableHead>
                  <TableHead className="w-28 text-right">Events</TableHead>
                  <TableHead className="w-44">Last Activity</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCases.map((c) => {
                  const isCurrent = c.caseId === selectedCaseId;
                  return (
                    <TableRow key={c.caseId} className={isCurrent ? "bg-accent-subtle/40" : ""}>
                      <TableCell className="text-center">
                        {isCurrent ? (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[10px]"
                            title="Currently active case"
                          >
                            <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedCaseId(c.caseId)}
                            className="text-[11px] text-accent hover:underline font-medium"
                            title="Switch active scope to this case"
                          >
                            Select
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="font-mono font-bold text-xs text-text-primary">
                        <Link to={`/cases/${c.caseId}`} className="hover:text-accent hover:underline">
                          {c.caseId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-xs text-text-primary">{c.name}</div>
                        <div className="text-[11px] text-text-muted line-clamp-1 mt-0.5">
                          {c.description}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.status === "OPEN"
                              ? "verified"
                              : c.status === "CLOSED"
                              ? "neutral"
                              : "default"
                          }
                        >
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.evidenceCount}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.eventsCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-text-muted font-mono">
                        {formatDateTime(c.lastActivity)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to={`/cases/${c.caseId}`}>
                          <Button variant="ghost" size="sm">
                            Inspect
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
