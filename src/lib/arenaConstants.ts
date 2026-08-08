/**
 * Shared constants for the Arena cloud-inference timeout.
 * Used by both the client (ArenaPanel) and the server (arena.ts) so the
 * reported timeout always matches the one actually enforced.
 */

export const ARENA_CLOUD_TIMEOUT_MS = 30_000;
export const ARENA_CLOUD_TIMEOUT_MIN_MS = 1_000;
export const ARENA_CLOUD_TIMEOUT_MAX_MS = 120_000;

/** Max characters accepted for Arena cloud `prompt` (route-level bound). */
export const ARENA_PROMPT_MAX_CHARS = 32_000;

/**
 * Clamps an arbitrary value into a valid cloud-inference timeout.
 * Non-number / non-finite input falls back to the default — never returns
 * `0` or a non-finite value, and never throws.
 *
 * Uses explicit comparison assignment (not only Math.min/max) so call sites
 * that re-apply the same bounds remain clear to static analyzers.
 */
export function resolveCloudTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return ARENA_CLOUD_TIMEOUT_MS;
  let ms = raw;
  if (ms > ARENA_CLOUD_TIMEOUT_MAX_MS) ms = ARENA_CLOUD_TIMEOUT_MAX_MS;
  if (ms < ARENA_CLOUD_TIMEOUT_MIN_MS) ms = ARENA_CLOUD_TIMEOUT_MIN_MS;
  return ms;
}
