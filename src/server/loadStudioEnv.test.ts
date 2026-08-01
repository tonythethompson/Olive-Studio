import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyDotenvFile, hydrateProcessEnvFromWindows, readWindowsPersistedEnv } from "./loadStudioEnv";

const TRACKED = ["TEST_OLIVE_GEMINI_KEY", "TEST_OLIVE_OPENROUTER_KEY"] as const;

describe("loadStudioEnv", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of TRACKED) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of TRACKED) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("applyDotenvFile skips empty and placeholder values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olive-env-"));
    const file = path.join(dir, ".env.local");
    fs.writeFileSync(
      file,
      ["TEST_OLIVE_GEMINI_KEY=", 'TEST_OLIVE_OPENROUTER_KEY="your_key_here"', ""].join("\n"),
    );
    process.env.TEST_OLIVE_GEMINI_KEY = "real-from-process";
    applyDotenvFile(file, { overrideUsable: true });
    expect(process.env.TEST_OLIVE_GEMINI_KEY).toBe("real-from-process");
    expect(process.env.TEST_OLIVE_OPENROUTER_KEY).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("applyDotenvFile can override with a real file value", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olive-env-"));
    const file = path.join(dir, ".env.local");
    fs.writeFileSync(file, "TEST_OLIVE_GEMINI_KEY=from-file\n");
    process.env.TEST_OLIVE_GEMINI_KEY = "from-process";
    applyDotenvFile(file, { overrideUsable: true });
    expect(process.env.TEST_OLIVE_GEMINI_KEY).toBe("from-file");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("hydrateProcessEnvFromWindows fills missing process keys from persisted map", () => {
    const exec = vi.fn(() =>
      JSON.stringify({
        TEST_OLIVE_GEMINI_KEY: "from-windows-user",
        TEST_OLIVE_OPENROUTER_KEY: "also-windows",
      }),
    ) as unknown as typeof import("node:child_process").execFileSync;

    process.env.TEST_OLIVE_OPENROUTER_KEY = "already-in-process";
    const filled = hydrateProcessEnvFromWindows([...TRACKED], { exec });
    expect(process.env.TEST_OLIVE_GEMINI_KEY).toBe("from-windows-user");
    expect(process.env.TEST_OLIVE_OPENROUTER_KEY).toBe("already-in-process");
    expect(filled).toEqual(["TEST_OLIVE_GEMINI_KEY"]);
  });

  it("readWindowsPersistedEnv returns {} off Windows", () => {
    if (process.platform === "win32") {
      expect(readWindowsPersistedEnv([])).toEqual({});
      return;
    }
    expect(readWindowsPersistedEnv(["GEMINI_API_KEY"])).toEqual({});
  });
});
