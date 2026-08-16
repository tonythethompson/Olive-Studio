import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureMigraphx } from "./migraphx.ts";

// ── Mocks ───────────────────────────────────────────────────────────────────
const execFileAsyncMock = vi.fn();
const pipInstallForFamilyMock = vi.fn();

vi.mock("../shared/exec.ts", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsyncMock(...args),
}));

vi.mock("../shared/pipInstall.ts", () => ({
  pipInstallForFamily: (...args: unknown[]) => pipInstallForFamilyMock(...args),
}));

vi.mock("../venv/pathIsolation.ts", () => ({
  envForFamily: () => ({ PATH: "/fake/bin" }),
}));

vi.mock("../venv/paths.ts", () => ({
  getVenvPython: () => "/fake/.venv/bin/python",
}));

describe("ensureMigraphx", () => {
  let lines: string[];
  const onLine = (line: string) => lines.push(line);
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    lines = [];
    execFileAsyncMock.mockReset();
    pipInstallForFamilyMock.mockReset();
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
    vi.useRealTimers();
  });

  it("rejects non-Linux hosts before doing any work", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const result = await ensureMigraphx(onLine);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Linux");
    expect(pipInstallForFamilyMock).not.toHaveBeenCalled();
  });

  it("rejects non-x64 Linux hosts", async () => {
    Object.defineProperty(process, "arch", { value: "arm64" });
    const result = await ensureMigraphx(onLine);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Linux");
    expect(pipInstallForFamilyMock).not.toHaveBeenCalled();
  });

  it("skips installation when migraphx is already importable (idempotent)", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await ensureMigraphx(onLine);

    expect(result).toEqual({ ok: true });
    expect(pipInstallForFamilyMock).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("already installed"))).toBe(true);
  });

  it("installs migraphx into the default family and verifies the import", async () => {
    // First import fails → install needed.
    execFileAsyncMock
      .mockRejectedValueOnce(new Error("ModuleNotFoundError"))
      // Post-install verification import succeeds.
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    pipInstallForFamilyMock.mockResolvedValue(undefined);

    const result = await ensureMigraphx(onLine);

    expect(result).toEqual({ ok: true });
    expect(pipInstallForFamilyMock).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes("installed ✓"))).toBe(true);
  });

  it("kills the pip install when the 300s timeout elapses", async () => {
    vi.useFakeTimers();
    // First import fails → install needed.
    execFileAsyncMock.mockRejectedValue(new Error("ModuleNotFoundError"));

    let aborted = false;
    pipInstallForFamilyMock.mockImplementation(
      (_family: unknown, _python: unknown, _args: unknown, _onLine: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              aborted = signal.aborted;
              reject(new Error("pip install aborted"));
            },
            { once: true },
          );
        }),
    );

    const pending = ensureMigraphx(onLine);
    await vi.advanceTimersByTimeAsync(300_000);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 300s");
    // The AbortSignal must have reached the pip helper so the process was killed.
    expect(aborted).toBe(true);
  });

  it("reports an error when the pip install fails", async () => {
    execFileAsyncMock.mockRejectedValue(new Error("ModuleNotFoundError"));
    pipInstallForFamilyMock.mockRejectedValue(new Error("network timeout"));

    const result = await ensureMigraphx(onLine);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("MIGraphX installation failed");
    expect(result.error).toContain("network timeout");
  });

  it("reports an error when the package installs but the import still fails", async () => {
    execFileAsyncMock.mockRejectedValue(new Error("ModuleNotFoundError"));
    pipInstallForFamilyMock.mockResolvedValue(undefined);

    const result = await ensureMigraphx(onLine);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("import failed");
  });
});
