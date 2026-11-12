import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({
  message = "Loading forensic data…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center gap-2.5 px-6 py-10 text-center", className)}
    >
      <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
      <span className="text-xs text-text-muted">{message}</span>
    </div>
  );
}
