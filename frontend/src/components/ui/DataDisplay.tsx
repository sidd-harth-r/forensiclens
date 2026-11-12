import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateTime, formatHash, isIsoTimestamp } from "@/lib/formatters";
import { Button } from "./Button";

/* ------------------------------------------------------------------ */
/* Copy to clipboard                                                   */
/* ------------------------------------------------------------------ */

export async function copyText(text: string, label: string): Promise<void> {
  try {
    if (!navigator?.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error(`Could not copy ${label}`);
  }
}

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copyText(value, label).then(() => setCopied(true));
      }}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-muted hover:text-text-primary",
        className
      )}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {copied ? <Check className="h-3 w-3 text-status-success" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Identifiers and hashes                                              */
/* ------------------------------------------------------------------ */

export function HashValue({
  value,
  label = "hash",
  truncate = true,
  leading = 10,
  trailing = 8,
  className,
}: {
  value: string | null | undefined;
  label?: string;
  truncate?: boolean;
  leading?: number;
  trailing?: number;
  className?: string;
}) {
  if (!value) return <span className="text-text-disabled">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-xs text-text-secondary", className)}>
      <span className={cn(!truncate && "break-all")} title={value}>
        {truncate ? formatHash(value, leading, trailing) : value}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

export function IdValue({ value, label = "ID", className }: { value: string; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-xs font-medium text-text-primary", className)}>
      <span className="truncate" title={value}>
        {value}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

/**
 * Renders a UTC-normalized timestamp, or — when only the source timestamp is
 * available — the verbatim source value, visibly flagged as not normalized.
 */
export function Timestamp({
  utc,
  original,
  showZone = false,
  className,
}: {
  utc?: string | null;
  original?: string | null;
  showZone?: boolean;
  className?: string;
}) {
  if (isIsoTimestamp(utc)) {
    const text = formatDateTime(utc);
    return (
      <time dateTime={utc} className={className} title={original ? `Source: ${original}` : undefined}>
        {showZone ? text : text.replace(" UTC", "")}
      </time>
    );
  }
  const raw = utc || original;
  if (!raw) return <span className={cn("text-text-disabled", className)}>—</span>;
  return (
    <span
      className={cn("underline decoration-status-warning/60 decoration-dotted underline-offset-2", className)}
      title="Source timestamp as recorded — not normalized to UTC (e.g. year or timezone not present in the evidence)"
    >
      {raw}
      <span className="sr-only"> (source timestamp, not normalized to UTC)</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Key / value metadata                                                */
/* ------------------------------------------------------------------ */

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  /** Span full row in grid layouts */
  wide?: boolean;
}

export function KeyValueGrid({
  items,
  columns = 2,
  className,
}: {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  }[columns];
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols, className)}>
      {items.map((item, i) => (
        <div key={i} className={cn("min-w-0", item.wide && "col-span-full")}>
          <dt className="label-caps">{item.label}</dt>
          <dd
            className={cn(
              "mt-0.5 break-words text-sm text-text-primary",
              item.mono && "font-mono text-xs"
            )}
          >
            {item.value ?? <span className="text-text-disabled">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal label/value rows for narrow inspectors */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border-subtle", className)}>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[minmax(110px,34%)_1fr] gap-3 py-1.5">
          <dt className="text-xs text-text-muted">{item.label}</dt>
          <dd className={cn("min-w-0 break-words text-xs text-text-primary", item.mono && "font-mono")}>
            {item.value ?? <span className="text-text-disabled">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Metric tile                                                         */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  onClick,
  active,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "neutral" | "accent";
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const toneBar = {
    default: "bg-border-strong",
    success: "bg-status-success",
    warning: "bg-status-warning",
    danger: "bg-status-danger",
    neutral: "bg-status-neutral",
    accent: "bg-accent",
  }[tone];
  const toneIcon = {
    default: "text-text-muted",
    success: "text-status-success",
    warning: "text-status-warning",
    danger: "text-status-danger",
    neutral: "text-status-neutral",
    accent: "text-accent",
  }[tone];

  const body = (
    <>
      <span className={cn("absolute inset-y-0 left-0 w-0.5 rounded-l-md", toneBar, !active && "opacity-60")} aria-hidden="true" />
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate">{label}</span>
        {icon && <span className={cn("[&_svg]:h-3.5 [&_svg]:w-3.5", toneIcon)} aria-hidden="true">{icon}</span>}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold leading-none tracking-tight text-text-primary">{value}</div>
      {hint && <div className="mt-1.5 truncate text-2xs text-text-muted">{hint}</div>}
    </>
  );

  const base = cn(
    "relative block w-full overflow-hidden rounded-md border bg-surface px-3.5 py-3 text-left",
    active ? "border-border-strong bg-surface-subtle" : "border-border",
    className
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(base, "cursor-pointer transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent")}
      >
        {body}
      </button>
    );
  }
  return <div className={base}>{body}</div>;
}

/* ------------------------------------------------------------------ */
/* Proportion bar                                                      */
/* ------------------------------------------------------------------ */

export interface DistributionSegment {
  key: string;
  label: string;
  value: number;
  className: string;
}

/**
 * Stacked horizontal bar with a text legend. Values are always shown as
 * numbers next to the color swatch so color is never the only signal.
 */
export function DistributionBar({
  segments,
  label,
  className,
}: {
  segments: DistributionSegment[];
  label: string;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className={cn("space-y-2.5", className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="img"
        aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      >
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} className={cn("h-full", s.className)} style={{ width: `${(s.value / total) * 100}%` }} />
            ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-text-secondary">
              <span className={cn("h-2 w-2 shrink-0 rounded-sm", s.className)} aria-hidden="true" />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-mono text-text-primary">
              {s.value}
              {total > 0 && <span className="ml-1 text-text-muted">{Math.round((s.value / total) * 100)}%</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  noun = "records",
  onPageChange,
  disabled,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  noun?: string;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pages = Math.max(1, totalPages);
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle px-3 py-2 text-xs text-text-muted",
        className
      )}
    >
      <span>
        <span className="font-mono text-text-primary">{start.toLocaleString()}</span>–
        <span className="font-mono text-text-primary">{end.toLocaleString()}</span> of{" "}
        <span className="font-mono text-text-primary">{total.toLocaleString()}</span> {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={disabled || page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <span className="min-w-[72px] text-center font-mono" aria-current="page">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          disabled={disabled || page >= pages}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Verbatim evidence block                                             */
/* ------------------------------------------------------------------ */

export function EvidenceText({
  children,
  className,
  wrap = true,
  maxHeightClass = "max-h-48",
}: {
  children: React.ReactNode;
  className?: string;
  wrap?: boolean;
  maxHeightClass?: string;
}) {
  return (
    <pre
      className={cn(
        "evidence-block overflow-auto select-text",
        wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
        maxHeightClass,
        className
      )}
    >
      {children}
    </pre>
  );
}
