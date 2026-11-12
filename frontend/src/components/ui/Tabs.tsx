import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab list */
  label: string;
  /** Prefix used to link tabs to panels: `${idPrefix}-tab-${id}` / `${idPrefix}-panel-${id}` */
  idPrefix: string;
  className?: string;
}

/**
 * Underlined tab list with roving focus (Arrow keys / Home / End).
 * Pair each tab with <TabPanel idPrefix id> for correct ARIA wiring.
 */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix, className }: TabsProps<T>) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const enabled = items.filter((i) => !i.disabled);
    const current = enabled.findIndex((i) => i.id === items[index].id);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (current + 1) % enabled.length;
    if (e.key === "ArrowLeft") next = (current - 1 + enabled.length) % enabled.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = enabled.length - 1;
    if (next !== null) {
      e.preventDefault();
      const target = enabled[next];
      onChange(target.id);
      refs.current[target.id]?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={label} className={cn("flex items-center gap-1 overflow-x-auto px-3", className)}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              "disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {item.icon && <span aria-hidden="true" className="[&_svg]:h-3.5 [&_svg]:w-3.5">{item.icon}</span>}
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "rounded-sm px-1 font-mono text-2xs",
                  selected ? "bg-accent-subtle text-accent-text" : "bg-surface-muted text-text-muted"
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  id,
  className,
  children,
}: {
  idPrefix: string;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control — compact single-choice filter                    */
/* ------------------------------------------------------------------ */

export interface SegmentOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "xs" | "sm";
  className?: string;
  mono?: boolean;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  className,
  mono = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex max-w-full flex-wrap items-center gap-0.5 rounded border border-border bg-surface-subtle p-0.5", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm font-medium transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              size === "xs" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
              mono && "font-mono",
              active
                ? "bg-surface-raised text-text-primary shadow-sm ring-1 ring-border-strong"
                : "text-text-muted hover:text-text-primary"
            )}
          >
            {opt.icon && <span aria-hidden="true" className="[&_svg]:h-3 [&_svg]:w-3">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
