import { describe, it, expect, beforeEach, vi } from "vitest";
import { jobRegistry, cleanupJobArtifacts, sweepJobRegistry, finalizeJob } from "./state.ts";
import type { OliveJob } from "../../types.ts";
import fs from "fs";
import os from "os";
import path from "path";

function makeJob(id: string, overrides: Partial<OliveJob> = {}): OliveJob {
  return {
    id,
    status: "completed",
    exitCode: 0,
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
    ...overrides,
  };
}

describe("olive job registry cleanup", () => {
  beforeEach(() => {
    jobRegistry.clear();
  });

  describe("sweepJobRegistry", () => {
    it("removes terminal jobs older than the TTL", () => {
      const now = 10_000_000_000;
      const oldMs = now - 31 * 60_000;
      jobRegistry.set("old", makeJob("old", { status: "completed", finishedAt: oldMs }));
      jobRegistry.set("recent", makeJob("recent", { status: "failed", finishedAt: now - 1_000 }));

      const removed = sweepJobRegistry(now);

      expect(removed).toBe(1);
      expect(jobRegistry.has("old")).toBe(false);
      expect(jobRegistry.has("recent")).toBe(true);
    });

    it("never removes running or setting_up jobs", () => {
      const now = 10_000_000_000;
      jobRegistry.set("running", makeJob("running", { status: "running", finishedAt: null }));
      jobRegistry.set("setup", makeJob("setup", { status: "setting_up", finishedAt: null }));

      expect(sweepJobRegistry(now)).toBe(0);
      expect(jobRegistry.size).toBe(2);
    });

    it("keeps terminal jobs with no finishedAt (defensive)", () => {
      jobRegistry.set("weird", makeJob("weird", { status: "cancelled", finishedAt: null }));
      expect(sweepJobRegistry(Date.now())).toBe(0);
      expect(jobRegistry.has("weird")).toBe(true);
    });
  });

  describe("cleanupJobArtifacts", () => {
    it("deletes the temp recipe file and clears the path", () => {
      const tmp = path.join(os.tmpdir(), `olive-state-test-${Date.now()}.json`);
      fs.writeFileSync(tmp, "{}", "utf-8");
      const job = makeJob("j", { tempRecipePath: tmp });

      cleanupJobArtifacts(job);

      expect(fs.existsSync(tmp)).toBe(false);
      expect(job.tempRecipePath).toBeNull();
    });

    it("is a no-op when there is no temp file", () => {
      const job = makeJob("j", { tempRecipePath: null });
      expect(() => cleanupJobArtifacts(job)).not.toThrow();
    });

    it("tolerates an already-deleted temp file", () => {
      const job = makeJob("j", { tempRecipePath: path.join(os.tmpdir(), "does-not-exist-xyz.json") });
      expect(() => cleanupJobArtifacts(job)).not.toThrow();
      expect(job.tempRecipePath).toBeNull();
    });
  });

  describe("finalizeJob", () => {
    it("stamps finishedAt once and fires done-subscribers", () => {
      const sub = vi.fn();
      const job = makeJob("j", { status: "completed", finishedAt: null, doneSubscribers: [sub] });

      finalizeJob(job);

      expect(job.finishedAt).toBeTypeOf("number");
      expect(sub).toHaveBeenCalledOnce();
      // Subscribers are drained so a second finalize won't double-notify.
      expect(job.doneSubscribers).toHaveLength(0);
    });

    it("does not overwrite an existing finishedAt", () => {
      const job = makeJob("j", { status: "cancelled", finishedAt: 123 });
      finalizeJob(job);
      expect(job.finishedAt).toBe(123);
    });

    it("swallows a throwing subscriber", () => {
      const bad = vi.fn(() => {
        throw new Error("gone");
      });
      const good = vi.fn();
      const job = makeJob("j", { doneSubscribers: [bad, good] });
      expect(() => finalizeJob(job)).not.toThrow();
      expect(good).toHaveBeenCalledOnce();
    });
  });
});
