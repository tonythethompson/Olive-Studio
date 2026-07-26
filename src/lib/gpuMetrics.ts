export interface GpuMetricSample {
  index: number;
  name: string;
  utilizationPct: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  tempC: number | null;
  powerW: number | null;
}

export interface GpuMetrics {
  timestamp: string;
  gpus: GpuMetricSample[];
}

/**
 * Formats a memory size as MiB or GiB.
 *
 * @param mb - The memory size in MiB, or `null` when unavailable
 * @returns The formatted memory size, or `"—"` when unavailable
 */
export function formatMb(mb: number | null): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${Math.round(mb)} MiB`;
}

/**
 * Formats a percentage value for display.
 *
 * @param pct - The percentage value, or `null` when unavailable
 * @returns The rounded percentage with a `%` suffix, or `"—"` when unavailable
 */
export function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

/**
 * Formats a temperature reading for display.
 *
 * @param c - The temperature in degrees Celsius
 * @returns The rounded temperature with a Celsius unit, or `"—"` when unavailable
 */
export function formatTemp(c: number | null): string {
  if (c == null) return "—";
  return `${Math.round(c)}°C`;
}

/**
 * Formats a power measurement for display.
 *
 * @param w - The power measurement in watts, or `null` when unavailable
 * @returns The measurement rounded to one decimal place with a `W` suffix, or `"—"` when unavailable
 */
export function formatPower(w: number | null): string {
  if (w == null) return "—";
  return `${w.toFixed(1)}W`;
}

/**
 * Formats memory usage as a percentage.
 *
 * @param used - The used memory amount
 * @param total - The total memory amount
 * @returns The rounded usage percentage, or `"—"` when either value is unavailable or the total is zero
 */
export function formatMemPct(used: number | null, total: number | null): string {
  if (used == null || total == null || total === 0) return "—";
  return `${Math.round((used / total) * 100)}%`;
}
