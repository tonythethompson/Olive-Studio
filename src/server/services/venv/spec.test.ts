/**
 * Unit tests for venv spec constants and family spec generation.
 * Validates the olive-ai 0.13.0 upgrade pins (Requirements 2.1, 2.2, 2.3).
 */
import { describe, it, expect } from "vitest";
import {
  VENV_SPEC_VERSION,
  PINNED_OLIVE_AI_INSTALL,
  getFamilySpec,
} from "./spec.ts";

/**
 * Minimal PEP 440 version-specifier satisfaction check.
 * Supports comma-separated specifiers with operators: >=, <=, >, <, ==, !=, ~=
 */
function satisfiesPep440(specifier: string, version: string): boolean {
  // Strip package name prefix if present (e.g. "olive-ai>=0.12.0,<1")
  const stripped = specifier.replace(/^[a-zA-Z0-9_-]+/, "");
  const clauses = stripped.split(",").map((s) => s.trim());
  const vParts = version.split(".").map(Number);

  for (const clause of clauses) {
    const match = clause.match(/^(>=|<=|>|<|==|!=|~=)(.+)$/);
    if (!match) continue;
    const [, op, target] = match;
    const tParts = target!.split(".").map(Number);

    const cmp = compareParts(vParts, tParts);
    switch (op) {
      case ">=":
        if (cmp < 0) return false;
        break;
      case "<=":
        if (cmp > 0) return false;
        break;
      case ">":
        if (cmp <= 0) return false;
        break;
      case "<":
        if (cmp >= 0) return false;
        break;
      case "==":
        if (cmp !== 0) return false;
        break;
      case "!=":
        if (cmp === 0) return false;
        break;
      case "~=":
        // Compatible release: >=target, <next minor/major
        if (cmp < 0) return false;
        // Upper bound: bump the second-to-last segment
        const upper = [...tParts.slice(0, -1)];
        upper[upper.length - 1]!++;
        if (compareParts(vParts, upper) >= 0) return false;
        break;
    }
  }
  return true;
}

function compareParts(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

describe("venv spec constants", () => {
  it("VENV_SPEC_VERSION is 5", () => {
    expect(VENV_SPEC_VERSION).toBe(5);
  });

  it("PINNED_OLIVE_AI_INSTALL includes olive-ai 0.13.0", () => {
    expect(satisfiesPep440(PINNED_OLIVE_AI_INSTALL, "0.13.0")).toBe(true);
  });

  it("PINNED_OLIVE_AI_INSTALL excludes olive-ai 0.12.0", () => {
    expect(satisfiesPep440(PINNED_OLIVE_AI_INSTALL, "0.12.0")).toBe(false);
  });

  it("PINNED_OLIVE_AI_INSTALL excludes olive-ai 1.0.0", () => {
    expect(satisfiesPep440(PINNED_OLIVE_AI_INSTALL, "1.0.0")).toBe(false);
  });

  it("PINNED_OLIVE_AI_INSTALL excludes olive-ai 0.11.0 (below lower bound)", () => {
    expect(satisfiesPep440(PINNED_OLIVE_AI_INSTALL, "0.11.0")).toBe(false);
  });

  it("PINNED_OLIVE_AI_INSTALL is a valid PEP 440 specifier string", () => {
    // Must start with package name, then have valid PEP 440 clauses
    expect(PINNED_OLIVE_AI_INSTALL).toMatch(
      /^[a-zA-Z0-9_-]+(>=|<=|>|<|==|!=|~=)\d+(\.\d+)*(,(>=|<=|>|<|==|!=|~=)\d+(\.\d+)*)*$/,
    );
  });
});

describe("getFamilySpec oliveInstallArgs", () => {
  it.each(["default", "cuda", "openvino", "qnn"] as const)(
    "%s family oliveInstallArgs includes PINNED_OLIVE_AI_INSTALL",
    (family) => {
      const spec = getFamilySpec(family);
      expect(spec.oliveInstallArgs).toContain(PINNED_OLIVE_AI_INSTALL);
    },
  );

  it.each(["default", "cuda", "openvino", "qnn"] as const)(
    '%s family oliveInstallArgs includes "requests"',
    (family) => {
      const spec = getFamilySpec(family);
      expect(spec.oliveInstallArgs).toContain("requests");
    },
  );

  it.each(["default", "cuda", "openvino", "qnn"] as const)(
    "%s family specVersion equals VENV_SPEC_VERSION",
    (family) => {
      const spec = getFamilySpec(family);
      expect(spec.specVersion).toBe(VENV_SPEC_VERSION);
    },
  );
});
