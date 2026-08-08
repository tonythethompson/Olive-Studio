/**
 * Concurrent MCP submit locking + idempotent reuse via startOliveJob.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { preflightOliveRecipe } from "./jobPreflight.ts";
import { mcpSubmitLockTailCount, startOliveJob } from "./jobRunner.ts";
import { clearIdempotencyIndex } from "./jobIdempotency.ts";
import { jobRegistry } from "./state.ts";

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
  buildOliveRunEnvironment: vi.fn(() => ({})),
  resolveOliveCommand: vi.fn(() => ({ executable: "echo", args: ["ok"] })),
}));

afterEach(() => {
  jobRegistry.clear();
  clearIdempotencyIndex();
  vi.clearAllMocks();
  vi.mocked(preflightOliveRecipe).mockImplementation(() => ({
    valid: true,
    provider: "CPUExecutionProvider",
    fingerprint: "fp-concurrent",
    errors: [] as string[],
    warnings: [] as string[],
    cudaVersion: "auto",
    recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
  }));
});

describe("startOliveJob MCP idempotency lock", () => {
  it("serializes concurrent submits with the same idempotency key into one job", async () => {
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;
    const [a, b] = await Promise.all([
      startOliveJob({ recipe, source: "mcp", idempotencyKey: "same-key" }),
      startOliveJob({ recipe, source: "mcp", idempotencyKey: "same-key" }),
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
      startOliveJob({ recipe, source: "mcp", idempotencyKey: "agent-key-1" }),
      startOliveJob({ recipe, source: "mcp" }),
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
    const fpOnly = await startOliveJob({ recipe, source: "mcp" });
    const withKey = await startOliveJob({
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
    const replay = await startOliveJob({
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
    const first = await startOliveJob({ recipe, source: "mcp", idempotencyKey: "key-a" });
    const second = await startOliveJob({ recipe, source: "mcp", idempotencyKey: "key-b" });
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
      const result = await startOliveJob({
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
    const results = await Promise.all([
      startOliveJob({ recipe, source: "mcp", idempotencyKey: "hold-1" }),
      startOliveJob({ recipe, source: "mcp", idempotencyKey: "hold-2" }),
      startOliveJob({ recipe, source: "mcp" }), // fingerprint-only overlaps fp lock
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mcpSubmitLockTailCount()).toBe(0);
  });
});
