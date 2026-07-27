/**
 * Inventory: every olive-mcp-server quirks.json title vs UI matchActionableQuirks.
 * Ensures auto-fixable quirks are noted/matched by title (MCP returns titles only).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { applyMcpDiagnosticToUiState, matchActionableQuirks } from "@/lib/mcpConfigMapping";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";

const kbPath = resolve(process.cwd(), "olive-mcp-server/olive_mcp_server/knowledge_base/quirks.json");

type Quirk = { id: string; title: string; description: string };
type Kb = { categories: Record<string, Quirk[]> };

const kb = JSON.parse(readFileSync(kbPath, "utf8")) as Kb;

const ALL: Array<Quirk & { category: string }> = Object.entries(kb.categories).flatMap(([category, items]) =>
  items.map((q) => ({ ...q, category })),
);

/** Quirks we intentionally treat as auto-fixable in the UI. */
const EXPECTED_ACTIONABLE = new Set([
  "order-convert-first",
  "order-float16-last",
  "order-optimize-first",
  "onnx-external-data",
  "onnx-opset",
  "calib-symmetric",
  "calib-per-channel",
  "lora-qlora",
]);

/** Quirks that are advisory-only (no safe automatic pipeline patch). */
const EXPECTED_ADVISORY = new Set([
  "calib-static-vs-dynamic",
  "calib-size",
  "onnx-dynamic-axes",
  "onnx-type-cast",
  "lora-base-frozen",
  "lora-rank",
  "ep-fallback",
  "qnn-whitelist",
]);

describe("MCP quirks.json coverage vs Apply Fix matchers", () => {
  it("loads all 16 quirks from olive-mcp-server", () => {
    expect(ALL.length).toBe(16);
    expect(new Set([...EXPECTED_ACTIONABLE, ...EXPECTED_ADVISORY]).size).toBe(16);
  });

  it("matches every expected actionable quirk by title alone (MCP returns titles)", () => {
    const missed: string[] = [];
    for (const q of ALL) {
      if (!EXPECTED_ACTIONABLE.has(q.id)) continue;
      const matched = matchActionableQuirks([q.title]);
      if (matched.length === 0) missed.push(`${q.id} title="${q.title}"`);
    }
    expect(missed).toEqual([]);
  });

  it("does not false-positive advisory-only quirk titles", () => {
    const falsePositives: string[] = [];
    for (const q of ALL) {
      if (!EXPECTED_ADVISORY.has(q.id)) continue;
      const matched = matchActionableQuirks([q.title]);
      if (matched.length > 0) falsePositives.push(`${q.id} -> ${matched.join(",")}`);
    }
    expect(falsePositives).toEqual([]);
  });

  it("applies multi-pass diagnostic quirks that MCP returns (full categories)", () => {
    // After MCP fix: all quirks from pass_ordering + quantization + onnx_export
    const mcpReturnedTitles = ALL.filter((q) =>
      ["pass_ordering", "quantization", "onnx_export"].includes(q.category),
    ).map((q) => q.title);

    expect(mcpReturnedTitles).toContain("Graph Optimize Before Quantization");
    expect(mcpReturnedTitles).toContain("External Data Format");
    expect(mcpReturnedTitles).toContain("Symmetric vs Asymmetric Quantization");

    const matched = matchActionableQuirks(mcpReturnedTitles);
    expect(matched).toContain("order-convert-first");
    expect(matched).toContain("order-float16-last");
    expect(matched).toContain("order-optimize-first");
    expect(matched).toContain("onnx-opset");
    expect(matched).toContain("onnx-external-data");
    expect(matched).toContain("calib-per-channel");
    expect(matched).toContain("calib-symmetric");

    const { appliedQuirks, patches } = applyMcpDiagnosticToUiState(
      {
        updated_config: {
          engine: { cache_dir: "~/.cache/olive/experiment_1" },
          passes: {
            OnnxConversion: { output_name: "onnx_model" },
            OnnxQuantization: { output_name: "quant_model" },
          },
        },
        relevant_quirks: mcpReturnedTitles,
      },
      {
        ...DEFAULT_PASSES,
        conversion: false,
        quantization: true,
        quantPrecision: "int8",
        conversionInputTargetTypes: "float16",
        conversionOpset: 20,
        onnxTransforms: false,
      },
    );

    expect(patches.cacheDir).toBe("~/.cache/olive/experiment_1");
    expect(patches.passes?.conversion).toBe(true);
    expect(patches.passes?.onnxTransforms).toBe(true);
    expect(patches.passes?.conversionInputTargetTypes).toBe("float32");
    expect(patches.passRecipeOverrides?.OnnxConversion?.config?.use_external_data_format).toBe(true);
    expect(appliedQuirks.length).toBeGreaterThan(0);
  });

  it("inventory table: every quirk is either actionable or advisory (noted)", () => {
    const rows = ALL.map((q) => {
      const matched = matchActionableQuirks([q.title]);
      const bucket = EXPECTED_ACTIONABLE.has(q.id)
        ? "actionable"
        : EXPECTED_ADVISORY.has(q.id)
          ? "advisory"
          : "UNCLASSIFIED";
      return {
        id: q.id,
        title: q.title,
        category: q.category,
        bucket,
        matcherHit: matched,
      };
    });

    const unclassified = rows.filter((r) => r.bucket === "UNCLASSIFIED");
    const actionableMiss = rows.filter((r) => r.bucket === "actionable" && r.matcherHit.length === 0);

    // Print for humans reading vitest output
    // eslint-disable-next-line no-console
    console.table(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        bucket: r.bucket,
        matched: r.matcherHit.join("|") || "—",
      })),
    );

    expect(unclassified).toEqual([]);
    expect(actionableMiss).toEqual([]);
  });
});
