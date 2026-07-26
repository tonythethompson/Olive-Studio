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

export function formatMb(mb: number | null): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${Math.round(mb)} MiB`;
}

export function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

export function formatTemp(c: number | null): string {
  if (c == null) return "—";
  return `${Math.round(c)}°C`;
}

export function formatPower(w: number | null): string {
  if (w == null) return "—";
  return `${w.toFixed(1)}W`;
}

export function formatMemPct(used: number | null, total: number | null): string {
  if (used == null || total == null || total === 0) return "—";
  return `${Math.round((used / total) * 100)}%`;
}
