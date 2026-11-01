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
 * Format timestamp into standard readable forensic presentation.
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return isoString;
  }
}

