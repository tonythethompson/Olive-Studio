/**
 * Regression test: when CUDA promotion fails during the GPU-contaminated venv
 * migration, the migration journal must record the "building" phase (not
 * "cuda_promoted") so recovery does not treat a failed promotion as live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

// Hoist mock functions so they are available inside vi.mock factories.
const { promoteBuildingToLiveMock, familyPythonExistsMock, clearBuildingRootMock } =
  vi.hoisted(() => ({
    promoteBuildingToLiveMock: vi.fn(),
    familyPythonExistsMock: vi.fn(),
    clearBuildingRootMock: vi.fn(),
  }));

// Mock child_process.spawn to simulate successful Python/venv/pip commands.
// Keep execFile and other exports intact for modules that depend on them.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => proc.emit("close", 0));
      return proc;
    }),
  };
});

// Mock ../shared/exec.ts so import checks succeed.
vi.mock("../shared/exec.ts", () => ({
  execFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

// Mock ./promote.ts — promoteBuildingToLive fails for "cuda".
vi.mock("./promote.ts", () => ({
  promoteBuildingToLive: promoteBuildingToLiveMock,
  familyPythonExists: familyPythonExistsMock,
  clearBuildingRoot: clearBuildingRootMock,
  writeVenvManifest: vi.fn(),
  readVenvManifest: vi.fn().mockReturnValue(null),
  rollbackPromotedFamily: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock ./systemPython.ts — return a fake Python path.
vi.mock("./systemPython.ts", () => ({
  findSystemPython: vi.fn().mockResolvedValue("/fake/python"),
  getPythonVersion: vi.fn().mockResolvedValue("3.12.0"),
}));

// Mock ./migration.ts — keep real journal functions, override inspection + lock.
vi.mock("./migration.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./migration.ts")>();
  return {
    ...actual,
    inspectDefaultVenvIntent: vi.fn().mockResolvedValue("cuda-contaminated"),
    withMigrationLock: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  };
});

// Mock ./status.ts.
vi.mock("./status.ts", () => ({
  invalidateRuntimeStatusCache: vi.fn(),
  listInstalledOrtDistributions: vi.fn().mockResolvedValue(["onnxruntime-gpu"]),
}));

import { ensureVenvFamily } from "./familyEnsure.ts";
import { readMigrationJournal, clearMigrationJournal } from "./migration.ts";

describe("migrateGpuContaminatedVenv — CUDA promotion failure", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-migrate-cuda-"));
    prevCwd = process.cwd();
    process.chdir(tmp);

    // CUDA family does not exist → cudaNeedsBuild = true.
    familyPythonExistsMock.mockReturnValue(false);
    // CUDA promotion fails; default promotion would succeed but is never reached.
    promoteBuildingToLiveMock.mockImplementation(async (family: string) => {
      if (family === "cuda") {
        return { ok: false, error: "Simulated CUDA promotion failure" };
      }
      return { ok: true, backupPath: undefined };
    });
    clearBuildingRootMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("records the journal phase as 'building' (not 'cuda_promoted') when CUDA promotion fails", async () => {
    const onLine = vi.fn();
    const result = await ensureVenvFamily("default", onLine);

    // Migration should fail.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Simulated CUDA promotion failure");

    // Journal must be "building" — NOT "cuda_promoted".
    const journal = readMigrationJournal();
    expect(journal).not.toBeNull();
    expect(journal!.phase).toBe("building");
    expect(journal!.error).toContain("Simulated CUDA promotion failure");

    clearMigrationJournal();
  });
});
