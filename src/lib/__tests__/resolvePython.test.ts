/**
 * resolvePython: first executable candidate wins (no blind python3 fallback).
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { commandOnPath, resolvePython } from "../../../scripts/resolvePython.mjs";

describe("resolvePython", () => {
  const root = "/repo";

  it("returns the first existing venv python", () => {
    const wanted = path.join(root, "olive-mcp-server", ".venv", "bin", "python");
    const existsSync = vi.fn((p: string) => p === wanted);
    expect(
      resolvePython(root, {
        existsSync,
        spawnSync: vi.fn(() => ({ status: 1 })) as never,
        platform: "linux",
      }),
    ).toBe(wanted);
  });

  it("uses python when only python is on PATH", () => {
    const spawnSync = vi.fn((cmd: string) => ({
      status: cmd === "python" ? 0 : 1,
    }));
    expect(
      resolvePython(root, {
        existsSync: () => false,
        spawnSync: spawnSync as never,
        platform: "win32",
      }),
    ).toBe("python");
    expect(spawnSync).toHaveBeenCalledWith(
      "python3",
      ["--version"],
      expect.objectContaining({ shell: true }),
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "python",
      ["--version"],
      expect.objectContaining({ shell: true }),
    );
  });

  it("uses python3 when python3 is on PATH", () => {
    const spawnSync = vi.fn((cmd: string) => ({
      status: cmd === "python3" ? 0 : 1,
    }));
    expect(
      resolvePython(root, {
        existsSync: () => false,
        spawnSync: spawnSync as never,
        platform: "linux",
      }),
    ).toBe("python3");
  });

  it("throws when no candidate is executable", () => {
    expect(() =>
      resolvePython(root, {
        existsSync: () => false,
        spawnSync: vi.fn(() => ({ status: 1 })) as never,
        platform: "linux",
      }),
    ).toThrow(/No Python interpreter found/);
  });
});

describe("commandOnPath", () => {
  it("treats status 0 as present", () => {
    expect(
      commandOnPath("python", {
        spawnSync: vi.fn(() => ({ status: 0 })) as never,
        platform: "linux",
      }),
    ).toBe(true);
  });
});
