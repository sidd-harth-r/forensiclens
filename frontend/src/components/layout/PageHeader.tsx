import React from "react";
import { FixtureModeBadge } from "@/components/common/OfflineIndicator";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  showFixtureBadge?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  showFixtureBadge = true,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 mb-5 border-b border-border">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold tracking-tight text-text-primary">{title}</h1>
          {showFixtureBadge && <FixtureModeBadge />}
        </div>
        {description && (
          <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

