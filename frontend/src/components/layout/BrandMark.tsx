import { cn } from "@/lib/utils";

/**
 * ForensicLens mark: a lens over a hash grid — evidence examined under integrity.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/40 bg-accent-subtle text-accent",
        className
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 7h7M3 11h4M7 3v8" strokeLinecap="round" opacity="0.55" />
        <circle cx="11.5" cy="10.5" r="4.25" />
        <path d="M14.6 13.6 17.5 16.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
