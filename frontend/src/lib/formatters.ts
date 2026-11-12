/**
 * Human-readable message for a failed request. Aborted requests (client-side
 * timeout) otherwise surface as the browser's opaque "signal is aborted" text.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "The backend did not respond in time. It may still be loading local models — retry in a moment.";
  }
  if (err instanceof Error && /aborted/i.test(err.message) && err.name !== "ApiError") {
    return "The backend did not respond in time. It may still be loading local models — retry in a moment.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Format bytes into human-readable strings (e.g. 1.2 MB).
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Truncate a SHA-256 hash for compact presentation with full copy tooltip.
 */
export function formatHash(hash: string, leading: number = 8, trailing: number = 8): string {
  if (!hash || hash.length <= leading + trailing) return hash;
  return `${hash.slice(0, leading)}...${hash.slice(-trailing)}`;
}

/**
 * Matches ISO-8601 date-times (YYYY-MM-DD with optional time / offset).
 * Only these are safe to normalize: the JS Date parser will otherwise
 * "complete" partial forensic timestamps such as syslog's "Nov  2 10:31:02"
 * with an invented year and the viewer's local timezone.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function isIsoTimestamp(value: string | null | undefined): value is string {
  return !!value && ISO_8601.test(value.trim());
}

/**
 * Format timestamp into standard readable forensic presentation (UTC).
 * Non-ISO values are returned verbatim — never re-interpreted.
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  if (!isIsoTimestamp(isoString)) return isoString;
  try {
    const v = isoString.trim();
    // ISO values without an explicit offset are UTC in the backend; don't let
    // the browser reinterpret them in the viewer's local timezone.
    const hasTime = /\d{2}:\d{2}/.test(v);
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
    const d = new Date(hasTime && !hasOffset ? `${v.replace(" ", "T")}Z` : v);
    if (isNaN(d.getTime())) return isoString;
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return isoString;
  }
}

