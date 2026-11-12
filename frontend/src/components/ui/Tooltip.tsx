import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * Lightweight tooltip shown on hover and keyboard focus.
 * The trigger is linked with aria-describedby so screen readers announce it.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = React.cloneElement(children, {
    "aria-describedby": open ? id : undefined,
  });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 z-toast w-max max-w-[260px] -translate-x-1/2 animate-fade-in rounded border border-border bg-surface-raised px-2 py-1 text-2xs leading-4 text-text-secondary shadow-overlay",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
