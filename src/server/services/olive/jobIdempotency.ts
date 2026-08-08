/**
 * Idempotency index for optimization job submissions.
 * Keys are client idempotency keys and/or recipe fingerprints.
 */
import { jobRegistry } from "./state.ts";
import type { OliveJob } from "../../types.ts";

const keyToJobId = new Map<string, string>();

export function rememberIdempotencyKeys(job: OliveJob): void {
  if (job.idempotencyKey) keyToJobId.set(`key:${job.idempotencyKey}`, job.id);
  if (job.fingerprint) keyToJobId.set(`fp:${job.fingerprint}`, job.id);
}

export function findJobByIdempotency(opts: {
  idempotencyKey?: string;
  fingerprint?: string;
}): OliveJob | undefined {
  const candidates: string[] = [];
  if (opts.idempotencyKey) candidates.push(`key:${opts.idempotencyKey}`);
  if (opts.fingerprint) candidates.push(`fp:${opts.fingerprint}`);

  for (const k of candidates) {
    const id = keyToJobId.get(k);
    if (!id) continue;
    const job = jobRegistry.get(id);
    if (!job) {
      keyToJobId.delete(k);
      continue;
    }
    return job;
  }
  return undefined;
}

/** Test helper */
export function clearIdempotencyIndex(): void {
  keyToJobId.clear();
}
