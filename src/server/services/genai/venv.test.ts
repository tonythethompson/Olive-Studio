/**
 * Unit tests for the GenAI venv service:
 *  - ensureGenaiVenv serializes concurrent setup into a single operation
 *    (remounts / multiple callers must not create+install the same venv)
 *  - sidecar exitPromise settles on spawn 'error' as well as 'exit'
 *  - shutdownSidecar escalates to a hard kill when graceful shutdown times out
 *
 * `child_process` is mocked via `src/server/__tests__/childProcessTestMocks.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import fs from "fs";

const mocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  spawnImpl: null as null | ((...args: unknown[]) => unknown),
  execFileCalls: [] as unknown[][],
}));

vi.mock("child_process", async (importOriginal) => {
  const { childProcessVitestMockFactory } = await import("../../__tests__/childProcessTestMocks.ts");
  return childProcessVitestMockFactory(mocks, { includeSpawn: true })(importOriginal);
});

import { ensureGenaiVenv, shutdownSidecar, spawnSidecar } from "./venv.ts";

/**
 * Makes the GenAI venv look "not ready" while letting the mocked venv
 * creation flip it to ready afterwards. mkdirSync is stubbed so tests never
 * create a real `.venvs/` directory in the repo.
 */
function stubVenvNotReady(): void {
  let venvCreated = false;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const path = String(p);
    if (path.includes(".venvs") && path.includes("genai") && /python(\.exe)?$/.test(path)) {
      return venvCreated;
    }
    return true;
  });
  vi.spyOn(fs, "mkdirSync").mockImplementation(() => "" as never);
  mocks.execFileImpl = async (file: unknown, args: unknown) => {
    const a = args as string[];
    if (a.includes("--version")) return { stdout: "Python 3.12.0", stderr: "" };
    if (a.includes("venv")) venvCreated = true;
    return { stdout: "", stderr: "" };
  };
}

/** A fake child process that never exits on its own (caller emits events). */
function inertChildProcess(): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  proc.stdout = new EventEmitter() as ChildProcess["stdout"];
  proc.stderr = new EventEmitter() as ChildProcess["stderr"];
  proc.stdin = new EventEmitter() as ChildProcess["stdin"];
  const record = proc as unknown as Record<string, unknown>;
  record.pid = 4242;
  record.exitCode = null;
  record.killed = false;
  record.kill = () => true;
  return proc;
}

describe("ensureGenaiVenv", () => {
  beforeEach(() => {
    mocks.execFileImpl = null;
    mocks.spawnImpl = null;
    mocks.execFileCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares one setup operation across concurrent callers", async () => {
    stubVenvNotReady();
    let execCalls = 0;
    const realImpl = mocks.execFileImpl!;
    mocks.execFileImpl = async (...args) => {
      execCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return realImpl(...args);
    };

    const progress: string[][] = [[], []];
    const [a, b] = await Promise.all([
      ensureGenaiVenv((line) => progress[0].push(line)),
      ensureGenaiVenv((line) => progress[1].push(line)),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Two callers must not run the python probe / venv create / pip / verify
    // sequence twice — that is exactly one full setup.
    expect(execCalls).toBe(4);
    // The late joiner still receives progress lines from the shared setup.
    expect(progress[1].length).toBeGreaterThan(0);
    expect(progress[1]).toContain("[genai] Setup complete. onnxruntime-genai ready.");
  });

  it("returns an error result when no system python is found", async () => {
    stubVenvNotReady();
    mocks.execFileImpl = async () => {
      throw new Error("ENOENT");
    };
    const result = await ensureGenaiVenv(() => {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Python >=3.10 not found");
  });
});

describe("spawnSidecar lifecycle", () => {
  beforeEach(() => {
    mocks.execFileImpl = null;
    mocks.spawnImpl = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("settles exitPromise when the sidecar fails to spawn (error, not exit)", async () => {
    const proc = inertChildProcess();
    mocks.spawnImpl = () => proc;

    const sidecar = spawnSidecar("/tmp/whatever", "cpu");
    proc.emit("error", new Error("ENOENT"));

    await expect(sidecar.exitPromise).resolves.toBeNull();
    expect(sidecar.alive()).toBe(false);
  });

  it("hard-kills a sidecar that ignores graceful shutdown after the wait cap", async () => {
    vi.useFakeTimers();
    const proc = inertChildProcess();
    const kills: string[] = [];
    (proc as unknown as Record<string, unknown>).kill = (sig?: string) => {
      kills.push(sig ?? "");
      return true;
    };
    mocks.spawnImpl = () => proc;

    spawnSidecar("/tmp/whatever", "cpu");
    const pending = shutdownSidecar();

    await vi.advanceTimersByTimeAsync(2000); // graceful SIGTERM escalator
    await vi.advanceTimersByTimeAsync(3000); // past the 5s cap → SIGKILL
    await pending;

    expect(kills).toContain("SIGTERM");
    expect(kills).toContain("SIGKILL");
  });
});
