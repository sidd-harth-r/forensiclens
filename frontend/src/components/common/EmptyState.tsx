import React from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Additional action node (e.g. a Link) */
  action?: React.ReactNode;
  /** Render without the dashed frame when already inside a panel */
  bare?: boolean;
  className?: string;
}

export function EmptyState({
  icon = <Inbox />,
  title,
  description,
  actionLabel,
  onAction,
  action,
  bare = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-10 text-center",
        !bare && "rounded-md border border-dashed border-border bg-surface/60",
        className
      )}
    >
      <div
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-muted [&_svg]:h-4 [&_svg]:w-4"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-text-muted">{description}</p>
      {(action || (actionLabel && onAction)) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction && (
            <Button variant="secondary" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
