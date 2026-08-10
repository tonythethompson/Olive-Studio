import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PASS_CATALOG, OLIVE_VERSION } from "./passCatalog";
import { collectTelemetry } from "./issueReport";

// ── Load passes.json for cross-check ─────────────────────────────────────────

const passesJsonPath = resolve(import.meta.dirname, "../../olive-mcp-server/olive_mcp_server/knowledge_base/passes.json");
const passesJson = JSON.parse(readFileSync(passesJsonPath, "utf8")) as { passes: unknown[] };

// ── OLIVE_VERSION ────────────────────────────────────────────────────────────

describe("OLIVE_VERSION", () => {
  it("equals '0.13.0'", () => {
    expect(OLIVE_VERSION).toBe("0.13.0");
  });
});

// ── collectOliveVersion (via collectTelemetry) ───────────────────────────────

describe("collectOliveVersion", () => {
  it("contains 'Olive: 0.13.0'", () => {
    const telemetry = collectTelemetry(["olive-version"], {});
    expect(telemetry["olive-version"]).toContain("Olive: 0.13.0");
  });
});

// ── PASS_CATALOG length matches passes.json ──────────────────────────────────

describe("PASS_CATALOG consistency with passes.json", () => {
  it("has the same number of entries as passes.json", () => {
    expect(PASS_CATALOG.length).toBe(passesJson.passes.length);
  });
});

// ── PASS_CATALOG entry completeness ──────────────────────────────────────────

describe("PASS_CATALOG entry completeness", () => {
  it("every entry has a non-empty name", () => {
    for (const entry of PASS_CATALOG) {
      expect(entry.name, `entry at index ${PASS_CATALOG.indexOf(entry)}`).toBeTruthy();
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid category", () => {
    const validCategories = [
      "onnx", "pytorch", "intel", "nvidia", "openvino", "qnn",
      "pruning", "peft", "splitting", "validation", "other",
    ];
    for (const entry of PASS_CATALOG) {
      expect(validCategories, `invalid category "${entry.category}" for pass "${entry.name}"`).toContain(entry.category);
    }
  });

  it("every entry has a non-empty description", () => {
    for (const entry of PASS_CATALOG) {
      expect(entry.description, `pass "${entry.name}" has empty description`).toBeTruthy();
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("every entry has non-empty inputs array", () => {
    for (const entry of PASS_CATALOG) {
      expect(entry.inputs, `pass "${entry.name}" has empty inputs`).toBeDefined();
      expect(entry.inputs.length, `pass "${entry.name}" has no inputs`).toBeGreaterThan(0);
    }
  });

  it("every entry has non-empty outputs array", () => {
    for (const entry of PASS_CATALOG) {
      expect(entry.outputs, `pass "${entry.name}" has empty outputs`).toBeDefined();
      expect(entry.outputs.length, `pass "${entry.name}" has no outputs`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate pass names", () => {
    const names = PASS_CATALOG.map((e) => e.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
