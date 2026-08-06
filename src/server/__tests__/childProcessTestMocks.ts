/**
 * Shared Vitest mock for `child_process.execFile` (with promisify.custom) and
 * optional `spawn`. Keeps the promisify shape identical across server unit tests.
 *
 * Usage:
 * ```ts
 * const mocks = vi.hoisted(() => createChildProcessTestHandles());
 * vi.mock("child_process", childProcessVitestMockFactory(mocks, { includeSpawn: true }));
 * // In tests: mocks.execFileImpl = async () => ({ stdout: "…", stderr: "" });
 * ```
 *
 * Used by MCP client/route tests and local engine setup tests in this PR.
 */
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");

export type ChildProcessTestHandles = {
  execFileImpl: null | ((...args: unknown[]) => unknown);
  spawnImpl: null | ((...args: unknown[]) => unknown);
  /** Populated when `trackExecFileCalls` is enabled on the mock factory. */
  execFileCalls: unknown[][];
};

export function createChildProcessTestHandles(): ChildProcessTestHandles {
  return { execFileImpl: null, spawnImpl: null, execFileCalls: [] };
}

export type ChildProcessMockOptions = {
  /** Install a default spawn mock that emits spawn/exit/close on nextTick. */
  includeSpawn?: boolean;
  /** Record promisified execFile args in `handles.execFileCalls`. */
  trackExecFileCalls?: boolean;
};

function defaultSpawnProc(): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  proc.stdout = new EventEmitter() as ChildProcess["stdout"];
  proc.stderr = new EventEmitter() as ChildProcess["stderr"];
  proc.stdin = new EventEmitter() as ChildProcess["stdin"];
  (proc as unknown as Record<string, unknown>).pid = 99999;
  (proc as unknown as Record<string, unknown>).unref = () => {};
  (proc as unknown as Record<string, unknown>).kill = () => true;
  process.nextTick(() => proc.emit("spawn"));
  process.nextTick(() => proc.emit("exit", 0));
  process.nextTick(() => proc.emit("close", 0));
  return proc;
}

/** Factory for `vi.mock("child_process", …)` that stubs execFile/spawn via `handles`. */
export function childProcessVitestMockFactory(
  handles: ChildProcessTestHandles,
  options: ChildProcessMockOptions = {},
) {
  const { includeSpawn = false, trackExecFileCalls = false } = options;

  return async (importOriginal: () => Promise<typeof import("child_process")>) => {
    const actual = await importOriginal();

    function mockExecFile(...execArgs: unknown[]): unknown {
      const lastArg = execArgs[execArgs.length - 1];
      if (typeof lastArg === "function") {
        lastArg(null, "", "");
        return undefined;
      }
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(...execArgs);
    }

    (mockExecFile as unknown as Record<symbol, unknown>)[PROMISIFY_CUSTOM] = (...args: unknown[]) => {
      if (trackExecFileCalls) handles.execFileCalls.push(args);
      if (handles.execFileImpl) return handles.execFileImpl(...args);
      return Promise.resolve({ stdout: "", stderr: "" });
    };

    function mockSpawn(...spawnArgs: unknown[]): ChildProcess {
      if (handles.spawnImpl) return handles.spawnImpl(...spawnArgs) as ChildProcess;
      return defaultSpawnProc();
    }

    return {
      ...actual,
      execFile: mockExecFile as typeof actual.execFile,
      ...(includeSpawn ? { spawn: mockSpawn as typeof actual.spawn } : {}),
    };
  };
}
