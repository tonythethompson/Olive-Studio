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
    expect(findJobByIdempotency({ fingerprint: "fp1" })?.id).toBe("j1");
    expect(findJobByIdempotency({ idempotencyKey: "k1" })?.id).toBe("j1");
  });

  it("drops stale keys when job left registry", () => {
    const job = makeJob("j2", { fingerprint: "fp2" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    jobRegistry.delete("j2");
    expect(findJobByIdempotency({ fingerprint: "fp2" })).toBeUndefined();
  });
});
