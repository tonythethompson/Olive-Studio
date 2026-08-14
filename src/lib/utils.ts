import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a byte count into a human-readable string (e.g. "1.5 GB").
 * Handles edge cases: 0, negative, and non-finite values.
 * @param bytes The byte count to format.
 * @param decimals Optional fixed decimal places; defaults to 0 for B/KB and 1 for MB+.
 */
export function formatBytes(bytes: number, decimals?: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const rawIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const i = Math.min(Math.max(0, rawIndex), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  const fixed = decimals ?? (i > 1 ? 1 : 0);
  return `${size.toFixed(fixed)} ${units[i]}`;
}
