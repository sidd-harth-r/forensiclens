import { isApiMode, API_BASE_URL } from "@/services/apiClient";
import { Zap, Database } from "lucide-react";

export function DataModeBadge() {
  if (isApiMode) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
        title={`Live API connected to ${API_BASE_URL || "local backend"}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <Zap className="w-3 h-3 text-emerald-500" />
        <span>LIVE API</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
      title="Running in mock fixture mode (VITE_DATA_MODE=fixtures)"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      <Database className="w-3 h-3 text-amber-500" />
      <span>FIXTURE MODE</span>
    </div>
  );
}

