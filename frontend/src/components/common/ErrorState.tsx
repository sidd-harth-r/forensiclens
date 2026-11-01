import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Failed to load data",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center p-8 text-center border border-red-200 dark:border-red-900/50 bg-status-danger-bg rounded-lg"
    >
      <div className="p-2.5 bg-red-100 dark:bg-red-950/80 rounded-full mb-3 text-status-danger">
        <AlertCircle className="w-5 h-5" aria-hidden="true" />
      </div>
      <h4 className="text-sm font-semibold text-status-danger">{title}</h4>
      <p className="text-xs text-text-secondary mt-1 max-w-md">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-4 border-red-300 dark:border-red-800 text-status-danger hover:bg-red-50 dark:hover:bg-red-950/50"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Retry Operation
        </Button>
      )}
    </div>
  );
}

