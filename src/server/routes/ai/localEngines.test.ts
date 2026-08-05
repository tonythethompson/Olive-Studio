/**
 * Unit tests for the local AI engine setup internals (Tech Debt #16):
 *  - async `where/which` CLI probing with single-flight and TTL caching
 *  - abort-aware capped backoff polling in ensureOllamaReady / ensureLmsReady
 *
 * child_process.execFile is mocked with a `promisify.custom` handler so
 * `execFileAsync` (util.promisify(execFile)) resolves the same
 * `{ stdout, stderr }` shape as real Node's execFile promisification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";

import { findLmsCli, ensureOllamaReady, ensureLmsReady } from "./localEngines.ts";
import { localEngineRuntime, resetLocalEngineRuntime } from "../../services/ai/localEngineState.ts";

// ── Configurable child_process mocks ───────────────────────────────────────

const mocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  spawnImpl: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const customSymbol = Symbol.for("nodejs.util.promisify.custom");

  function mockExecFile(...execArgs: unknown[]): unknown {
    // Callback-style callers get an instant empty result.
    const lastArg = execArgs[execArgs.length - 1];
    if (typeof lastArg === "function") {
      lastArg(null, "", "");
      return undefined;
    }
    return (actual.execFile as unknown as (...a: unknown[]) => unknown)(...execArgs);
  }

  // util.promisify(execFile) prefers this when present (mirrors real Node's
  // execFile, which resolves { stdout, stderr }). Tests stub execFileImpl to
  // resolve that exact shape.
  (mockExecFile as unknown as Record<symbol, unknown>)[customSymbol] = (...args: unknown[]) => {
    if (mocks.execFileImpl) return mocks.execFileImpl(...args);
    return Promise.resolve({ stdout: "", stderr: "" });
  };

  function mockSpawn(...spawnArgs: unknown[]): ReturnType<typeof actual.spawn> {
    if (mocks.spawnImpl) return mocks.spawnImpl(...spawnArgs) as ReturnType<typeof actual.spawn>;
    const proc = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>;
    proc.stdout = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stdout"];
    proc.stderr = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stderr"];
    proc.stdin = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stdin"];
    (proc as unknown as Record<string, unknown>).pid = 99999;
    (proc as unknown as Record<string, unknown>).unref = () => {};
    (proc as unknown as Record<string, unknown>).kill = () => true;
    // Emit "spawn" (startOllamaOnce resolves on it), "exit" (spawnLmsServerDetached
    // resolves on it), then "close" via process.nextTick, which fake timers do not touch.
    process.nextTick(() => proc.emit("spawn"));
    process.nextTick(() => proc.emit("exit", 0));
    process.nextTick(() => proc.emit("close", 0));
    return proc;
  }

  return {
    ...actual,
    execFile: mockExecFile as unknown as typeof actual.execFile,
    spawn: mockSpawn as unknown as typeof actual.spawn,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Probe `where/which` output pointing at a real executable (passes fs.existsSync). */
const probeHit = { stdout: `${process.execPath}\n`, stderr: "" };

/** Real candidate dirs always miss; only the probe result path "exists". */
function stubExistsSyncOnlyForExecPath(): void {
  vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === process.execPath);
}

describe("findLmsCli async probing", () => {
  beforeEach(() => {
    resetLocalEngineRuntime();
    mocks.execFileImpl = null;
    mocks.spawnImpl = null;
    stubExistsSyncOnlyForExecPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the CLI path from `where lms`/`which lms` and caches it", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    mocks.execFileImpl = async (file: unknown, args: unknown) => {
      calls.push({ file: String(file), args: args as string[] });
      return probeHit;
    };

    expect(await findLmsCli()).toBe(process.execPath);
    // Second call hits the positive cache — no re-probe.
    expect(await findLmsCli()).toBe(process.execPath);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe(process.platform === "win32" ? "where" : "which");
    expect(calls[0]!.args[0]).toBe("lms");
  });

  it("single-flights concurrent probes so callers share one spawn", async () => {
    let calls = 0;
    mocks.execFileImpl = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return probeHit;
    };

    const [a, b] = await Promise.all([findLmsCli(), findLmsCli()]);
    expect(a).toBe(process.execPath);
    expect(b).toBe(process.execPath);
    expect(calls).toBe(1);
  });

  it("caches a miss within the TTL and re-probes after it expires", async () => {
    let calls = 0;
    mocks.execFileImpl = async () => {
      calls++;
      throw new Error("ENOENT");
    };
    expect(await findLmsCli()).toBeNull();
    expect(await findLmsCli()).toBeNull();
    expect(calls).toBe(1);

    // Backdate the cached miss past the 5s TTL, then let the next probe succeed.
    localEngineRuntime.lmsCliMissAt = Date.now() - 6000;
    mocks.execFileImpl = async () => {
      calls++;
      return probeHit;
    };
    expect(await findLmsCli()).toBe(process.execPath);
    expect(calls).toBe(2);
  });

  it("treats empty probe output as a miss", async () => {
    mocks.execFileImpl = async () => ({ stdout: "", stderr: "" });
    expect(await findLmsCli()).toBeNull();
  });
});

describe("abort-aware backoff polling (Tech Debt #16)", () => {
  beforeEach(() => {
    resetLocalEngineRuntime();
    mocks.execFileImpl = null;
    mocks.spawnImpl = null;
    stubExistsSyncOnlyForExecPath();
    // Local engines are "not running" unless a test overrides this.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a cancelled marker when the signal aborts during the ready poll", async () => {
    vi.useFakeTimers();
    mocks.execFileImpl = async () => probeHit;
    const ac = new AbortController();

    const pending = ensureOllamaReady(undefined, ac.signal);
    await vi.advanceTimersByTimeAsync(300); // mid first backoff sleep
    ac.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it("returns ok once the server responds during backoff polling", async () => {
    vi.useFakeTimers();
    mocks.execFileImpl = async () => probeHit;
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetches++;
        if (fetches <= 2) throw new Error("ECONNREFUSED");
        return { ok: true };
      }),
    );

    const pending = ensureOllamaReady();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.steps).toContain("Ollama HTTP server ready on :11434");
  });

  it("fails with a normal error (not cancelled) after the max wait elapses", async () => {
    vi.useFakeTimers();
    mocks.execFileImpl = async () => probeHit;

    const pending = ensureOllamaReady();
    await vi.advanceTimersByTimeAsync(50_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.cancelled).toBeUndefined();
    // Platform-specific timeout copy (darwin/win32 vs linux headless serve).
    expect(result.error).toMatch(/Ollama (serve )?did not (become ready|start)/);
  });

  it("returns a cancelled marker for LM Studio setup when the signal aborts", async () => {
    vi.useFakeTimers();
    mocks.execFileImpl = async () => probeHit;
    const ac = new AbortController();

    const pending = ensureLmsReady(undefined, ac.signal);
    await vi.advanceTimersByTimeAsync(300); // mid first backoff sleep
    ac.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
  });
});
