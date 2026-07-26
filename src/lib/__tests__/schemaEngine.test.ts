import { describe, it, expect, afterEach } from "vitest";
import {
  isKnownPass,
  getPassSchema,
  validatePassConfig,
  validateRecipeSchema,
  reloadPassSchemas,
  getKbMetadata,
} from "@/lib/schemaEngine";
import originalPassesJson from "../../../olive-mcp-server/olive_mcp_server/knowledge_base/passes.json";

// ─── isKnownPass ─────────────────────────────────────────────────────────────

describe("isKnownPass", () => {
  it("returns true for passes in the TS catalog", () => {
    expect(isKnownPass("OnnxConversion")).toBe(true);
    expect(isKnownPass("OnnxQuantization")).toBe(true);
  });

  it("returns true for passes in the MCP knowledge base", () => {
    expect(isKnownPass("OnnxDynamicQuantization")).toBe(true);
    expect(isKnownPass("OrtSessionParamsTuning")).toBe(true);
  });

  it("returns false for unknown pass types", () => {
    expect(isKnownPass("BogusPass")).toBe(false);
    expect(isKnownPass("")).toBe(false);
  });
});

// ─── getPassSchema ───────────────────────────────────────────────────────────

describe("getPassSchema", () => {
  it("returns unified schema for a known pass", () => {
    const schema = getPassSchema("OnnxConversion");
    expect(schema).toBeDefined();
    expect(schema!.name).toBe("OnnxConversion");
    expect(schema!.category).toBe("onnx");
    expect(schema!.params).toBeDefined();
    expect(schema!.params.target_opset).toBeDefined();
    expect(schema!.params.target_opset.type).toBe("int");
  });

  it("returns undefined for an unknown pass", () => {
    expect(getPassSchema("BogusPass")).toBeUndefined();
  });

  it("includes parameter schemas from the MCP knowledge base", () => {
    const schema = getPassSchema("OnnxQuantization");
    expect(schema).toBeDefined();
    expect(schema!.params.quant_format).toBeDefined();
    expect(schema!.params.quant_format.enum).toEqual(["QOperator", "QDQ"]);
    expect(schema!.params.per_channel.type).toBe("bool");
  });

  it("includes hardware requirements", () => {
    const schema = getPassSchema("OnnxQuantization");
    expect(schema!.hardwareRequirements).toContain("CPUExecutionProvider");
    expect(schema!.hardwareRequirements).toContain("CUDAExecutionProvider");
  });
});

// ─── validatePassConfig ──────────────────────────────────────────────────────

describe("validatePassConfig", () => {
  it("returns no errors for a valid config", () => {
    const errors = validatePassConfig("OnnxConversion", { target_opset: 17 });
    expect(errors).toEqual([]);
  });

  it("returns no errors for undefined config", () => {
    const errors = validatePassConfig("OnnxConversion", undefined);
    expect(errors).toEqual([]);
  });

  it("returns no errors for null config", () => {
    const errors = validatePassConfig("OnnxConversion", null);
    expect(errors).toEqual([]);
  });

  it("returns error for non-object config", () => {
    const errors = validatePassConfig("OnnxConversion", "not-an-object");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must be an object");
  });

  it("detects wrong type for int parameter", () => {
    const errors = validatePassConfig("OnnxConversion", { target_opset: "17" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("target_opset"))).toBe(true);
  });

  it("detects wrong type for bool parameter", () => {
    const errors = validatePassConfig("OnnxConversion", { do_constant_folding: "yes" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("do_constant_folding"))).toBe(true);
  });

  it("detects invalid enum value", () => {
    const errors = validatePassConfig("OnnxQuantization", { quant_format: "Invalid" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("quant_format"))).toBe(true);
    expect(errors.some((e) => e.includes("QOperator"))).toBe(true);
  });

  it("accepts valid enum value", () => {
    const errors = validatePassConfig("OnnxQuantization", { quant_format: "QDQ" });
    expect(errors).toEqual([]);
  });

  it("returns no errors for unknown pass type", () => {
    const errors = validatePassConfig("BogusPass", { foo: "bar" });
    expect(errors).toEqual([]);
  });

  it("returns no errors for unknown config keys (extra params are allowed)", () => {
    const errors = validatePassConfig("OnnxConversion", { unknown_param: "value" });
    expect(errors).toEqual([]);
  });

  it("validates list[str] type", () => {
    const errors = validatePassConfig("OnnxConversion", { input_names: ["input1", "input2"] });
    expect(errors).toEqual([]);
  });

  it("detects wrong list[str] type", () => {
    const errors = validatePassConfig("OnnxConversion", { input_names: [1, 2] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("input_names"))).toBe(true);
  });
});

// ─── validateRecipeSchema ────────────────────────────────────────────────────

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

