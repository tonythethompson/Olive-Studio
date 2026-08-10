/**
 * Route-level coverage for cancelling an Olive job *during* environment setup,
 * before the child process exists. Gated `ensureProviderCapability` /
 * `buildOliveRunEnvironment` mocks let us hold the run in `setting_up` at each
 * setup await, cancel it, then assert the run aborts without writing a recipe
 * or spawning Olive.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import fs from "fs";

// ── Controllable setup gates ──────────────────────────────────────────────
// ensureProviderCapability always pauses on its gate. buildOliveRunEnvironment
// only pauses when `gateBuildEnv` is set, so most tests aren't blocked by it.
let releaseEnsureProviderCapability: (() => void) | null = null;
let releaseBuildEnv: (() => void) | null = null;
let gateBuildEnv = false;

vi.mock("../services/venv/index.ts", () => ({
  ensureProviderCapability: vi.fn(async (_provider: string, onLine: (line: string) => void) => {
    onLine("[setup] Using default runtime");
    onLine("[setup] (mock) creating venv…");
    await new Promise<void>((resolve) => {
      releaseEnsureProviderCapability = resolve;
    });
    return { ok: true, family: "default", python: "/tmp/mock-python" };
  }),
  buildOliveRunEnvironment: vi.fn(async () => {
    if (gateBuildEnv) {
      await new Promise<void>((resolve) => {
        releaseBuildEnv = resolve;
      });
    }
    return {} as NodeJS.ProcessEnv;
  }),
  resolveOliveCommand: vi.fn(() => ({
    executable: "python",
    args: ["-m", "olive"],
    family: "default",
  })),
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
  releaseEnsureProviderCapability = null;
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
    // ensureProviderCapability is gated in "setting_up".
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

    // Let the gated ensureProviderCapability resolve; the run must now abort, not spawn.
    releaseEnsureProviderCapability?.();
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

    // Advance past ensureProviderCapability, then hold inside buildOliveRunEnvironment.
    (await waitFor(() => releaseEnsureProviderCapability ?? undefined))();
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

  it("escalates SIGTERM to SIGKILL when the child ignores cancellation", async () => {
    const kill = vi.fn();
    const once = vi.fn();
    const proc = {
      kill,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      once,
    };

    jobRegistry.set("stuck-job", {
      id: "stuck-job",
      status: "running",
      exitCode: null,
      logs: [],
      subscribers: [],
      metricSubscribers: [],
      process: proc as unknown as import("child_process").ChildProcess,
      latestMetrics: null,
      metricsTimer: null,
      sampling: false,
      tempRecipePath: null,
      finishedAt: null,
      doneSubscribers: [],
    });

    const { CANCEL_SIGKILL_GRACE_MS } = await import("./olive.ts");
    let escalate: (() => void) | undefined;
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === CANCEL_SIGKILL_GRACE_MS && typeof fn === "function") {
        escalate = () => (fn as (...a: unknown[]) => void)(...args);
        return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn as never, ms as never, ...(args as never[]));
    }) as unknown as typeof setTimeout);

    try {
      const res = await fetch(`${baseUrl}/api/olive/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "stuck-job" }),
      });
      expect(await res.json()).toMatchObject({ ok: true, status: "cancelled" });
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      expect(kill).not.toHaveBeenCalledWith("SIGKILL");
      expect(escalate).toBeTypeOf("function");
      expect(once).toHaveBeenCalledWith("close", expect.any(Function));

      escalate!();
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      setTimeoutSpy.mockRestore();
    }
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

    // ensureProviderCapability is gated — release it so setup proceeds to the failing write.
    const release = await waitFor(() => releaseEnsureProviderCapability ?? undefined);
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

describe("Loopback-only gating on UI Olive endpoints", () => {
  it("rejects UI cancel from a reverse-proxied request", async () => {
    const res = await fetch(`${baseUrl}/api/olive/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify({ jobId: "some-job" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "This endpoint is only available from loopback" });
  });

  it("rejects UI run from a reverse-proxied request", async () => {
    const res = await fetch(`${baseUrl}/api/olive/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify({ recipeJson: "{}" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "This endpoint is only available from loopback" });
  });
});
