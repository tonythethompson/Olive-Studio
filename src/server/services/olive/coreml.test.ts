import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureCoremltools } from "./coreml.ts";

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

describe("ensureCoremltools", () => {
  let lines: string[];
  const onLine = (line: string) => lines.push(line);

  beforeEach(() => {
    lines = [];
    execFileAsyncMock.mockReset();
    pipInstallForFamilyMock.mockReset();
  });

  it("skips installation when coremltools is already installed (idempotent)", async () => {
    // pip show succeeds → package already present
    execFileAsyncMock.mockResolvedValue({ stdout: "Name: coremltools\nVersion: 7.2\n", stderr: "" });

    const result = await ensureCoremltools(onLine);

    expect(result).toEqual({ ok: true });
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "/fake/.venv/bin/python",
      ["-m", "pip", "show", "coremltools"],
      expect.objectContaining({ timeout: 30_000 }),
    );
    // pip install should NOT have been called
    expect(pipInstallForFamilyMock).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("already installed"))).toBe(true);
  });

  it("installs coremltools when not already present", async () => {
    // pip show fails → not installed
    execFileAsyncMock.mockRejectedValue(new Error("exit code 1"));
    // pip install succeeds
    pipInstallForFamilyMock.mockResolvedValue(undefined);

    const result = await ensureCoremltools(onLine);

    expect(result).toEqual({ ok: true });
    expect(pipInstallForFamilyMock).toHaveBeenCalledWith(
      "default",
      "/fake/.venv/bin/python",
      ["coremltools"],
      onLine,
    );
    expect(lines.some((l) => l.includes("Installing coremltools"))).toBe(true);
    expect(lines.some((l) => l.includes("installed ✓"))).toBe(true);
  });

  it("returns error when pip install fails", async () => {
    // pip show fails → not installed
    execFileAsyncMock.mockRejectedValue(new Error("exit code 1"));
    // pip install also fails
    pipInstallForFamilyMock.mockRejectedValue(new Error("network timeout"));

    const result = await ensureCoremltools(onLine);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("coremltools installation failed");
    expect(result.error).toContain("network timeout");
    expect(lines.some((l) => l.includes("Installing coremltools"))).toBe(true);
  });
});
