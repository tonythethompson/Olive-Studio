/**
 * Concurrent MCP submit locking + idempotent reuse via startOliveJob.
 * Keeps setup CPU-only: mocked spawn/fs, lifecycle teardown before registry clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import { preflightOliveRecipe } from "./jobPreflight.ts";
import { clearIdempotencyIndex } from "./jobIdempotency.ts";
import { finalizeJob, jobRegistry } from "./state.ts";

const childProcessMocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  spawnImpl: null as null | ((...args: unknown[]) => unknown),
  execFileCalls: [] as unknown[][],
}));

vi.mock("child_process", async (importOriginal) => {
  const { childProcessVitestMockFactory } = await import("../../__tests__/childProcessTestMocks.ts");
  return childProcessVitestMockFactory(childProcessMocks, { includeSpawn: true })(importOriginal);
});

vi.mock("./jobPreflight.ts", () => ({
  preflightOliveRecipe: vi.fn(() => ({
    valid: true,
    provider: "CPUExecutionProvider",
    fingerprint: "fp-concurrent",
    errors: [] as string[],
    warnings: [] as string[],
    cudaVersion: "auto",
    recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
  })),
}));

vi.mock("../venv/index.ts", () => ({
  ensureProviderCapability: vi.fn(async () => ({
    ok: true,
    python: "python",
    family: "default",
  })),
  buildOliveRunEnvironment: vi.fn(async () => ({})),
  resolveOliveCommand: vi.fn(() => ({ executable: "echo", args: ["ok"] })),
}));

const { mcpSubmitLockTailCount, startOliveJob } = await import("./jobRunner.ts");

/** Every job id created by this file's helpers (including reused lookups). */
const trackedJobIds = new Set<string>();

const TEARDOWN_DEADLINE_MS = 5_000;

async function awaitTrackedJobsFinished(deadlineMs = TEARDOWN_DEADLINE_MS): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (const id of trackedJobIds) {
    const job = jobRegistry.get(id);
    if (!job || job.finishedAt != null) continue;
    if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
      job.status = "cancelled";
    }
    const proc = job.process;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* mock already exited */
      }
    }
  }

  while (Date.now() < deadline) {
    const unfinished = [...trackedJobIds].filter((id) => {
      const job = jobRegistry.get(id);
      return job != null && job.finishedAt == null;
    });
    if (unfinished.length === 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }

  const stuck = [...trackedJobIds].filter((id) => {
    const job = jobRegistry.get(id);
    return job != null && job.finishedAt == null;
  });
  for (const id of stuck) {
    const job = jobRegistry.get(id);
    if (job) finalizeJob(job);
  }
  if (stuck.length > 0) {
    throw new Error(
      `jobRunner teardown deadline (${deadlineMs}ms): unfinished jobs ${stuck.join(", ")}`,
    );
  }
}

beforeEach(() => {
  trackedJobIds.clear();
  vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
  vi.spyOn(fs, "writeFileSync").mockReturnValue(undefined);
});

afterEach(async () => {
  try {
    await awaitTrackedJobsFinished();
  } finally {
    trackedJobIds.clear();
    jobRegistry.clear();
    clearIdempotencyIndex();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(preflightOliveRecipe).mockImplementation(() => ({
      valid: true,
      provider: "CPUExecutionProvider",
      fingerprint: "fp-concurrent",
      errors: [] as string[],
      warnings: [] as string[],
      cudaVersion: "auto",
      recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
    }));
  }
});

/** Track every created/reused job id so afterEach can cancel and await finishedAt. */
async function startOliveJobTracked(
  ...args: Parameters<typeof startOliveJob>
): ReturnType<typeof startOliveJob> {
  const result = await startOliveJob(...args);
  if (result.ok) trackedJobIds.add(result.jobId);
  return result;
}

