import { describe, it, expect } from "vitest";
import { mapMcpConfigToUiState } from "@/lib/mcpConfigMapping";
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
    it("logs use_external_data_format", () => {
      const { logs } = mapSingle("use_external_data_format", true);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("use_external_data_format");
      expect(logs[0]).toContain("true");
    });

    it("logs alpha as unmapped", () => {
      const { logs } = mapSingle("alpha", 1.5);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("alpha");
      expect(logs[0]).toContain("LoRA");
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
});
