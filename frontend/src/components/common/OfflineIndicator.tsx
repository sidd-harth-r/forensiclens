import { ShieldCheck, WifiOff } from "lucide-react";

export function OfflineIndicator() {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-subtle border border-border text-[11px] font-medium text-text-secondary select-none"
      title="Air-gapped local execution: zero cloud network telemetry"
    >
      <ShieldCheck className="w-3.5 h-3.5 text-status-success" aria-hidden="true" />
      <span>Air-gapped (Local)</span>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
    </div>
  );
}

export function FixtureModeBadge() {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800 bg-status-warning-bg text-status-warning text-[10px] font-semibold uppercase tracking-wider"
      title="UI Foundation mode: Mock fixture data displayed until backend API integration"
    >
      <WifiOff className="w-3 h-3" aria-hidden="true" />
      <span>Fixture Mode</span>
    </div>
  );
}

