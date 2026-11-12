import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium select-none",
    "transition-colors duration-150 cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Primary action — one per view region */
        default:
          "bg-accent-solid text-accent-on hover:bg-accent-hover active:bg-accent-active shadow-xs",
        primary:
          "bg-accent-solid text-accent-on hover:bg-accent-hover active:bg-accent-active shadow-xs",
        secondary:
          "bg-surface-muted text-text-primary border border-border hover:bg-surface-raised hover:border-border-strong",
        outline:
          "border border-border bg-transparent text-text-primary hover:bg-surface-subtle hover:border-border-strong",
        ghost: "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
        destructive:
          "bg-status-danger text-white hover:bg-status-danger/90 active:bg-status-danger/80",
        "destructive-outline":
          "border border-status-danger/40 text-status-danger hover:bg-status-danger-bg",
        subtle: "bg-accent-subtle text-accent-text hover:bg-accent/20",
        link: "text-accent-text underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        xs: "h-6 px-2 text-2xs",
        sm: "h-7 px-2.5 text-xs",
        default: "h-8 px-3 text-xs",
        lg: "h-9 px-4 text-sm",
        icon: "h-8 w-8 text-xs",
        "icon-sm": "h-7 w-7 text-xs",
        "icon-xs": "h-6 w-6 text-2xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button while an operation is pending */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, asChild: _asChild, disabled, children, type, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export interface LinkButtonProps
  extends Omit<LinkProps, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

/**
 * Router link styled as a button. Use instead of nesting <Button> inside <Link>,
 * which produces invalid nested interactive elements.
 */
export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <Link ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
LinkButton.displayName = "LinkButton";
