/**
 * Route-level coverage for cancelling an Olive job *during* environment setup,
 * before the child process exists. A gated `ensureVenv` mock lets us hold the
 * run in `setting_up`, cancel it, then assert the run aborts without spawning.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";

// ── Controllable ensureVenv gate ──────────────────────────────────────────
let releaseEnsureVenv: (() => void) | null = null;
function ensureVenvGate(): Promise<void> {
  return new Promise<void>((resolve) => {
    releaseEnsureVenv = resolve;
  });
}

vi.mock("../services/venv/index.ts", () => ({
  ensureVenv: vi.fn(async (onLine: (line: string) => void) => {
    onLine("[setup] (mock) creating venv…");
    await ensureVenvGate();
    return { ok: true };
  }),
  buildOliveRunEnvironment: vi.fn(async () => ({}) as NodeJS.ProcessEnv),
  resolveOliveCommand: vi.fn(() => ({ executable: "python", args: ["-m", "olive"] })),
}));

// spawn must never be called once the job was cancelled during setup.
const spawnSpy = vi.fn(() => {
  throw new Error("spawn() must not run after cancellation");
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: spawnSpy };
});

vi.mock("../../lib/oliveRecipeSchema.ts", () => ({
  validateOliveRecipeStructure: () => ({ valid: true, errors: [] }),
}));

// Imported after mocks are registered.
const { mountOliveRoutes } = await import("./olive.ts");
const { jobRegistry } = await import("../services/olive/state.ts");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountOliveRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  jobRegistry.clear();
  spawnSpy.mockClear();
  releaseEnsureVenv = null;
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("POST /api/olive/cancel during setup", () => {
  it("cancels a setting_up job and prevents Olive from spawning", async () => {
    const runPromise = fetch(`${baseUrl}/api/olive/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeJson: "{}" }),
    });

    // Job is registered synchronously before the first await; grab it while
    // ensureVenv is gated in "setting_up".
    const jobId = await waitFor(() => {
      for (const [id, job] of jobRegistry) {
        if (job.status === "setting_up") return id;
      }
      return undefined;
    });

    const cancelRes = await fetch(`${baseUrl}/api/olive/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json();
    expect(cancelBody).toMatchObject({ ok: true, status: "cancelled" });

    // Let the gated ensureVenv resolve; the run must now abort, not spawn.
    releaseEnsureVenv?.();
    const runRes = await runPromise;
    const runBody = await runRes.json();
    expect(runBody).toMatchObject({ ok: false, status: "cancelled" });

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(jobRegistry.get(jobId)?.status).toBe("cancelled");
  });

  it("returns terminal status without side effects when the job already finished", async () => {
    // Seed a completed job directly.
    jobRegistry.set("done-job", {
      id: "done-job",
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
      finishedAt: Date.now(),
      doneSubscribers: [],
    });

    const res = await fetch(`${baseUrl}/api/olive/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "done-job" }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "completed" });
  });
});
