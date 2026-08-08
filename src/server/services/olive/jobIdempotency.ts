/**
 * Idempotency index for optimization job submissions.
 * Keys are client idempotency keys and/or recipe fingerprints.
 *
 * Scope: **MCP-origin jobs only**. UI runs share the process registry but must
 * never be inserted into (or returned from) this index — otherwise an agent
 * submit with a matching fingerprint can absorb an unrelated Studio UI run.
 *
 * Lookup rules (HTTP idempotency semantics):
 * - Key only: reuse the prior MCP job for that key.
 * - Fingerprint only: reuse an MCP job with that recipe fingerprint.
 * - Key + fingerprint: key wins; if the stored job has a different fingerprint,
 *   treat as conflict (caller should return 409) — never reuse the wrong job.
 * - Key miss + fingerprint that maps to a fingerprint-only job: hit (adopt).
 * - Key miss + fingerprint owned by a different keyed job: miss (new run).
 * - Failed/cancelled indexed jobs are treated as a miss so agents can retry.
 */
import { jobRegistry } from "./state.ts";
import type { OliveJob } from "../../types.ts";

const keyToJobId = new Map<string, string>();

/** Terminal statuses that should not block a new idempotent submit. */
const RETRYABLE_TERMINAL = new Set<OliveJob["status"]>(["failed", "cancelled"]);

export type IdempotencyLookup =
  | { kind: "hit"; job: OliveJob }
  | { kind: "conflict"; job: OliveJob; reason: string }
  | { kind: "miss" };

/**
 * Determines whether a job originated from MCP.
 *
 * @param job - The job to inspect
 * @returns `true` if the job source is `"mcp"`, `false` otherwise.
 */
function isMcpJob(job: OliveJob): boolean {
  return job.source === "mcp";
}

/**
 * Indexes an MCP job for reuse by its idempotency key and recipe fingerprint.
 *
 * @param job - The job to index; jobs from other sources are ignored.
 */
export function rememberIdempotencyKeys(job: OliveJob): void {
  // UI jobs are intentionally excluded from agent idempotency reuse.
  if (!isMcpJob(job)) return;
  if (job.idempotencyKey) keyToJobId.set(`key:${job.idempotencyKey}`, job.id);
  if (job.fingerprint) keyToJobId.set(`fp:${job.fingerprint}`, job.id);
}

/**
 * Removes all index entries that point at the given job id (sweep / eviction).
 */
export function forgetIdempotencyKeysForJobId(jobId: string): void {
  for (const [indexKey, id] of keyToJobId) {
    if (id === jobId) keyToJobId.delete(indexKey);
  }
}

/**
 * Drops index entries whose jobs are gone or no longer MCP-scoped.
 *
 * @returns Number of entries removed
 */
export function pruneIdempotencyIndex(): number {
  let removed = 0;
  for (const [indexKey, id] of [...keyToJobId.entries()]) {
    const job = jobRegistry.get(id);
    if (!job || !isMcpJob(job)) {
      keyToJobId.delete(indexKey);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Resolves an indexed MCP job by its idempotency index key.
 *
 * @param indexKey - The key used to locate the job
 * @returns The matching MCP job, or `undefined` when no valid indexed job exists
 */
function resolveJobForIndexKey(indexKey: string): OliveJob | undefined {
  const id = keyToJobId.get(indexKey);
  if (!id) return undefined;
  const job = jobRegistry.get(id);
  if (!job || !isMcpJob(job)) {
    keyToJobId.delete(indexKey);
    return undefined;
  }
  // Failed/cancelled must not block retries with the same key/fingerprint.
  if (RETRYABLE_TERMINAL.has(job.status)) {
    keyToJobId.delete(indexKey);
    return undefined;
  }
  return job;
}

/**
 * Finds an MCP job using an idempotency key and recipe fingerprint.
 *
 * An idempotency key match with a different fingerprint produces a conflict.
 *
 * @param opts - Lookup values, including an optional client idempotency key and recipe fingerprint
 * @returns A hit with the matching job, a conflict when a key is reused with a different fingerprint, or a miss when no job matches
 */
export function findJobByIdempotency(opts: {
  idempotencyKey?: string;
  fingerprint?: string;
}): IdempotencyLookup {
  if (opts.idempotencyKey) {
    const byKey = resolveJobForIndexKey(`key:${opts.idempotencyKey}`);
    if (byKey) {
      if (
        opts.fingerprint &&
        byKey.fingerprint &&
        opts.fingerprint !== byKey.fingerprint
      ) {
        return {
          kind: "conflict",
          job: byKey,
          reason: "Idempotency key reused with a different recipe fingerprint",
        };
      }
      return { kind: "hit", job: byKey };
    }
    // Key miss: reuse a fingerprint-only MCP job (no attached key) so a later
    // keyed submit can adopt the in-flight admission. Do not reuse when the
    // fingerprint is already owned by a different keyed job — that keeps
    // sequential distinct-key behavior intact.
    if (opts.fingerprint) {
      const byFp = resolveJobForIndexKey(`fp:${opts.fingerprint}`);
      if (byFp && !byFp.idempotencyKey) {
        return { kind: "hit", job: byFp };
      }
    }
    return { kind: "miss" };
  }

  if (!opts.idempotencyKey && opts.fingerprint) {
    const byFp = resolveJobForIndexKey(`fp:${opts.fingerprint}`);
    if (byFp) return { kind: "hit", job: byFp };
  }

  return { kind: "miss" };
}

/** Test helper */
export function clearIdempotencyIndex(): void {
  keyToJobId.clear();
}

/** Test helper: current index size. */
export function idempotencyIndexSize(): number {
  return keyToJobId.size;
}
