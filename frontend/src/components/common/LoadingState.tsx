import { Loader2 } from "lucide-react";

export function LoadingState({ message = "Loading forensic data..." }: { message?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center p-12 text-center"
    >
      <Loader2 className="w-6 h-6 animate-spin text-accent mb-3" />
      <span className="text-xs font-medium text-text-muted">{message}</span>
      <span className="sr-only">Loading</span>
    </div>
  );
}

