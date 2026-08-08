import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OliveJob } from "../../types.ts";
import fs from "fs";
import os from "os";
import path from "path";

const { detachVenvListener } = vi.hoisted(() => ({
  detachVenvListener: vi.fn(),
}));

vi.mock("../venv/index.ts", () => ({
  detachVenvListener: (...args: unknown[]) => detachVenvListener(...args),
}));

import { jobRegistry, cleanupJobArtifacts, sweepJobRegistry, finalizeJob, resetJobRegistry } from "./state.ts";
import {
  clearIdempotencyIndex,
  findJobByIdempotency,
  idempotencyIndexSize,
  rememberIdempotencyKeys,
} from "./jobIdempotency.ts";

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
    clearIdempotencyIndex();
    detachVenvListener.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearIdempotencyIndex();
    resetJobRegistry();
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

    it("clears idempotency index entries when sweeping MCP jobs", () => {
      const now = 10_000_000_000;
      const oldMs = now - 31 * 60_000;
      const job = makeJob("mcp-old", {
        status: "completed",
        finishedAt: oldMs,
        source: "mcp",
        fingerprint: "fp-old",
        idempotencyKey: "k-old",
      });
      jobRegistry.set(job.id, job);
      rememberIdempotencyKeys(job);
      expect(idempotencyIndexSize()).toBe(2);

      expect(sweepJobRegistry(now)).toBe(1);
      expect(idempotencyIndexSize()).toBe(0);
      expect(findJobByIdempotency({ fingerprint: "fp-old" })).toEqual({ kind: "miss" });
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

    it("does not evict a cancelled job whose process has not exited (avoids orphaning)", () => {
      const now = 10_000_000_000;
      const oldMs = now - 31 * 60_000;
      // SIGTERM ignored: still-running process (exitCode/signalCode both null).
      const liveProcess = { exitCode: null, signalCode: null } as unknown as NonNullable<OliveJob["process"]>;
      jobRegistry.set(
        "hung",
        makeJob("hung", { status: "cancelled", finishedAt: oldMs, process: liveProcess }),
      );

      expect(sweepJobRegistry(now)).toBe(0);
      expect(jobRegistry.has("hung")).toBe(true);
    });

    it("evicts a terminal job once its process has exited", () => {
      const now = 10_000_000_000;
      const oldMs = now - 31 * 60_000;
      const exited = { exitCode: 0, signalCode: null } as unknown as NonNullable<OliveJob["process"]>;
      jobRegistry.set(
        "exited",
        makeJob("exited", { status: "completed", finishedAt: oldMs, process: exited }),
      );

      expect(sweepJobRegistry(now)).toBe(1);
      expect(jobRegistry.has("exited")).toBe(false);
    });

    it("retains a job (and its path) when temp-file cleanup fails, for retry", () => {
      const now = 10_000_000_000;
      const oldMs = now - 31 * 60_000;
      const tmp = path.join(os.tmpdir(), "olive-sweep-retry.json");
      jobRegistry.set(
        "stuck",
        makeJob("stuck", { status: "completed", finishedAt: oldMs, tempRecipePath: tmp }),
      );

      // Simulate a permission/transient FS error on delete.
      const spy = vi.spyOn(fs, "rmSync").mockImplementation(() => {
        throw new Error("EPERM");
      });

      expect(sweepJobRegistry(now)).toBe(0);
      expect(jobRegistry.has("stuck")).toBe(true);
      expect(jobRegistry.get("stuck")?.tempRecipePath).toBe(tmp);

      // Once cleanup can succeed again, the next sweep reclaims it.
      spy.mockRestore();
      vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);
      expect(sweepJobRegistry(now)).toBe(1);
      expect(jobRegistry.has("stuck")).toBe(false);
    });
  });

  describe("resetJobRegistry", () => {
    it("kills active children, clears artifacts, registry, and MCP idempotency keys", () => {
      const kill = vi.fn();
      const tmp = path.join(os.tmpdir(), `olive-reset-test-${Date.now()}.json`);
      fs.writeFileSync(tmp, "{}", "utf-8");
      const job = makeJob("live", {
        status: "running",
        finishedAt: null,
        exitCode: null,
        source: "mcp",
        fingerprint: "fp-reset",
        idempotencyKey: "k-reset",
        tempRecipePath: tmp,
        process: {
          kill,
          exitCode: null,
          signalCode: null,
        } as unknown as OliveJob["process"],
      });
      jobRegistry.set(job.id, job);
      rememberIdempotencyKeys(job);
      expect(idempotencyIndexSize()).toBeGreaterThan(0);

      resetJobRegistry();

      expect(kill).toHaveBeenCalledWith("SIGKILL");
      expect(jobRegistry.size).toBe(0);
      expect(idempotencyIndexSize()).toBe(0);
      expect(fs.existsSync(tmp)).toBe(false);
      expect(findJobByIdempotency({ idempotencyKey: "k-reset" }).kind).toBe("miss");
    });

    it("detaches venv listeners and clears GPU metrics timers before finalize", () => {
      const listener = vi.fn();
      const handle = setInterval(() => {}, 60_000);
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      const job = makeJob("reset-resources", {
        status: "running",
        finishedAt: null,
        venvListener: listener as unknown as OliveJob["venvListener"],
        metricsTimer: handle,
        sampling: true,
      });
      jobRegistry.set(job.id, job);

      resetJobRegistry();

      expect(detachVenvListener).toHaveBeenCalledWith(listener);
      expect(job.venvListener).toBeUndefined();
      expect(clearSpy).toHaveBeenCalledWith(handle);
      expect(job.metricsTimer).toBeNull();
      expect(job.sampling).toBe(false);
      expect(job.status).toBe("cancelled");
      expect(jobRegistry.size).toBe(0);
    });

    it("cancels setting_up jobs so stub setup loops can exit", () => {
      const job = makeJob("setting-up", {
        status: "setting_up",
        finishedAt: null,
        process: null,
      });
      jobRegistry.set(job.id, job);

      resetJobRegistry();

      expect(job.status).toBe("cancelled");
      expect(job.finishedAt).toBeTypeOf("number");
      expect(jobRegistry.size).toBe(0);
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
      expect(cleanupJobArtifacts(job)).toBe(true);
    });

    it("tolerates an already-deleted temp file", () => {
      const job = makeJob("j", { tempRecipePath: path.join(os.tmpdir(), "does-not-exist-xyz.json") });
      expect(cleanupJobArtifacts(job)).toBe(true);
      expect(job.tempRecipePath).toBeNull();
    });

    it("returns false and keeps the path when deletion errors", () => {
      vi.spyOn(fs, "rmSync").mockImplementation(() => {
        throw new Error("EPERM");
      });
      const tmp = path.join(os.tmpdir(), "olive-cleanup-fail.json");
      const job = makeJob("j", { tempRecipePath: tmp });
      expect(cleanupJobArtifacts(job)).toBe(false);
      expect(job.tempRecipePath).toBe(tmp);
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
