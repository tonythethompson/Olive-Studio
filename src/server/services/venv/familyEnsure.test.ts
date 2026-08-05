import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVenvAt } from "./familyEnsure.ts";

describe("createVenvAt", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-create-venv-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects when systemPython points to an invalid executable", async () => {
    const root = path.join(tmp, ".venvs", "default.building");
    await expect(
      createVenvAt(root, path.join(tmp, "python-does-not-exist"), () => undefined),
    ).rejects.toThrow();
    expect(fs.existsSync(root)).toBe(false);
  });
});
