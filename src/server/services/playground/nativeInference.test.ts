import { describe, it, expect } from "vitest";
import path from "path";
import { isSafeVenvPython } from "./nativeInference.ts";
import { getVenvPython } from "../venv/paths.ts";
import { getFamilyRoot } from "../venv/spec.ts";
import type { VenvFamily } from "../../../lib/venvFamily.ts";

const SCRIPT_BIN = process.platform === "win32" ? "Scripts" : "bin";

describe("isSafeVenvPython", () => {
  it("accepts the derived python path for every venv family", () => {
    for (const family of ["default", "cuda", "openvino", "qnn"] as const) {
      expect(isSafeVenvPython(getVenvPython(family), family)).toBe(true);
    }
  });

  it("accepts a versioned interpreter basename inside the family root", () => {
    const root = getFamilyRoot("default");
    const versioned = process.platform === "win32" ? "python3.12.exe" : "python3.12";
    expect(isSafeVenvPython(path.join(root, SCRIPT_BIN, versioned), "default")).toBe(true);
  });

  it("rejects an unknown venv family", () => {
    expect(isSafeVenvPython(getVenvPython("default"), "bogus" as VenvFamily)).toBe(false);
  });

  it("rejects a path escaping the family root via .. traversal", () => {
    const root = getFamilyRoot("default");
    const escaped = path.join(root, "..", SCRIPT_BIN, "python");
    expect(isSafeVenvPython(escaped, "default")).toBe(false);
  });

  it("rejects a sibling directory that only shares the root prefix", () => {
    const root = getFamilyRoot("default");
    const sibling = path.join(`${root}-evil`, SCRIPT_BIN, "python");
    expect(isSafeVenvPython(sibling, "default")).toBe(false);
  });

  it("rejects a non-python basename", () => {
    const root = getFamilyRoot("default");
    expect(isSafeVenvPython(path.join(root, SCRIPT_BIN, "node"), "default")).toBe(false);
  });

  it("rejects an absolute path.relative result (Windows cross-drive)", () => {
    if (process.platform !== "win32") return;
    expect(isSafeVenvPython("D:\\evil\\python.exe", "default")).toBe(false);
  });
});