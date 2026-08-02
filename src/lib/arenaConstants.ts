/**
 * Shared constants for the Arena cloud-inference timeout.
 * Used by both the client (ArenaPanel) and the server (arena.ts) so the
 * reported timeout always matches the one actually enforced.
 */

export const ARENA_CLOUD_TIMEOUT_MS = 30_000;
export const ARENA_CLOUD_TIMEOUT_MIN_MS = 1_000;
export const ARENA_CLOUD_TIMEOUT_MAX_MS = 120_000;

/**
 * Clamps an arbitrary value into a valid cloud-inference timeout.
 * Non-number / non-finite input falls back to the default — never returns
 * `0` or a non-finite value, and never throws.
 */
export function resolveCloudTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return ARENA_CLOUD_TIMEOUT_MS;
  return Math.min(Math.max(raw, ARENA_CLOUD_TIMEOUT_MIN_MS), ARENA_CLOUD_TIMEOUT_MAX_MS);
}
