import { afterEach, describe, expect, it } from "vitest";
import { clearIdempotencyIndex, findJobByIdempotency, rememberIdempotencyKeys } from "./jobIdempotency.ts";
import { jobRegistry } from "./state.ts";
import type { OliveJob } from "../../types.ts";

function makeJob(id: string, extra: Partial<OliveJob> = {}): OliveJob {
  return {
    id,
    status: "running",
    exitCode: null,
    logs: [],
    subscribers: [],
    metricSubscribers: [],
    process: null,
    latestMetrics: null,
    metricsTimer: null,
    sampling: false,
    tempRecipePath: null,
    finishedAt: null,
    doneSubscribers: [],
    ...extra,
  };
}

afterEach(() => {
  jobRegistry.clear();
  clearIdempotencyIndex();
});

describe("jobIdempotency", () => {
  it("finds job by fingerprint and key", () => {
    const job = makeJob("j1", { fingerprint: "fp1", idempotencyKey: "k1" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(findJobByIdempotency({ fingerprint: "fp1" })).toEqual({ kind: "hit", job });
    expect(findJobByIdempotency({ idempotencyKey: "k1" })).toEqual({ kind: "hit", job });
  });

  it("drops stale keys when job left registry", () => {
    const job = makeJob("j2", { fingerprint: "fp2" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    jobRegistry.delete("j2");
    expect(findJobByIdempotency({ fingerprint: "fp2" })).toEqual({ kind: "miss" });
  });

  it("returns conflict when key maps to a different fingerprint", () => {
    const job = makeJob("j3", { fingerprint: "fp-a", idempotencyKey: "shared-key" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    const result = findJobByIdempotency({
      idempotencyKey: "shared-key",
      fingerprint: "fp-b",
    });
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.job.id).toBe("j3");
      expect(result.reason).toMatch(/fingerprint/i);
    }
  });

  it("reuses when key and fingerprint both match", () => {
    const job = makeJob("j4", { fingerprint: "fp-same", idempotencyKey: "k-same" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(
      findJobByIdempotency({ idempotencyKey: "k-same", fingerprint: "fp-same" }),
    ).toEqual({ kind: "hit", job });
  });

  it("reuses by key alone when fingerprint is omitted", () => {
    const job = makeJob("j5", { fingerprint: "fp-only", idempotencyKey: "k-only" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(findJobByIdempotency({ idempotencyKey: "k-only" })).toEqual({ kind: "hit", job });
  });
});
