import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 select-none text-xs",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-hover active:bg-accent-active shadow-sm",
        secondary: "bg-surface-subtle text-text-primary hover:bg-surface-muted border border-border",
        outline: "border border-border bg-transparent text-text-primary hover:bg-surface-subtle hover:border-border-strong",
        ghost: "text-text-secondary hover:bg-surface-subtle hover:text-text-primary",
        destructive: "bg-status-danger text-white hover:bg-red-700 active:bg-red-800",
        subtle: "bg-accent-subtle text-accent-text hover:bg-accent-subtle/80",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2.5 text-[11px]",
        lg: "h-9 px-4 text-sm",
        icon: "h-8 w-8",
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
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

