import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Flat bordered panel. Cards are used to group a region of the workspace,
 * not as decoration — keep nesting to one level.
 */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-md border border-border bg-surface text-text-primary", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-0.5 border-b border-border-subtle px-4 py-3", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-sm font-semibold leading-5 text-text-primary", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-xs text-text-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4", className)} {...props} />
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center border-t border-border-subtle px-4 py-2.5", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

/**
 * Panel: a Card with a standard title row (icon, title, description, actions).
 */
interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** Remove body padding (for tables / lists that run edge to edge) */
  flush?: boolean;
  bodyClassName?: string;
  headingLevel?: "h2" | "h3";
}

export function Panel({
  title,
  description,
  icon,
  actions,
  flush = false,
  className,
  bodyClassName,
  headingLevel = "h2",
  children,
  ...props
}: PanelProps) {
  const Heading = headingLevel;
  return (
    <section className={cn("rounded-md border border-border bg-surface", className)} {...props}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <span className="text-text-muted [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{icon}</span>}
            <div className="min-w-0">
              {title && (
                <Heading className="truncate text-sm font-semibold leading-5 text-text-primary">{title}</Heading>
              )}
              {description && <p className="text-xs text-text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