describe("validateRecipeSchema", () => {
  it("accepts a fully valid recipe", () => {
    const r = validateRecipeSchema(validRecipe());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects non-object recipe", () => {
    expect(validateRecipeSchema(null).valid).toBe(false);
    expect(validateRecipeSchema("string").valid).toBe(false);
    expect(validateRecipeSchema(42).valid).toBe(false);
    expect(validateRecipeSchema([]).valid).toBe(false);
  });

  it("rejects recipe missing input_model", () => {
    const r = validateRecipeSchema({ systems: {}, passes: {}, engine: { host: "a", target: "b" } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("input_model"))).toBe(true);
  });

  it("rejects unknown pass type", () => {
    const r = validateRecipeSchema(
      validRecipe({
        passes: { quant: { type: "BogusPass", config: {} } },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("BogusPass"))).toBe(true);
  });

  it("validates pass config parameters", () => {
    const r = validateRecipeSchema(
      validRecipe({
        passes: {
          conversion: {
            type: "OnnxConversion",
            config: { target_opset: "not-a-number" },
          },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("target_opset"))).toBe(true);
  });

  it("validates pass config enum values", () => {
    const r = validateRecipeSchema(
      validRecipe({
        passes: {
          quant: {
            type: "OnnxQuantization",
            config: { quant_format: "InvalidFormat" },
          },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("quant_format"))).toBe(true);
  });

  it("rejects engine with invalid host reference", () => {
    const r = validateRecipeSchema(validRecipe({ engine: { host: "nonexistent", target: "local_system" } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("not a valid system key"))).toBe(true);
  });

  it("rejects system with empty accelerators", () => {
    const r = validateRecipeSchema(
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
    expect(r.errors.some((e) => e.includes("accelerators"))).toBe(true);
  });

  it("accepts recipe with valid pass configs", () => {
    const r = validateRecipeSchema(
      validRecipe({
        passes: {
          conv: { type: "OnnxConversion", config: { target_opset: 20 } },
          quant: { type: "OnnxQuantization", config: { quant_format: "QDQ", per_channel: true } },
        },
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("accepts pass with no config", () => {
    const r = validateRecipeSchema(
      validRecipe({
        passes: { split: { type: "SplitModel" } },
      }),
    );
    expect(r.valid).toBe(true);
  });
});

// ─── reloadPassSchemas & getKbMetadata ────────────────────────────────────────

describe("getKbMetadata", () => {
  it("returns metadata with version, lastUpdated, and passCount", () => {
    const meta = getKbMetadata();
    expect(meta).toBeDefined();
    expect(typeof meta.version).toBe("string");
    expect(typeof meta.lastUpdated).toBe("string");
    expect(typeof meta.passCount).toBe("number");
    expect(meta.passCount).toBeGreaterThan(0);
  });
});

describe("reloadPassSchemas", () => {
  afterEach(() => {
    // Restore original KB after each reload test
    reloadPassSchemas(originalPassesJson as never);
  });

  it("hot-reloads parameter schemas from a new passes.json object", () => {
    // Verify a custom pass doesn't exist before reload
    expect(isKnownPass("CustomTestPass")).toBe(false);

    // Reload with a custom pass added
    reloadPassSchemas({
      passes: [
        {
          name: "CustomTestPass",
          type: "test",
          description: "A test pass for hot-reload verification.",
          input_formats: ["onnx"],
          output_formats: ["onnx"],
          required_params: [],
          optional_params: {
            precision: {
              type: "str",
              default: "fp16",
              enum: ["fp16", "int8"],
              description: "Output precision.",
            },
          },
          hardware_requirements: ["CPUExecutionProvider"],
          gotchas: ["This is a test pass."],
        },
      ],
    });

    // Now the custom pass should be known
    expect(isKnownPass("CustomTestPass")).toBe(true);
    const schema = getPassSchema("CustomTestPass");
    expect(schema).toBeDefined();
    expect(schema!.params.precision.enum).toEqual(["fp16", "int8"]);

    // Validate config against the reloaded schema
    const errors = validatePassConfig("CustomTestPass", { precision: "invalid" });
    expect(errors.some((e) => e.includes("precision"))).toBe(true);

    const validErrors = validatePassConfig("CustomTestPass", { precision: "fp16" });
    expect(validErrors).toEqual([]);
  });

  it("removes KB-only passes after reload with empty data", () => {
    // Add a custom KB-only pass
    reloadPassSchemas({
      passes: [
        {
          name: "KbOnlyTestPass",
          type: "test",
          description: "KB-only test pass.",
          input_formats: [],
          output_formats: [],
          required_params: [],
          optional_params: {},
          hardware_requirements: [],
          gotchas: [],
        },
      ],
    });
    expect(isKnownPass("KbOnlyTestPass")).toBe(true);

    // Reload with empty — KB-only pass should be gone
    reloadPassSchemas({ passes: [] });
    expect(isKnownPass("KbOnlyTestPass")).toBe(false);

    // TS catalog passes should still be known
    expect(isKnownPass("OnnxConversion")).toBe(true);
  });
});
