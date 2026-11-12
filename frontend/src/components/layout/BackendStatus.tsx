import { useCallback, useEffect, useState } from "react";
import { getBackendHealth, type BackendHealth } from "@/services/system";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

/**
 * Live backend reachability from GET /health. In fixture mode it states
 * that no backend is in use rather than implying a healthy connection.
 */
export function BackendStatus() {
  const [health, setHealth] = useState<BackendHealth | null>(null);

  const check = useCallback(async (signal?: AbortSignal) => {
    const res = await getBackendHealth(signal);
    if (!signal?.aborted) setHealth(res);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void check(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [check]);

  const state = health?.state;
  const meta =
    state === "online"
      ? { dot: "bg-status-success", text: "Backend online" }
      : state === "offline"
      ? { dot: "bg-status-danger", text: "Backend unreachable" }
      : state === "fixture"
      ? { dot: "bg-status-warning", text: "Fixture data" }
      : { dot: "bg-text-disabled", text: "Checking backend" };

  const title = health
    ? `${meta.text} — last checked ${formatDateTime(health.checkedAt)}${health.error ? ` (${health.error})` : ""}`
    : meta.text;

  return (
    <button
      type="button"
      onClick={() => void check()}
      className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      title={`${title}. Click to re-check.`}
      aria-label={`${meta.text}. Re-check backend status`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden="true" />
      <span className="hidden xl:inline">{meta.text}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {meta.text}
      </span>
    </button>
  );
}
