import { describe, it, expect } from "vitest";
import {
  applyMcpDiagnosticToUiState,
  canApplyMcpDiagnostic,
  mapMcpConfigToUiState,
  mapMcpQuirksToUiState,
  matchActionableQuirks,
} from "@/lib/mcpConfigMapping";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState } from "@/types";

const basePasses: UIState["passes"] = { ...DEFAULT_PASSES };

// Helper: call the mapping function with a single config key
function mapSingle(key: string, value: unknown) {
  return mapMcpConfigToUiState({ [key]: value } as Record<string, unknown>, basePasses);
}

describe("mapMcpConfigToUiState", () => {
  // ── precision ────────────────────────────────────────────────────────
  describe("precision", () => {
    it("maps int4 to quantPrecision", () => {
      const { patches } = mapSingle("precision", "int4");
      expect(patches.passes?.quantPrecision).toBe("int4");
    });

    it("maps int8 to quantPrecision", () => {
      const { patches } = mapSingle("precision", "int8");
      expect(patches.passes?.quantPrecision).toBe("int8");
    });

    it("maps fp16 to quantPrecision", () => {
      const { patches } = mapSingle("precision", "fp16");
      expect(patches.passes?.quantPrecision).toBe("fp16");
    });

    it("ignores invalid precision values", () => {
      const { patches } = mapSingle("precision", "fp32");
      expect(patches.passes?.quantPrecision).toBeUndefined();
    });

    it("ignores non-string precision", () => {
      const { patches } = mapSingle("precision", 8);
      expect(patches.passes?.quantPrecision).toBeUndefined();
    });
  });

  // ── quant_mode ───────────────────────────────────────────────────────
  describe("quant_mode", () => {
    it("maps static to ptq", () => {
      const { patches } = mapSingle("quant_mode", "static");
      expect(patches.passes?.quantMethod).toBe("ptq");
    });

    it("ignores non-static quant_mode values", () => {
      const { patches } = mapSingle("quant_mode", "dynamic");
      expect(patches.passes?.quantMethod).toBeUndefined();
    });

    it("ignores non-string quant_mode", () => {
      const { patches } = mapSingle("quant_mode", 42);
      expect(patches.passes?.quantMethod).toBeUndefined();
    });
  });

  // ── sym ──────────────────────────────────────────────────────────────
  describe("sym", () => {
    it("maps true to awqSym", () => {
      const { patches } = mapSingle("sym", true);
      expect(patches.passes?.awqSym).toBe(true);
    });

    it("maps false to awqSym", () => {
      const { patches } = mapSingle("sym", false);
      expect(patches.passes?.awqSym).toBe(false);
    });

    it("ignores non-boolean sym", () => {
      const { patches } = mapSingle("sym", "yes");
      expect(patches.passes?.awqSym).toBeUndefined();
    });
  });

  // ── block_size ───────────────────────────────────────────────────────
  describe("block_size", () => {
    it("maps valid block_size to gptqBlockSize", () => {
      const { patches } = mapSingle("block_size", 64);
      expect(patches.passes?.gptqBlockSize).toBe(64);
    });

    it("ignores zero block_size", () => {
      const { patches } = mapSingle("block_size", 0);
      expect(patches.passes?.gptqBlockSize).toBeUndefined();
    });

    it("ignores negative block_size", () => {
      const { patches } = mapSingle("block_size", -16);
      expect(patches.passes?.gptqBlockSize).toBeUndefined();
    });

    it("ignores non-integer block_size", () => {
      const { patches } = mapSingle("block_size", 64.5);
      expect(patches.passes?.gptqBlockSize).toBeUndefined();
    });

    it("ignores non-number block_size", () => {
      const { patches } = mapSingle("block_size", "128");
      expect(patches.passes?.gptqBlockSize).toBeUndefined();
    });
  });

  // ── group_size ───────────────────────────────────────────────────────
  describe("group_size", () => {
    it("maps to awqGroupSize when quantMethod is awq", () => {
      const passes = { ...basePasses, quantMethod: "awq" as const };
      const { patches } = mapMcpConfigToUiState({ group_size: 32 }, passes);
      expect(patches.passes?.awqGroupSize).toBe(32);
      // gptqGroupSize is preserved from currentPasses (spread), not overwritten
      expect(patches.passes?.gptqGroupSize).toBe(basePasses.gptqGroupSize);
    });

    it("maps to gptqGroupSize when quantMethod is gptq", () => {
      const passes = { ...basePasses, quantMethod: "gptq" as const };
      const { patches } = mapMcpConfigToUiState({ group_size: 64 }, passes);
      expect(patches.passes?.gptqGroupSize).toBe(64);
      // awqGroupSize is preserved from currentPasses (spread), not overwritten
      expect(patches.passes?.awqGroupSize).toBe(basePasses.awqGroupSize);
    });

    it("maps to both when quantMethod is ptq (default)", () => {
      const { patches } = mapSingle("group_size", 128);
      expect(patches.passes?.gptqGroupSize).toBe(128);
      expect(patches.passes?.awqGroupSize).toBe(128);
    });

    it("ignores zero group_size", () => {
      const { patches } = mapSingle("group_size", 0);
      expect(patches.passes?.gptqGroupSize).toBeUndefined();
      expect(patches.passes?.awqGroupSize).toBeUndefined();
    });

    it("ignores non-integer group_size", () => {
      const { patches } = mapSingle("group_size", 32.5);
      expect(patches.passes?.gptqGroupSize).toBeUndefined();
      expect(patches.passes?.awqGroupSize).toBeUndefined();
    });
  });

  // ── damp_percent ─────────────────────────────────────────────────────
  describe("damp_percent", () => {
    it("maps valid damp_percent to awqDampPercent", () => {
      const { patches } = mapSingle("damp_percent", 0.1);
      expect(patches.passes?.awqDampPercent).toBe(0.1);
    });

    it("maps zero damp_percent", () => {
      const { patches } = mapSingle("damp_percent", 0);
      expect(patches.passes?.awqDampPercent).toBe(0);
    });

    it("maps 1.0 damp_percent", () => {
      const { patches } = mapSingle("damp_percent", 1);
      expect(patches.passes?.awqDampPercent).toBe(1);
    });

    it("ignores damp_percent > 1", () => {
      const { patches } = mapSingle("damp_percent", 1.5);
      expect(patches.passes?.awqDampPercent).toBeUndefined();
    });

    it("ignores negative damp_percent", () => {
      const { patches } = mapSingle("damp_percent", -0.1);
      expect(patches.passes?.awqDampPercent).toBeUndefined();
    });

    it("ignores non-number damp_percent", () => {
      const { patches } = mapSingle("damp_percent", "0.1");
      expect(patches.passes?.awqDampPercent).toBeUndefined();
    });
  });

  // ── desc_act ─────────────────────────────────────────────────────────
  describe("desc_act", () => {
    it("maps true to gptqDescAct", () => {
      const { patches } = mapSingle("desc_act", true);
      expect(patches.passes?.gptqDescAct).toBe(true);
    });

    it("maps false to gptqDescAct", () => {
      const { patches } = mapSingle("desc_act", false);
      expect(patches.passes?.gptqDescAct).toBe(false);
    });

    it("ignores non-boolean desc_act", () => {
      const { patches } = mapSingle("desc_act", 1);
      expect(patches.passes?.gptqDescAct).toBeUndefined();
    });
  });

  // ── unmapped keys → logs ────────────────────────────────────────────
  describe("unmapped keys", () => {
    it("logs use_external_data_format and stores conversion override", () => {
      const { logs, patches } = mapSingle("use_external_data_format", true);
      expect(logs.some((l) => l.includes("use_external_data_format"))).toBe(true);
      expect(patches.passRecipeOverrides?.OnnxConversion?.config?.use_external_data_format).toBe(true);
    });

    it("logs alpha as unmapped", () => {
      const { logs } = mapSingle("alpha", 1.5);
      expect(logs.some((l) => l.includes("alpha"))).toBe(true);
      expect(logs.some((l) => l.includes("LoRA"))).toBe(true);
    });
  });

  // ── Nested MCP KB shapes (engine / passes) ──────────────────────────
  describe("nested engine + passes (multi-pass cache overwrite)", () => {
    it("maps engine.cache_dir and pass output_name into UI patches", () => {
      const { patches, logs } = mapMcpConfigToUiState(
        {
          engine: { cache_dir: "~/.cache/olive/experiment_1" },
          passes: {
            OnnxConversion: { output_name: "onnx_model" },
            OnnxQuantization: { output_name: "quant_model" },
          },
        },
        basePasses,
      );

      expect(patches.cacheDir).toBe("~/.cache/olive/experiment_1");
      expect(patches.passRecipeOverrides?.OnnxConversion?.output_name).toBe("onnx_model");
      expect(patches.passRecipeOverrides?.OnnxQuantization?.output_name).toBe("quant_model");
      expect(patches.passes?.conversion).toBe(true);
      expect(patches.passes?.quantization).toBe(true);
      expect(logs.some((l) => l.includes("cache_dir"))).toBe(true);
      expect(logs.some((l) => l.includes("output_name"))).toBe(true);
    });

    it("maps nested pass params into passRecipeOverrides.config", () => {
      const { patches } = mapMcpConfigToUiState(
        {
          passes: {
            OnnxConversion: {
              params: { use_external_data_format: true },
            },
          },
        },
        basePasses,
      );
      expect(patches.passRecipeOverrides?.OnnxConversion?.config?.use_external_data_format).toBe(true);
      expect(patches.passes?.conversion).toBe(true);
    });
  });

  // ── missing / empty config ──────────────────────────────────────────
  describe("edge cases", () => {
    it("returns empty patches and logs for empty config", () => {
      const { patches, logs } = mapMcpConfigToUiState({}, basePasses);
      expect(patches).toEqual({});
      expect(logs).toEqual([]);
    });

    it("preserves existing passes when applying patches", () => {
      const { patches } = mapSingle("precision", "int4");
      expect(patches.passes?.quantization).toBe(basePasses.quantization);
      expect(patches.passes?.conversion).toBe(basePasses.conversion);
    });

    it("handles multiple config keys in a single call", () => {
      const { patches } = mapMcpConfigToUiState({ precision: "int4", sym: true, block_size: 64 }, basePasses);
      expect(patches.passes?.quantPrecision).toBe("int4");
      expect(patches.passes?.awqSym).toBe(true);
      expect(patches.passes?.gptqBlockSize).toBe(64);
    });
  });

  // ── Known quirks auto-apply ─────────────────────────────────────────
  describe("mapMcpQuirksToUiState", () => {
    it("matches Convert Before Quantize and enables conversion", () => {
      const { patches, applied } = mapMcpQuirksToUiState(["Convert Before Quantize"], {
        ...basePasses,
        conversion: false,
        quantization: true,
      });
      expect(applied).toContain("order-convert-first");
      expect(patches.passes?.conversion).toBe(true);
    });

    it("matches Float16 After Quantization and forces float32 when INT quant + fp16 dtype", () => {
      const { patches, applied } = mapMcpQuirksToUiState(["Float16 After Quantization"], {
        ...basePasses,
        quantization: true,
        quantPrecision: "int8",
        conversionInputTargetTypes: "float16",
      });
      expect(applied).toContain("order-float16-last");
      expect(patches.passes?.conversionInputTargetTypes).toBe("float32");
    });

    it("matches Graph Optimize Before Quantization and enables transforms", () => {
      const { patches, applied } = mapMcpQuirksToUiState(["Graph Optimize Before Quantization"], {
        ...basePasses,
        onnxTransforms: false,
      });
      expect(applied).toContain("order-optimize-first");
      expect(patches.passes?.onnxTransforms).toBe(true);
      expect(patches.passes?.conversion).toBe(true);
    });

    it("applyMcpDiagnosticToUiState merges config + quirks", () => {
      const { patches, appliedQuirks } = applyMcpDiagnosticToUiState(
        {
          updated_config: {
            engine: { cache_dir: "~/.cache/olive/experiment_1" },
          },
          relevant_quirks: ["Convert Before Quantize", "Float16 After Quantization"],
        },
        {
          ...basePasses,
          conversion: false,
          quantization: true,
          quantPrecision: "int4",
          conversionInputTargetTypes: "fp16",
        },
      );
      expect(patches.cacheDir).toBe("~/.cache/olive/experiment_1");
      expect(patches.passes?.conversion).toBe(true);
      expect(patches.passes?.conversionInputTargetTypes).toBe("float32");
      expect(appliedQuirks).toContain("order-convert-first");
      expect(appliedQuirks).toContain("order-float16-last");
    });

    it("canApplyMcpDiagnostic is true for quirks-only diagnostics", () => {
      expect(
        canApplyMcpDiagnostic({
          relevant_quirks: ["Convert Before Quantize"],
        }),
      ).toBe(true);
      expect(canApplyMcpDiagnostic({ relevant_quirks: ["Some unrelated tip"] })).toBe(false);
      expect(matchActionableQuirks(["External Data Format"])).toContain("onnx-external-data");
    });
  });
});
