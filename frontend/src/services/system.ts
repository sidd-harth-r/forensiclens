import { FIXTURE_SYSTEM_STATUS } from "@/fixtures/system";
import { SystemStatus } from "@/types/system";
import { apiClient, isApiMode } from "@/services/apiClient";

/**
 * Fixture-only subsystem description. Not backed by a backend endpoint;
 * do not present its values as live measurements.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  return Promise.resolve({ ...FIXTURE_SYSTEM_STATUS });
}

export type BackendHealthState = "online" | "offline" | "fixture";

export interface BackendHealth {
  state: BackendHealthState;
  service?: string;
  checkedAt: string;
  error?: string;
}

/**
 * Probes the backend liveness endpoint (GET /health).
 * In fixture mode no request is made and the state is reported as "fixture".
 */
export async function getBackendHealth(signal?: AbortSignal): Promise<BackendHealth> {
  const checkedAt = new Date().toISOString();
  if (!isApiMode) {
    return { state: "fixture", checkedAt };
  }
  try {
    const res = await apiClient.get<{ status?: string; service?: string }>(
      "/health",
      undefined,
      signal,
      5000
    );
    return {
      state: res?.status === "ok" ? "online" : "offline",
      service: res?.service,
      checkedAt,
    };
  } catch (err) {
    return {
      state: "offline",
      checkedAt,
      error: err instanceof Error ? err.message : "Backend unreachable",
    };
  }
}
