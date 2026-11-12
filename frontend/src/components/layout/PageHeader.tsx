import React from "react";
import { FixtureModeBadge } from "@/components/common/OfflineIndicator";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Badges / metadata shown next to the title */
  meta?: React.ReactNode;
  /** Small context line above the title (e.g. case scope) */
  eyebrow?: React.ReactNode;
  /**
   * Show the fixture-data badge. It only renders when the UI is
   * actually in fixture mode, so it can never mislabel live data.
   */
  showFixtureBadge?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
  eyebrow,
  showFixtureBadge = true,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs text-text-muted">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{title}</h1>
          {meta}
          {showFixtureBadge && <FixtureModeBadge />}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Case-scope line used as PageHeader eyebrow on case-scoped pages.
 */
export function CaseScope({ caseId, name }: { caseId?: string; name?: string }) {
  if (!caseId) return <span>No case selected</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="label-caps">Case</span>
      <span className="font-mono font-medium text-text-secondary">{caseId}</span>
      {name && <span className="hidden truncate sm:inline">· {name}</span>}
    </span>
  );
}

/**
 * Horizontal toolbar row for search + filters above a table.
 */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2.5", className)}>
      {children}
    </div>
  );
}
