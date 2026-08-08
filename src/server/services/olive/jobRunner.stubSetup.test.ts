/**
 * Deterministic coverage for OLIVE_JOB_SETUP_STUB timeout / fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preflightOliveRecipe } from "./jobPreflight.ts";
import { clearIdempotencyIndex } from "./jobIdempotency.ts";
import { finalizeJob, jobRegistry } from "./state.ts";

vi.mock("./jobPreflight.ts", () => ({
  preflightOliveRecipe: vi.fn(() => ({
    valid: true,
    provider: "CPUExecutionProvider",
    fingerprint: "fp-stub-timeout",
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

const { startOliveJob } = await import("./jobRunner.ts");

const trackedJobIds = new Set<string>();

beforeEach(() => {
  trackedJobIds.clear();
  vi.useFakeTimers();
  process.env.OLIVE_JOB_SETUP_STUB = "1";
  delete process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS;
  vi.mocked(preflightOliveRecipe).mockImplementation(() => ({
    valid: true,
    provider: "CPUExecutionProvider",
    fingerprint: "fp-stub-timeout",
    errors: [] as string[],
    warnings: [] as string[],
    cudaVersion: "auto",
    recipe: { input_model: {}, passes: {}, engine: {}, systems: {} },
  }));
});

afterEach(async () => {
  try {
    for (const id of trackedJobIds) {
      const job = jobRegistry.get(id);
      if (job && job.finishedAt == null) {
        if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "completed") {
          job.status = "cancelled";
        }
        finalizeJob(job);
      }
    }
  } finally {
    trackedJobIds.clear();
    jobRegistry.clear();
    clearIdempotencyIndex();
    delete process.env.OLIVE_JOB_SETUP_STUB;
    delete process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS;
    vi.useRealTimers();
    vi.clearAllMocks();
  }
});

describe("OLIVE_JOB_SETUP_STUB timeout", () => {
  it("falls back to 120s for non-positive OLIVE_JOB_SETUP_STUB_TIMEOUT_MS and fails the job", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "0";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const admitted = await startOliveJob({ recipe, source: "mcp" });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    trackedJobIds.add(admitted.jobId);

    const job = jobRegistry.get(admitted.jobId);
    expect(job).toBeDefined();
    if (!job) return;
    expect(job.status).toBe("setting_up");

    await vi.advanceTimersByTimeAsync(119_999);
    expect(job.status).toBe("setting_up");
    expect(job.finishedAt).toBeNull();

    await vi.advanceTimersByTimeAsync(200);
    expect(job.status).toBe("failed");
    expect(job.finishedAt).not.toBeNull();
    expect(job.logs.some((line) => line.includes("Setup stub timed out after 120000ms"))).toBe(
      true,
    );
  });

  it("falls back to 120s for invalid OLIVE_JOB_SETUP_STUB_TIMEOUT_MS", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "nope";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const admitted = await startOliveJob({ recipe, source: "mcp" });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    trackedJobIds.add(admitted.jobId);
    const job = jobRegistry.get(admitted.jobId);
    expect(job).toBeDefined();
    if (!job) return;

    await vi.advanceTimersByTimeAsync(120_200);
    expect(job.status).toBe("failed");
    expect(job.finishedAt).not.toBeNull();
    expect(job.logs.some((line) => line.includes("Setup stub timed out after 120000ms"))).toBe(
      true,
    );
  });

  it("honors a positive OLIVE_JOB_SETUP_STUB_TIMEOUT_MS override", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "500";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const admitted = await startOliveJob({ recipe, source: "mcp" });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    trackedJobIds.add(admitted.jobId);
    const job = jobRegistry.get(admitted.jobId);
    expect(job).toBeDefined();
    if (!job) return;

    await vi.advanceTimersByTimeAsync(499);
    expect(job.status).toBe("setting_up");
    await vi.advanceTimersByTimeAsync(200);
    expect(job.status).toBe("failed");
    expect(job.finishedAt).not.toBeNull();
    expect(job.logs.some((line) => line.includes("Setup stub timed out after 500ms"))).toBe(true);
  });

  it("returns ok:false with 504 when the UI path awaits a stub timeout", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "500";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const pending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(700);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.jobId) trackedJobIds.add(result.jobId);
    expect(result.httpStatus).toBe(504);
    expect(result.error).toMatch(/timed out after 500ms/);
    const job = result.jobId ? jobRegistry.get(result.jobId) : undefined;
    expect(job?.status).toBe("failed");
    expect(job?.finishedAt).not.toBeNull();
  });
});
