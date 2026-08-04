import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { allFamilyScriptsDirs, envForFamily } from "./pathIsolation.ts";
import { getVenvScriptsDir } from "./paths.ts";

describe("pathIsolation", () => {
  it("lists both family Scripts dirs", () => {
    const dirs = allFamilyScriptsDirs();
    expect(dirs.some((d) => d.includes(".venv") && !d.includes(".venvs"))).toBe(true);
    expect(dirs.some((d) => d.includes("cuda"))).toBe(true);
  });

  it("strips default Scripts from inherited PATH when selecting cuda", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const dirs = allFamilyScriptsDirs();
    const defaultScripts = getVenvScriptsDir("default");
    const base = {
      ...process.env,
      [pathKey]: [...dirs, "/usr/bin"].join(sep),
      PYTHONPATH: "/should/be/cleared",
      PYTHONHOME: "/also/cleared",
    };
    const env = envForFamily("cuda", base);
    const parts = (env[pathKey] ?? "").split(sep).filter(Boolean);
    expect(
      parts.some((p) => path.resolve(p).toLowerCase() === path.resolve(defaultScripts).toLowerCase()),
    ).toBe(false);
    expect(parts).toContain("/usr/bin");
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.VIRTUAL_ENV).toBeTruthy();
  });

  it("prepends selected family Scripts when the directory exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-pathiso-"));
    const prevCwd = process.cwd();
    try {
      process.chdir(tmp);
      const scripts = getVenvScriptsDir("default");
      fs.mkdirSync(scripts, { recursive: true });
      const sep = process.platform === "win32" ? ";" : ":";
      const pathKey = process.platform === "win32" ? "Path" : "PATH";
      const env = envForFamily("default", { ...process.env, [pathKey]: "/usr/bin" });
      const parts = (env[pathKey] ?? "").split(sep).filter(Boolean);
      expect(path.resolve(parts[0]!).toLowerCase()).toBe(path.resolve(scripts).toLowerCase());
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
