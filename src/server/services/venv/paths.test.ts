import { describe, it, expect } from "vitest";
import { getVenvPython, getVenvPip, getVenvScriptsDir, VENV_DIR } from "./paths.ts";

describe("venv paths", () => {
  it("defines VENV_DIR relative to cwd", () => {
    expect(VENV_DIR).toContain(".venv");
  });

  it("getVenvPython returns a path inside VENV_DIR", () => {
    const python = getVenvPython();
    expect(python).toContain(".venv");
    expect(python).toMatch(/python(\.exe)?$/);
  });

  it("getVenvPip returns a path inside VENV_DIR", () => {
    const pip = getVenvPip();
    expect(pip).toContain(".venv");
    expect(pip).toMatch(/pip(\.exe)?$/);
  });

  it("getVenvScriptsDir returns a path inside VENV_DIR", () => {
    const scripts = getVenvScriptsDir();
    expect(scripts).toContain(".venv");
  });
});
