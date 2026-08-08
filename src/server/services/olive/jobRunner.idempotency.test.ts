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
  ensureProviderCapability: vi.fn(async () => ({ ok: true })),
  buildOliveRunEnvironment: vi.fn(() => ({})),
  resolveOliveCommand: vi.fn(() => ({ cmd: "echo", args: ["ok"] })),
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
    // Lock shares one promise: identical payload, single registry entry.
    expect(a.jobId).toBe(b.jobId);
    expect(a.reused).toBe(b.reused);
    expect([...jobRegistry.keys()]).toHaveLength(1);
  });
});
