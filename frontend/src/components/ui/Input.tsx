import * as React from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const controlBase = [
  "w-full rounded border border-border bg-surface-subtle text-sm text-text-primary",
  "placeholder:text-text-disabled transition-colors duration-150",
  "hover:border-border-strong",
  "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-status-danger aria-[invalid=true]:focus-visible:ring-status-danger",
].join(" ");

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, ...props }, ref) => {
    if (icon) {
      return (
        <div className="relative flex w-full items-center">
          <span className="pointer-events-none absolute left-2.5 flex items-center text-text-muted [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden="true">
            {icon}
          </span>
          <input
            type={type}
            ref={ref}
            className={cn(controlBase, "h-8 pl-8 pr-3", className)}
            {...props}
          />
        </div>
      );
    }
    return <input type={type} ref={ref} className={cn(controlBase, "h-8 px-2.5", className)} {...props} />;
  }
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlBase, "min-h-[72px] resize-y px-2.5 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes for the positioning wrapper (width, margins) */
  wrapperClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(controlBase, "h-8 cursor-pointer appearance-none pl-2.5 pr-8", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
    </div>
  )
);
Select.displayName = "Select";

/**
 * Search input with leading icon and clear button.
 */
interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
}

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ value, onValueChange, label, className, ...props }, ref) => (
    <div className={cn("relative flex w-full items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(controlBase, "h-8 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden")}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text-primary"
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
);
SearchField.displayName = "SearchField";

/**
 * Field: label + control + hint/error, wired with ids for accessibility.
 */
interface FieldProps {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">
        {label}
        {required && (
          <span className="ml-0.5 text-status-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-2xs text-status-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-2xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
