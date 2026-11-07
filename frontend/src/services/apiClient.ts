/**
 * ForensicLens Typed API Client.
 *
 * Provides centralized HTTP handling, query serialization, timeout enforcement,
 * and structured ApiError exceptions without external networking libraries.
 */

const env =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env
    : typeof process !== "undefined" && process.env
    ? (process.env as unknown as Record<string, string | undefined>)
    : {};

export const API_BASE_URL = (env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
export const DATA_MODE = env.VITE_DATA_MODE || "api";
export const isApiMode = DATA_MODE === "api";

/**
 * Resolves whether API mode is active, respecting an optional caller-level override.
 * Preserves the immutability of production `isApiMode` while enabling leak-free test isolation.
 */
export function resolveApiMode(override?: boolean): boolean {
  return typeof override === "boolean" ? override : isApiMode;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = API_BASE_URL ? `${API_BASE_URL}${cleanPath}` : cleanPath;

  if (!params) return base;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${base}?${queryString}` : base;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return {} as T;
  }

  const contentType = res.headers.get("content-type") || "";
  let data: unknown;

  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      message = typeof detail === "string" ? detail : JSON.stringify(detail);
    } else if (typeof data === "string" && data.trim()) {
      message = data;
    }
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

export const apiClient = {
  async get<T>(
    path: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = 15000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    try {
      const url = buildUrl(path, params);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      return await handleResponse<T>(res);
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  },

  async post<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs = 15000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    try {
      const url = buildUrl(path);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return await handleResponse<T>(res);
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  },

  async postFormData<T>(
    path: string,
    formData: FormData,
    signal?: AbortSignal,
    timeoutMs = 30000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    try {
      const url = buildUrl(path);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
        signal: controller.signal,
      });
      return await handleResponse<T>(res);
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  },
};
