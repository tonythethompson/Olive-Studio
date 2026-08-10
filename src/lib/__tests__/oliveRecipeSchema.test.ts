import { describe, it, expect, beforeAll } from "vitest";
import { validateOliveRecipeStructure, assertValidOliveRecipeStructure } from "@/lib/oliveRecipeSchema";
import { kbReady } from "@/lib/schemaEngine";

// Ensure KB is loaded before synchronous validation tests run
beforeAll(async () => {
  await kbReady().catch(() => undefined);
});

// ─── Minimal valid recipe ────────────────────────────────────

function validRecipe(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    input_model: { type: "PyTorchModel", config: {} },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: {
          accelerators: [{ device: "cpu", execution_providers: ["CPUExecutionProvider"] }],
        },
      },
    },
    passes: {
      conversion: {
        type: "OnnxConversion",
        config: { target_opset: 20 },
      },
    },
    engine: {
      search_strategy: false,
      host: "local_system",
      target: "local_system",
      cache_dir: "./cache",
      output_dir: "./out",
    },
    ...overrides,
  };
}

// ─── Top-level structure ─────────────────────────────────────

describe("validateOliveRecipeStructure", () => {
  it("accepts a fully valid recipe", () => {
    const r = validateOliveRecipeStructure(validRecipe());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects non-object recipe", () => {
    expect(validateOliveRecipeStructure(null).valid).toBe(false);
    expect(validateOliveRecipeStructure("string").valid).toBe(false);
    expect(validateOliveRecipeStructure(42).valid).toBe(false);
    expect(validateOliveRecipeStructure([]).valid).toBe(false);
  });

  it("rejects recipe missing input_model", () => {
    const r = validateOliveRecipeStructure({ systems: {}, passes: {}, engine: { host: "a", target: "b" } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("input_model"))).toBe(true);
  });

  it("rejects recipe missing systems", () => {
    const r = validateOliveRecipeStructure(validRecipe({ systems: undefined }));
    // systems must be an object → errors
    expect(r.valid).toBe(false);
  });

  it("rejects recipe missing passes", () => {
    const r = validateOliveRecipeStructure(validRecipe({ passes: undefined }));
    expect(r.valid).toBe(false);
  });

  it("rejects recipe missing engine", () => {
    const r = validateOliveRecipeStructure(validRecipe({ engine: undefined }));
    expect(r.valid).toBe(false);
  });

  // ── input_model ───────────────────────────────────────────

  describe("input_model validation", () => {
    it("rejects input_model without type", () => {
      const r = validateOliveRecipeStructure(validRecipe({ input_model: { config: {} } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("input_model.type"))).toBe(true);
    });

    it("rejects input_model with empty type string", () => {
      const r = validateOliveRecipeStructure(validRecipe({ input_model: { type: "", config: {} } }));
      expect(r.valid).toBe(false);
    });

    it("rejects input_model without config", () => {
      const r = validateOliveRecipeStructure(validRecipe({ input_model: { type: "PyTorchModel" } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("input_model.config"))).toBe(true);
    });

    it("rejects input_model with non-object config", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({ input_model: { type: "PyTorchModel", config: "invalid" } }),
      );
      expect(r.valid).toBe(false);
    });
  });

  // ── passes ────────────────────────────────────────────────

  describe("passes validation", () => {
    it("accepts empty passes object", () => {
      const r = validateOliveRecipeStructure(validRecipe({ passes: {} }));
      expect(r.valid).toBe(true);
    });

    it("rejects pass with non-object value", () => {
      const r = validateOliveRecipeStructure(validRecipe({ passes: { quant: "string instead of object" } }));
      expect(r.valid).toBe(false);
    });

    it("rejects pass without type string", () => {
      const r = validateOliveRecipeStructure(validRecipe({ passes: { quant: { config: {} } } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("passes.quant.type"))).toBe(true);
    });

    it("rejects pass with non-object config", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          passes: { quant: { type: "OnnxQuantization", config: "not-an-object" } },
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("passes.quant.config"))).toBe(true);
    });

    it("accepts pass without config (undefined config is ok)", () => {
      const r = validateOliveRecipeStructure(validRecipe({ passes: { split: { type: "SplitModel" } } }));
      expect(r.valid).toBe(true);
    });

    it("validates multiple passes", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          passes: {
            conv: { type: "OnnxConversion", config: { target_opset: 20 } },
            quant: { type: "OnnxQuantization", config: { precision: "int8" } },
          },
        }),
      );
      expect(r.valid).toBe(true);
    });
  });

  // ── engine ────────────────────────────────────────────────

  describe("engine validation", () => {
    it("rejects engine without host", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({ engine: { target: "local", cache_dir: ".", output_dir: "." } }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("engine.host"))).toBe(true);
    });

    it("rejects engine without target", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({ engine: { host: "local", cache_dir: ".", output_dir: "." } }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("engine.target"))).toBe(true);
    });

    it("rejects host that does not reference a valid system key", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({ engine: { host: "nonexistent_system", target: "local_system" } }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("not a valid system key"))).toBe(true);
    });

    it("rejects target that does not reference a valid system key", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({ engine: { host: "local_system", target: "bogus_target" } }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("not a valid system key"))).toBe(true);
    });
  });

  // ── systems → accelerators ────────────────────────────────

  describe("system accelerators validation", () => {
    it("rejects system without config", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
    });

    it("rejects accelerators as non-array", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: { accelerators: "not-an-array" },
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
    });

    it("rejects empty accelerators array", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: { accelerators: [] },
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("non-empty array"))).toBe(true);
    });

    it("rejects accelerator without device", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: {
                accelerators: [{ execution_providers: ["CPUExecutionProvider"] }],
              },
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("accelerators[0].device"))).toBe(true);
    });

    it("rejects accelerator with empty execution_providers", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: {
                accelerators: [{ device: "cpu", execution_providers: [] }],
              },
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
    });

    it("rejects accelerator with non-object entry", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: {
                accelerators: ["string-instead-of-object"],
              },
            },
          },
        }),
      );
      expect(r.valid).toBe(false);
    });
  });

  // ── assertValidOliveRecipeStructure ────────────────────────

  describe("assertValidOliveRecipeStructure", () => {
    it("does not throw for a valid recipe", () => {
      expect(() => assertValidOliveRecipeStructure(validRecipe())).not.toThrow();
    });

    it("throws for an invalid recipe", () => {
      expect(() => assertValidOliveRecipeStructure({})).toThrow("Invalid Olive recipe structure");
    });

    it("throws with first failing field in message", () => {
      expect(() => assertValidOliveRecipeStructure({ passes: {} })).toThrow("input_model");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("accepts multiple accelerators", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            local_system: {
              type: "LocalSystem",
              config: {
                accelerators: [
                  { device: "gpu", execution_providers: ["CUDAExecutionProvider"] },
                  { device: "cpu", execution_providers: ["CPUExecutionProvider"] },
                ],
              },
            },
          },
        }),
      );
      expect(r.valid).toBe(true);
    });

    it("accepts multiple system entries (host with different target)", () => {
      const r = validateOliveRecipeStructure(
        validRecipe({
          systems: {
            host_system: {
              type: "LocalSystem",
              config: {
                accelerators: [{ device: "gpu", execution_providers: ["CUDAExecutionProvider"] }],
              },
            },
            target_system: {
              type: "LocalSystem",
              config: {
                accelerators: [{ device: "cpu", execution_providers: ["CPUExecutionProvider"] }],
              },
            },
          },
          engine: { host: "host_system", target: "target_system" },
        }),
      );
      expect(r.valid).toBe(true);
    });

    it("rejects recipe with no engine properties", () => {
      const r = validateOliveRecipeStructure({
        input_model: { type: "PyTorchModel", config: {} },
        systems: {},
        passes: {},
        engine: {},
      });
      expect(r.valid).toBe(false);
    });
  });
});
