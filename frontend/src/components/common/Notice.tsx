import React from "react";
import { AlertTriangle, FlaskConical, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type NoticeTone = "info" | "warning" | "danger" | "preview";

const toneStyles: Record<NoticeTone, { box: string; icon: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { box: "border-status-info/30 bg-status-info-bg", icon: "text-status-info", Icon: Info },
  warning: { box: "border-status-warning/30 bg-status-warning-bg", icon: "text-status-warning", Icon: AlertTriangle },
  danger: { box: "border-status-danger/30 bg-status-danger-bg", icon: "text-status-danger", Icon: ShieldAlert },
  preview: { box: "border-status-warning/30 bg-status-warning-bg", icon: "text-status-warning", Icon: FlaskConical },
};

/**
 * Inline callout for policies, warnings and module-state disclosures.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  icon,
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  const t = toneStyles[tone];
  const Icon = t.Icon;
  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3 rounded border px-3 py-2.5", t.box, className)}
      role={tone === "danger" ? "alert" : "note"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className={cn("mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4", t.icon)} aria-hidden="true">
          {icon ?? <Icon />}
        </span>
        <div className="min-w-0 space-y-0.5 text-xs leading-relaxed text-text-secondary">
          {title && <p className="font-semibold text-text-primary">{title}</p>}
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Disclosure for modules that have no backend implementation yet.
 * Rendered at the top of every fixture-only page regardless of data mode.
 */
export function PreviewModuleNotice({ module }: { module: string }) {
  return (
    <Notice tone="preview" title={`${module} is a design preview`}>
      This module has no backend endpoint yet. Everything shown here is sample fixture data bundled with the
      frontend — it is not derived from your case evidence and must not be cited. Controls that would change
      state are disabled until the module is implemented.
    </Notice>
  );
}
