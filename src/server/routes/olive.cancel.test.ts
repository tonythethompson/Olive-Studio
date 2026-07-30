/**
 * Route-level coverage for cancelling an Olive job *during* environment setup,
 * before the child process exists. Gated `ensureVenv` / `buildOliveRunEnvironment`
 * mocks let us hold the run in `setting_up` at each setup await, cancel it, then
 * assert the run aborts without writing a recipe or spawning Olive.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import fs from "fs";

// ── Controllable setup gates ──────────────────────────────────────────────
// ensureVenv always pauses on its gate. buildOliveRunEnvironment only pauses
// when `gateBuildEnv` is set, so most tests aren't blocked by it.
let releaseEnsureVenv: (() => void) | null = null;
let releaseBuildEnv: (() => void) | null = null;
let gateBuildEnv = false;

vi.mock("../services/venv/index.ts", () => ({
  ensureVenv: vi.fn(async (onLine: (line: string) => void) => {
    onLine("[setup] (mock) creating venv…");
    await new Promise<void>((resolve) => {
      releaseEnsureVenv = resolve;
    });
    return { ok: true };
  }),
  buildOliveRunEnvironment: vi.fn(async () => {
    if (gateBuildEnv) {
      await new Promise<void>((resolve) => {
        releaseBuildEnv = resolve;
      });
    }
    return {} as NodeJS.ProcessEnv;
  }),
  resolveOliveCommand: vi.fn(() => ({ executable: "python", args: ["-m", "olive"] })),
  detachVenvListener: vi.fn(),
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
  releaseBuildEnv = null;
  gateBuildEnv = false;
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("cancels during buildOliveRunEnvironment (after venv) and never writes a recipe or spawns", async () => {
    gateBuildEnv = true;
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockReturnValue(undefined);

    const runPromise = fetch(`${baseUrl}/api/olive/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeJson: "{}" }),
    });

    // Advance past ensureVenv, then hold inside buildOliveRunEnvironment.
    (await waitFor(() => releaseEnsureVenv ?? undefined))();
    await waitFor(() => releaseBuildEnv ?? undefined);

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
    expect(await cancelRes.json()).toMatchObject({ ok: true, status: "cancelled" });

    // Release the build gate; the run must abort at the post-build cancel check.
    releaseBuildEnv?.();
    const runBody = await (await runPromise).json();
    expect(runBody).toMatchObject({ ok: false, status: "cancelled" });

    expect(jobRegistry.get(jobId)?.status).toBe("cancelled");
    expect(writeSpy).not.toHaveBeenCalled(); // recipe file never created
    expect(spawnSpy).not.toHaveBeenCalled();
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

describe("POST /api/olive/run temp-recipe write failure", () => {
  it("reclaims the temp recipe file when writing it fails", async () => {
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    // Records whether cleanup tried to remove the (partially/never) written file.
    const rmSpy = vi.spyOn(fs, "rmSync").mockReturnValue(undefined);

    const runPromise = fetch(`${baseUrl}/api/olive/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeJson: "{}" }),
    });

    // ensureVenv is gated — release it so setup proceeds to the failing write.
    const release = await waitFor(() => releaseEnsureVenv ?? undefined);
    release();

    const res = await runPromise;
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(spawnSpy).not.toHaveBeenCalled();

    // tempRecipePath was recorded before the write, so cleanup targeted it.
    const rmTarget = rmSpy.mock.calls[0]?.[0];
    expect(String(rmTarget)).toContain("recipe-");
    expect(String(rmTarget)).toContain(".json");

    const job = [...jobRegistry.values()].at(-1);
    expect(job?.status).toBe("failed");
    expect(job?.tempRecipePath).toBeNull();
  });
});
