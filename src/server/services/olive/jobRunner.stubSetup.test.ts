/**
 * Deterministic coverage for OLIVE_JOB_SETUP_STUB timeout / fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preflightOliveRecipe } from "./jobPreflight.ts";
import { clearIdempotencyIndex } from "./jobIdempotency.ts";
import { finalizeJob, jobRegistry } from "./state.ts";
import { detachVenvListener, ensureProviderCapability } from "../venv/index.ts";

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
  detachVenvListener: vi.fn(),
  resolveOliveCommand: vi.fn(() => ({ executable: "echo", args: ["ok"] })),
}));

const { startOliveJob } = await import("./jobRunner.ts");

const trackedJobIds = new Set<string>();

beforeEach(() => {
  trackedJobIds.clear();
  vi.useFakeTimers();
  process.env.OLIVE_JOB_SETUP_STUB = "1";
  delete process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS;
  delete process.env.OLIVE_UI_SETUP_TIMEOUT_MS;
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
      if (!job || job.finishedAt != null) continue;
      if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "completed") {
        job.status = "cancelled";
      }
    }
    // Let stub / detached continueOliveJobSetup observe cancel on one poll tick.
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    for (const id of trackedJobIds) {
      const job = jobRegistry.get(id);
      if (job && job.finishedAt == null) finalizeJob(job);
    }
  } finally {
    trackedJobIds.clear();
    jobRegistry.clear();
    clearIdempotencyIndex();
    delete process.env.OLIVE_JOB_SETUP_STUB;
    delete process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS;
    delete process.env.OLIVE_UI_SETUP_TIMEOUT_MS;
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

    await vi.advanceTimersByTimeAsync(1);
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

    await vi.advanceTimersByTimeAsync(120_000);
    expect(job.status).toBe("failed");
    expect(job.finishedAt).not.toBeNull();
    expect(job.logs.some((line) => line.includes("Setup stub timed out after 120000ms"))).toBe(
      true,
    );
  });

  it("honors a 500ms timeout without overshooting the final poll", async () => {
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
    expect(job.finishedAt).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(job.status).toBe("failed");
    expect(job.finishedAt).not.toBeNull();
    expect(job.logs.some((line) => line.includes("Setup stub timed out after 500ms"))).toBe(true);
  });

  it("returns ok:false with 504 when the UI path awaits a stub timeout", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "500";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const pending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(499);
    // Still inside the final shortened poll; UI promise has not settled.
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
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

  it("bounds the UI path itself when setup hangs past OLIVE_UI_SETUP_TIMEOUT_MS", async () => {
    process.env.OLIVE_UI_SETUP_TIMEOUT_MS = "1000";
    // No OLIVE_JOB_SETUP_STUB_TIMEOUT_MS override — the stub's own default
    // (120s) would otherwise hang the request well past our UI-level cap.
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const pending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.jobId) trackedJobIds.add(result.jobId);
    expect(result.httpStatus).toBe(504);
    expect(result.error).toMatch(/Olive setup timed out after 1000ms/);
    // The still-running (stubbed) setup must observe cancellation and never
    // resurrect the job into "running"/"completed" after we've responded.
    const job = result.jobId ? jobRegistry.get(result.jobId) : undefined;
    expect(job?.status).toBe("cancelled");

    await vi.advanceTimersByTimeAsync(200);
    expect(job?.status).toBe("cancelled");
  });

  it("accepts Node's maximum timer delay and falls back above it", async () => {
    process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS = "700000";
    process.env.OLIVE_UI_SETUP_TIMEOUT_MS = "2147483647";
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const pending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(600_001);
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const job = [...jobRegistry.values()].at(-1);
    expect(job).toBeDefined();
    if (!job) return;
    job.status = "cancelled";
    await vi.advanceTimersByTimeAsync(200);
    await pending;

    process.env.OLIVE_UI_SETUP_TIMEOUT_MS = "2147483648";
    const fallbackPending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(600_000);
    const fallbackResult = await fallbackPending;
    expect(fallbackResult.ok).toBe(false);
    if (fallbackResult.ok) return;
    if (fallbackResult.jobId) trackedJobIds.add(fallbackResult.jobId);
    expect(fallbackResult.error).toMatch(/timed out after 600000ms/);
  });

  it("detaches the venv listener when UI setup times out", async () => {
    delete process.env.OLIVE_JOB_SETUP_STUB;
    process.env.OLIVE_UI_SETUP_TIMEOUT_MS = "1000";
    let resolveSetup: ((value: { ok: true; python: string; family: "default" }) => void) | undefined;
    vi.mocked(ensureProviderCapability).mockImplementation(
      () => new Promise((resolve) => {
        resolveSetup = resolve;
      }),
    );
    const recipe = { input_model: {}, passes: {}, engine: {}, systems: {} } as never;

    const pending = startOliveJob({ recipe, source: "ui" });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok || !result.jobId) return;
    trackedJobIds.add(result.jobId);
    expect(detachVenvListener).toHaveBeenCalledTimes(1);
    expect(jobRegistry.get(result.jobId)?.venvListener).toBeUndefined();

    resolveSetup?.({ ok: true, python: "python", family: "default" });
    await Promise.resolve();
  });
});