describe("startOliveJob MCP idempotency lock", () => {
  it("serializes concurrent submits with the same idempotency key into one job", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    const [a, b] = await Promise.all([
      startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "same-key" }),
      startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "same-key" }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.jobId).toBe(b.jobId);
    expect([...jobRegistry.keys()]).toHaveLength(1);
    // Sequential critical section: one fresh submit, one reuse.
    expect([a.reused, b.reused].filter(Boolean)).toHaveLength(1);
    expect(mcpSubmitLockTailCount()).toBe(0);
  });

  it("serializes key-bearing and fingerprint-only submits for the same recipe", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    const [withKey, fpOnly] = await Promise.all([
      startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "agent-key-1" }),
      startOliveJobTracked({ recipe, source: "mcp" }),
    ]);
    expect(withKey.ok).toBe(true);
    expect(fpOnly.ok).toBe(true);
    if (!withKey.ok || !fpOnly.ok) return;
    // Fingerprint-only must reuse the in-flight/keyed job (not spawn a second GPU run).
    expect(withKey.jobId).toBe(fpOnly.jobId);
    expect([...jobRegistry.keys()]).toHaveLength(1);
    expect(mcpSubmitLockTailCount()).toBe(0);
  });

  it("reuses a fingerprint-only admission when a keyed submit arrives afterward", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    const fpOnly = await startOliveJobTracked({ recipe, source: "mcp" });
    const withKey = await startOliveJobTracked({
      recipe,
      source: "mcp",
      idempotencyKey: "after-fp-key",
    });
    expect(fpOnly.ok).toBe(true);
    expect(withKey.ok).toBe(true);
    if (!fpOnly.ok || !withKey.ok) return;
    expect(withKey.jobId).toBe(fpOnly.jobId);
    expect(withKey.reused).toBe(true);

    // Same adopted key must replay onto the fingerprint-only job.
    const replay = await startOliveJobTracked({
      recipe,
      source: "mcp",
      idempotencyKey: "after-fp-key",
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.jobId).toBe(fpOnly.jobId);
    expect(replay.reused).toBe(true);
    expect([...jobRegistry.keys()]).toHaveLength(1);
    expect(mcpSubmitLockTailCount()).toBe(0);
  });

  it("still allows a distinct idempotency key to start a new job after the first settles", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    const first = await startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "key-a" });
    const second = await startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "key-b" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.jobId).not.toBe(second.jobId);
    expect([...jobRegistry.keys()]).toHaveLength(2);
    expect(mcpSubmitLockTailCount()).toBe(0);
  });

  it("evicts completed lock tails and does not retain unique keys forever", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    let n = 0;
    vi.mocked(preflightOliveRecipe).mockImplementation(() => {
      n += 1;
      return {
        valid: true,
        provider: "CPUExecutionProvider",
        fingerprint: `fp-unique-${n}`,
        errors: [] as string[],
        warnings: [] as string[],
        cudaVersion: "auto",
        recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
      };
    });

    for (let i = 0; i < 20; i += 1) {
      const result = await startOliveJobTracked({
        recipe,
        source: "mcp",
        idempotencyKey: `unique-key-${i}`,
      });
      expect(result.ok).toBe(true);
      // Idle between submits: map must not accumulate completed tails.
      expect(mcpSubmitLockTailCount()).toBe(0);
    }
    expect([...jobRegistry.keys()]).toHaveLength(20);
  });

  it("evicts only owned tails so overlapping waiters still drain the map", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    vi.mocked(preflightOliveRecipe).mockImplementation(() => ({
      valid: true,
      provider: "CPUExecutionProvider",
      fingerprint: "fp-hold",
      errors: [] as string[],
      warnings: [] as string[],
      cudaVersion: "auto",
      recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
    }));

    // Distinct keys share fp:fp-hold lock; second replaces the map entry while first still holds.
    // First release must not delete the newer tail (ownership check); both finish and map is empty.
    // Serialized waiters: hold-1 then hold-2 create distinct jobs; fingerprint-only reuses hold-2.
    const [hold1, hold2, fpOnly] = await Promise.all([
      startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "hold-1" }),
      startOliveJobTracked({ recipe, source: "mcp", idempotencyKey: "hold-2" }),
      startOliveJobTracked({ recipe, source: "mcp" }),
    ]);
    expect(hold1.ok && hold2.ok && fpOnly.ok).toBe(true);
    if (!hold1.ok || !hold2.ok || !fpOnly.ok) return;
    expect(hold1.jobId).not.toBe(hold2.jobId);
    expect(hold1.reused).toBe(false);
    expect(hold2.reused).toBe(false);
    expect(fpOnly.reused).toBe(true);
    expect(fpOnly.jobId).toBe(hold2.jobId);
    expect([...jobRegistry.keys()].sort()).toEqual([hold1.jobId, hold2.jobId].sort());
    expect(mcpSubmitLockTailCount()).toBe(0);
  });
});
