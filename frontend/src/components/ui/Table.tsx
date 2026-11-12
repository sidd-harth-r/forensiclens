import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Dense data table. The wrapper scrolls horizontally so wide forensic tables
 * never push the page wider than the viewport.
 */
export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, ...props }, ref) => (
  <div className={cn("relative w-full overflow-x-auto", wrapperClassName)}>
    <table ref={ref} className={cn("w-full caption-bottom border-collapse text-left text-xs", className)} {...props} />
  </div>
));
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-surface-subtle [&_tr]:border-b [&_tr]:border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn("border-t border-border bg-surface-subtle font-medium", className)} {...props} />
));
TableFooter.displayName = "TableFooter";

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Highlights the row as the current selection */
  selected?: boolean;
  /**
   * Makes the whole row activatable by mouse and keyboard (Enter / Space).
   * Provide an accessible label describing the action.
   */
  onActivate?: () => void;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, selected, onActivate, onKeyDown, onClick, ...props }, ref) => (
    <tr
      ref={ref}
      data-state={selected ? "selected" : undefined}
      aria-current={selected ? "true" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (onActivate && !e.defaultPrevented) onActivate();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (onActivate && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "border-b border-border-subtle transition-colors duration-100",
        "hover:bg-surface-subtle",
        "data-[state=selected]:bg-accent-subtle data-[state=selected]:shadow-[inset_2px_0_0_0_rgb(var(--accent))]",
        onActivate &&
          "cursor-pointer focus-visible:outline-none focus-visible:bg-surface-subtle focus-visible:shadow-[inset_2px_0_0_0_rgb(var(--accent))]",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope, ...props }, ref) => (
    <th
      ref={ref}
      scope={scope ?? "col"}
      className={cn(
        "h-8 whitespace-nowrap px-3 text-left align-middle text-2xs font-medium uppercase tracking-[0.06em] text-text-muted",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-2 align-middle text-text-primary", className)} {...props} />
  )
);
TableCell.displayName = "TableCell";
