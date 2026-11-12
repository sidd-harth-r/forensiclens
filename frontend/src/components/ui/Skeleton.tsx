import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded bg-surface-muted", className)} aria-hidden="true" />;
}

/**
 * Placeholder rows matching the dense table rhythm, so layout does not shift
 * when data arrives.
 */
export function TableSkeleton({ rows = 8, columns = 6, label = "Loading" }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="w-full">
      <span className="sr-only">{label}</span>
      <div className="flex h-8 items-center gap-4 border-b border-border bg-surface-subtle px-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className={cn("h-2.5", i === 0 ? "w-24" : "flex-1")} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-10 items-center gap-4 border-b border-border-subtle px-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? "w-24" : "flex-1", r % 2 && c === columns - 1 ? "opacity-60" : "")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-2.5 rounded-md border border-border bg-surface p-4", className)}>
      <span className="sr-only">Loading</span>
      <Skeleton className="h-3 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
