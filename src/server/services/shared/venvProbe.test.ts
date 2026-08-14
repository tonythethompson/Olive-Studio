import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsyncMock = vi.fn();

vi.mock("./exec.ts", () => ({
  execFileAsync: (...args: unknown[]) => execFileAsyncMock(...args),
}));

import { getInstalledModuleVersion, getModuleLibsDir } from "./venvProbe.ts";

const PROBE_TIMEOUT = 30_000;

let tmpRoot: string;

beforeEach(() => {
  execFileAsyncMock.mockReset();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "venv-probe-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("getInstalledModuleVersion", () => {
  it("returns the trimmed module version with a timeout", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "10.3.0\n", stderr: "" });
    await expect(getInstalledModuleVersion("/venv/python", "tensorrt")).resolves.toBe("10.3.0");
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "/venv/python",
      [
        "-c",
        "import importlib; m = importlib.import_module(\"tensorrt\"); print(getattr(m, \"__version__\"))",
      ],
      { timeout: PROBE_TIMEOUT },
    );
  });

  it("honors a custom attribute", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "1234", stderr: "" });
    await expect(
      getInstalledModuleVersion("/venv/python", "tensorrt_rtx", "__build__"),
    ).resolves.toBe("1234");
  });

  it("returns null on blank output", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "  \n", stderr: "" });
    await expect(getInstalledModuleVersion("/venv/python", "tensorrt")).resolves.toBeNull();
  });

  it("returns null when the module is missing (probe throws)", async () => {
    execFileAsyncMock.mockRejectedValue(new Error("Command failed"));
    await expect(getInstalledModuleVersion("/venv/python", "tensorrt")).resolves.toBeNull();
  });
});

describe("getModuleLibsDir", () => {
  it("returns the libs dir when it exists on disk", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: `${tmpRoot}\n`, stderr: "" });
    await expect(getModuleLibsDir("/venv/python", "tensorrt_libs")).resolves.toBe(tmpRoot);
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "/venv/python",
      ["-c", "import os, tensorrt_libs; print(os.path.dirname(tensorrt_libs.__file__))"],
      { timeout: PROBE_TIMEOUT },
    );
  });

  it("returns null when the printed dir does not exist", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: `${tmpRoot}/nope\n`, stderr: "" });
    await expect(getModuleLibsDir("/venv/python", "tensorrt_libs")).resolves.toBeNull();
  });

  it("returns null when the probe fails", async () => {
    execFileAsyncMock.mockRejectedValue(new Error("Command failed"));
    await expect(getModuleLibsDir("/venv/python", "tensorrt_libs")).resolves.toBeNull();
  });
});
