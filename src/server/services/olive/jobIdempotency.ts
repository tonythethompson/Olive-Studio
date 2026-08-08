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
 */
import { jobRegistry } from "./state.ts";
import type { OliveJob } from "../../types.ts";

const keyToJobId = new Map<string, string>();

export type IdempotencyLookup =
  | { kind: "hit"; job: OliveJob }
  | { kind: "conflict"; job: OliveJob; reason: string }
  | { kind: "miss" };

function isMcpJob(job: OliveJob): boolean {
  return job.source === "mcp";
}

export function rememberIdempotencyKeys(job: OliveJob): void {
  // UI jobs are intentionally excluded from agent idempotency reuse.
  if (!isMcpJob(job)) return;
  if (job.idempotencyKey) keyToJobId.set(`key:${job.idempotencyKey}`, job.id);
  if (job.fingerprint) keyToJobId.set(`fp:${job.fingerprint}`, job.id);
}

function resolveJobForIndexKey(indexKey: string): OliveJob | undefined {
  const id = keyToJobId.get(indexKey);
  if (!id) return undefined;
  const job = jobRegistry.get(id);
  if (!job || !isMcpJob(job)) {
    keyToJobId.delete(indexKey);
    return undefined;
  }
  return job;
}

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
  }

  if (opts.fingerprint) {
    const byFp = resolveJobForIndexKey(`fp:${opts.fingerprint}`);
    if (byFp) return { kind: "hit", job: byFp };
  }

  return { kind: "miss" };
}

/** Test helper */
export function clearIdempotencyIndex(): void {
  keyToJobId.clear();
}
