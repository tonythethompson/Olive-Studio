/**
 * Concurrent MCP submit locking + idempotent reuse via startOliveJob.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { startOliveJob } from "./jobRunner.ts";
import { clearIdempotencyIndex } from "./jobIdempotency.ts";
import { jobRegistry } from "./state.ts";

afterEach(() => {
  jobRegistry.clear();
  clearIdempotencyIndex();
  vi.clearAllMocks();
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
  });
});
