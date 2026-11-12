import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Compact inline variant for use inside panels */
  inline?: boolean;
  className?: string;
}

export function ErrorState({ title = "Failed to load data", message, onRetry, inline = false, className }: ErrorStateProps) {
  if (inline) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 rounded border border-status-danger/30 bg-status-danger-bg px-3 py-2.5",
          className
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-status-danger" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-status-danger">{title}</p>
            <p className="mt-0.5 break-words text-xs text-text-secondary">{message}</p>
          </div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-status-danger/30 bg-status-danger-bg px-6 py-8 text-center",
        className
      )}
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-status-danger/30 bg-surface text-status-danger">
        <AlertOctagon className="h-4 w-4" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-status-danger">{title}</h3>
      <p className="mt-1 max-w-lg break-words text-xs text-text-secondary">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
