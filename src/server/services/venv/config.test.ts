/**
 * Unit coverage for addVenvToUserPath shell-profile targeting (non-Windows).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";

vi.mock("./paths.ts", () => ({
  getVenvScriptsDir: () => "/tmp/olive-studio-test/.venv/bin",
  getVenvPython: () => "/tmp/olive-studio-test/.venv/bin/python",
  getVenvPip: () => "/tmp/olive-studio-test/.venv/bin/pip",
}));

vi.mock("../../config.ts", () => ({
  appConfig: { systemPython: undefined },
}));

import { addVenvToUserPath } from "./config.ts";

const HOME = "/tmp/olive-home-test";
const SCRIPTS = "/tmp/olive-studio-test/.venv/bin";
const RESOLVED = path.resolve(SCRIPTS);
const EXPORT = `export PATH="${RESOLVED}:$PATH"  # olive-studio .venv`;

describe("addVenvToUserPath (unix)", () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.SHELL = "/bin/bash";
    vi.spyOn(os, "homedir").mockReturnValue(HOME);
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p);
      if (s === SCRIPTS || s === RESOLVED) return true;
      if (s === path.join(HOME, ".bash_profile")) return false;
      if (s === path.join(HOME, ".bash_login")) return false;
      if (s === path.join(HOME, ".profile")) return true;
      if (s === path.join(HOME, ".bashrc")) return true;
      return false;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    vi.restoreAllMocks();
  });

  it("does not create ~/.bash_profile when none exists", async () => {
    const append = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    vi.spyOn(fs, "readFileSync").mockReturnValue("");

    const result = await addVenvToUserPath();
    expect(result).toMatchObject({ ok: true, already: false });

    const written = append.mock.calls.map((c) => String(c[0]));
    expect(written).toContain(path.join(HOME, ".profile"));
    expect(written).toContain(path.join(HOME, ".bashrc"));
    expect(written).not.toContain(path.join(HOME, ".bash_profile"));
  });

  it("dedupes on the exact export line, not a bare path substring", async () => {
    const append = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`# note about ${RESOLVED}-old\necho ${RESOLVED}\n`);

    const result = await addVenvToUserPath();
    expect(result).toMatchObject({ ok: true, already: false });
    expect(append).toHaveBeenCalled();
    expect(String(append.mock.calls[0]?.[1])).toContain(EXPORT);
  });

  it("skips append when the exact export line is already present", async () => {
    const append = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    vi.spyOn(fs, "readFileSync").mockReturnValue(`${EXPORT}\n`);

    const result = await addVenvToUserPath();
    expect(result).toMatchObject({ ok: true, already: true });
    expect(append).not.toHaveBeenCalled();
  });
});
