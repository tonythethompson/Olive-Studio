import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = vi.fn();
const findSystemPython = vi.fn();
const writeStudioConfig = vi.fn();

vi.mock("./config.ts", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsync(...args),
}));
vi.mock("../../config.ts", () => ({
  writeStudioConfig: (...args: unknown[]) => writeStudioConfig(...args),
}));
vi.mock("./systemPython.ts", () => ({
  findSystemPython: (...args: unknown[]) => findSystemPython(...args),
}));
vi.mock("./status.ts", () => ({
  invalidateRuntimeStatusCache: vi.fn(),
}));
vi.mock("./pythonGuard.ts", () => ({
  resolveAllowedPythonFile: (p: string) =>
    p.includes("\\") || p.startsWith("/") ? { ok: true as const, path: p } : { ok: false as const, error: "rel" },
}));

import { installSystemPython } from "./installPython.ts";

function stubPlatform(value: NodeJS.Platform): () => void {
  const desc = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value });
  return () => {
    if (desc) Object.defineProperty(process, "platform", desc);
  };
}

describe("installSystemPython", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses winget on Windows and persists the discovered interpreter", async () => {
    const restore = stubPlatform("win32");
    findSystemPython.mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\Python312\\python.exe");
    execFileAsync.mockResolvedValue({ stdout: "ok", stderr: "" });
    const lines: string[] = [];

    const result = await installSystemPython((line) => lines.push(line));
    restore();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("winget");
    expect(execFileAsync).toHaveBeenCalledWith(
      "winget",
      expect.arrayContaining(["--id", "Python.Python.3.12"]),
      expect.any(Object),
    );
    expect(writeStudioConfig).toHaveBeenCalledWith({ systemPython: "C:\\Python312\\python.exe" });
    expect(lines.some((l) => /winget/i.test(l))).toBe(true);
  });

  it("falls back to pymanager when winget fails", async () => {
    const restore = stubPlatform("win32");
    findSystemPython.mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\Users\\me\\AppData\\Local\\Python\\python.exe");
    execFileAsync.mockRejectedValueOnce(new Error("winget missing"));
    execFileAsync.mockResolvedValueOnce({ stdout: "ok", stderr: "" });
    const result = await installSystemPython(() => undefined);
    restore();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("pymanager");
    expect(execFileAsync).toHaveBeenCalledWith("pymanager", ["install", "3.12"], expect.any(Object));
  });

  it("returns a package-manager command on Linux and does not spawn apt", async () => {
    const restore = stubPlatform("linux");
    findSystemPython.mockResolvedValue(null);
    const result = await installSystemPython(() => undefined);
    restore();

    expect(result.ok).toBe(false);
    expect(result.method).toBe("manual");
    expect(result.command).toMatch(/apt|dnf|pacman|zypper|apk/);
    expect(execFileAsync).not.toHaveBeenCalled();
  });
});
