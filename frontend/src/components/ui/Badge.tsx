import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  UserCheck,
  Loader2,
  Clock,
  Info,
  CircleDot,
  Archive,
  Lock,
} from "lucide-react";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px text-2xs font-medium leading-4",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-muted text-text-secondary",
        verified: "border-status-success/30 bg-status-success-bg text-status-success",
        warning: "border-status-warning/30 bg-status-warning-bg text-status-warning",
        danger: "border-status-danger/30 bg-status-danger-bg text-status-danger",
        neutral: "border-border bg-status-neutral-bg text-status-neutral",
        human: "border-status-human/30 bg-status-human-bg text-status-human",
        info: "border-status-info/30 bg-status-info-bg text-status-info",
        accent: "border-accent/30 bg-accent-subtle text-accent-text",
        outline: "border-border bg-transparent text-text-secondary",
      },
      mono: {
        true: "font-mono tracking-tight",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      mono: false,
    },
  }
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
}

export function Badge({ className, variant, mono, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, mono }), className)} {...props}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

const iconCls = "h-3 w-3 shrink-0";

/* ------------------------------------------------------------------ */
/* Claim verification status                                           */
/* ------------------------------------------------------------------ */

export const CLAIM_STATUS_META: Record<
  string,
  { label: string; variant: BadgeVariant; icon: React.ComponentType<{ className?: string }>; description: string }
> = {
  SUPPORTED: {
    label: "Supported",
    variant: "verified",
    icon: CheckCircle2,
    description: "Deterministic predicate matched stored evidence",
  },
  VERIFIED: {
    label: "Supported",
    variant: "verified",
    icon: CheckCircle2,
    description: "Deterministic predicate matched stored evidence",
  },
  CONTRADICTED: {
    label: "Contradicted",
    variant: "danger",
    icon: XCircle,
    description: "Stored evidence is incompatible with the claim",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient evidence",
    variant: "warning",
    icon: AlertTriangle,
    description: "No matching or conclusive records found",
  },
  REQUIRES_HUMAN_JUDGMENT: {
    label: "Human review",
    variant: "human",
    icon: UserCheck,
    description: "Cannot be decided deterministically",
  },
  UNVERIFIED: {
    label: "Unverified",
    variant: "neutral",
    icon: HelpCircle,
    description: "Extracted, awaiting deterministic verification",
  },
};

/**
 * Pre-configured status badge for claim verification status.
 * Status is always conveyed by icon + text, never color alone.
 */
export function ClaimStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = CLAIM_STATUS_META[status] ?? CLAIM_STATUS_META.UNVERIFIED;
  const Icon = meta.icon;
  return (
    <Badge
      variant={meta.variant}
      className={className}
      icon={<Icon className={iconCls} aria-hidden="true" />}
      title={meta.description}
    >
      {meta.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence parser status                                              */
/* ------------------------------------------------------------------ */

export function ParserStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PARSED":
      return (
        <Badge variant="verified" icon={<CheckCircle2 className={iconCls} aria-hidden="true" />}>
          Parsed
        </Badge>
      );
    case "PARTIAL":
      return (
        <Badge variant="warning" icon={<AlertTriangle className={iconCls} aria-hidden="true" />}>
          Partial
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge variant="info" icon={<Loader2 className={cn(iconCls, "animate-spin")} aria-hidden="true" />}>
          Processing
        </Badge>
      );
    case "UNSUPPORTED":
      return (
        <Badge variant="neutral" icon={<HelpCircle className={iconCls} aria-hidden="true" />}>
          Unsupported
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="danger" icon={<XCircle className={iconCls} aria-hidden="true" />}>
          Failed
        </Badge>
      );
    case "PENDING":
    default:
      return (
        <Badge variant="neutral" icon={<Clock className={iconCls} aria-hidden="true" />}>
          Pending
        </Badge>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Event severity                                                      */
/* ------------------------------------------------------------------ */

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const s = (severity || "").toUpperCase();
  if (s === "CRITICAL") {
    return (
      <Badge variant="danger" icon={<XCircle className={iconCls} aria-hidden="true" />}>
        Critical
      </Badge>
    );
  }
  if (s === "WARNING") {
    return (
      <Badge variant="warning" icon={<AlertTriangle className={iconCls} aria-hidden="true" />}>
        Warning
      </Badge>
    );
  }
  if (s === "INFO") {
    return (
      <Badge variant="outline" icon={<Info className={iconCls} aria-hidden="true" />}>
        Info
      </Badge>
    );
  }
  return <Badge variant="outline">{severity || "—"}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Case status                                                         */
/* ------------------------------------------------------------------ */

export function CaseStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "OPEN":
      return (
        <Badge variant="accent" icon={<CircleDot className={iconCls} aria-hidden="true" />}>
          Open
        </Badge>
      );
    case "CLOSED":
      return (
        <Badge variant="neutral" icon={<Lock className={iconCls} aria-hidden="true" />}>
          Closed
        </Badge>
      );
    case "ARCHIVED":
      return (
        <Badge variant="outline" icon={<Archive className={iconCls} aria-hidden="true" />}>
          Archived
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
