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
    const job = makeJob("j1", { fingerprint: "fp1", idempotencyKey: "k1", source: "mcp" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(findJobByIdempotency({ fingerprint: "fp1" })).toEqual({ kind: "hit", job });
    expect(findJobByIdempotency({ idempotencyKey: "k1" })).toEqual({ kind: "hit", job });
  });

  it("drops stale keys when job left registry", () => {
    const job = makeJob("j2", { fingerprint: "fp2", source: "mcp" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    jobRegistry.delete("j2");
    expect(findJobByIdempotency({ fingerprint: "fp2" })).toEqual({ kind: "miss" });
  });

  it("returns conflict when key maps to a different fingerprint", () => {
    const job = makeJob("j3", { fingerprint: "fp-a", idempotencyKey: "shared-key", source: "mcp" });
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
    const job = makeJob("j4", { fingerprint: "fp-same", idempotencyKey: "k-same", source: "mcp" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(
      findJobByIdempotency({ idempotencyKey: "k-same", fingerprint: "fp-same" }),
    ).toEqual({ kind: "hit", job });
  });

  it("reuses by key alone when fingerprint is omitted", () => {
    const job = makeJob("j5", { fingerprint: "fp-only", idempotencyKey: "k-only", source: "mcp" });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(findJobByIdempotency({ idempotencyKey: "k-only" })).toEqual({ kind: "hit", job });
  });

  it("does not index UI jobs; MCP cannot absorb a matching UI fingerprint", () => {
    const ui = makeJob("ui-1", { fingerprint: "fp-shared", source: "ui" });
    jobRegistry.set(ui.id, ui);
    rememberIdempotencyKeys(ui);
    expect(findJobByIdempotency({ fingerprint: "fp-shared" })).toEqual({ kind: "miss" });

    // Later MCP job with same fingerprint is the only reusable entry.
    const mcp = makeJob("mcp-1", { fingerprint: "fp-shared", source: "mcp", idempotencyKey: "k" });
    jobRegistry.set(mcp.id, mcp);
    rememberIdempotencyKeys(mcp);
    expect(findJobByIdempotency({ fingerprint: "fp-shared" })).toEqual({ kind: "hit", job: mcp });
  });

  it("does not fall back to fingerprint when an explicit new key misses", () => {
    const job = makeJob("j-old", {
      fingerprint: "fp-rerun",
      idempotencyKey: "old-key",
      source: "mcp",
      status: "completed",
    });
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(
      findJobByIdempotency({ idempotencyKey: "new-key", fingerprint: "fp-rerun" }),
    ).toEqual({ kind: "miss" });
  });

  it("ignores default/undefined source as non-MCP", () => {
    const job = makeJob("j-ui-default", { fingerprint: "fp-ui" }); // no source
    jobRegistry.set(job.id, job);
    rememberIdempotencyKeys(job);
    expect(findJobByIdempotency({ fingerprint: "fp-ui" })).toEqual({ kind: "miss" });
  });
});
