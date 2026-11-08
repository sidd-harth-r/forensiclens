import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, UserCheck, Loader2, Clock } from "lucide-react";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors border",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-subtle text-text-primary",
        verified: "border-emerald-300 dark:border-emerald-800 bg-status-success-bg text-status-success font-semibold",
        warning: "border-amber-300 dark:border-amber-800 bg-status-warning-bg text-status-warning font-semibold",
        danger: "border-red-300 dark:border-red-800 bg-status-danger-bg text-status-danger font-semibold",
        neutral: "border-border bg-status-neutral-bg text-status-neutral",
        human: "border-purple-300 dark:border-purple-800 bg-status-human-bg text-status-human font-semibold",
        accent: "border-indigo-300 dark:border-indigo-800 bg-accent-subtle text-accent-text font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
}

export function Badge({ className, variant, icon, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

/**
 * Pre-configured status badge for claim verification status.
 */
export function ClaimStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "SUPPORTED":
    case "VERIFIED":
      return (
        <Badge variant="verified" icon={<CheckCircle2 className="w-3 h-3 text-status-success" aria-hidden="true" />}>
          SUPPORTED
        </Badge>
      );
    case "CONTRADICTED":
      return (
        <Badge variant="danger" icon={<XCircle className="w-3 h-3 text-status-danger" aria-hidden="true" />}>
          CONTRADICTED
        </Badge>
      );
    case "INSUFFICIENT_EVIDENCE":
      return (
        <Badge variant="warning" icon={<AlertTriangle className="w-3 h-3 text-status-warning" aria-hidden="true" />}>
          INSUFFICIENT EVIDENCE
        </Badge>
      );
    case "REQUIRES_HUMAN_JUDGMENT":
      return (
        <Badge variant="human" icon={<UserCheck className="w-3 h-3 text-status-human" aria-hidden="true" />}>
          HUMAN REVIEW
        </Badge>
      );
    case "UNVERIFIED":
    default:
      return (
        <Badge variant="neutral" icon={<HelpCircle className="w-3 h-3 text-status-neutral" aria-hidden="true" />}>
          UNVERIFIED
        </Badge>
      );
  }
}

/**
 * Pre-configured status badge for evidence parser status.
 */
export function ParserStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PARSED":
      return (
        <Badge variant="verified" icon={<CheckCircle2 className="w-3 h-3 text-status-success" aria-hidden="true" />}>
          PARSED
        </Badge>
      );
    case "PARTIAL":
      return (
        <Badge variant="warning" icon={<AlertTriangle className="w-3 h-3 text-status-warning" aria-hidden="true" />}>
          PARTIAL
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge variant="accent" icon={<Loader2 className="w-3 h-3 text-accent animate-spin" aria-hidden="true" />}>
          PROCESSING
        </Badge>
      );
    case "UNSUPPORTED":
      return (
        <Badge variant="neutral" icon={<HelpCircle className="w-3 h-3 text-text-muted" aria-hidden="true" />}>
          UNSUPPORTED
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="danger" icon={<XCircle className="w-3 h-3 text-status-danger" aria-hidden="true" />}>
          FAILED
        </Badge>
      );
    case "PENDING":
    default:
      return (
        <Badge variant="neutral" icon={<Clock className="w-3 h-3 text-text-muted" aria-hidden="true" />}>
          PENDING
        </Badge>
      );
  }
}
