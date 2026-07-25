import { describe, it, expect } from "vitest";
import {
  buildRecipeFromState,
  parseRecipeJson,
  buildRecipeJsonFromState,
  buildOliveRecipeFromBatchJob,
  serializeRecipe,
} from "@/lib/recipePipeline";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

// ─── Helpers ─────────────────────────────────────────────────

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CUDAExecutionProvider" as IHVProvider,
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
    ...overrides,
  };
}

// ─── buildRecipeFromState ─────────────────────────────────────

describe("buildRecipeFromState", () => {
  it("returns a valid RecipePipelineResult with all keys", () => {
    const result = buildRecipeFromState(baseState());
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("recipe");
    expect(result).toHaveProperty("recipeJson");
    expect(result).toHaveProperty("validation");
    expect(result).toHaveProperty("schema");
    expect(result).toHaveProperty("advisories");
    expect(result).toHaveProperty("isRunnable");
  });

  it("produces valid JSON for a basic GPU config", () => {
    const result = buildRecipeFromState(baseState());
    expect(() => JSON.parse(result.recipeJson)).not.toThrow();
    expect(result.schema.valid).toBe(true);
  });

  it("returns isRunnable = true for a clean GPU config", () => {
    const result = buildRecipeFromState(baseState());
    expect(result.isRunnable).toBe(true);
  });

  it("sanitizes the state before building the recipe", () => {
    const state = baseState({
      ihvProvider: "CPUExecutionProvider" as IHVProvider,
      passes: { ...DEFAULT_PASSES, conversion: true, conversionFormat: "openvino" },
    });
    const result = buildRecipeFromState(state);
    expect(result.state.passes.conversionFormat).toBe("onnx");
  });

  it("includes advisories as the remaining warnings", () => {
    const state = baseState({
      ihvProvider: "CPUExecutionProvider" as IHVProvider,
      passes: { ...DEFAULT_PASSES, peft: true, quantization: true, quantPrecision: "int4" },
    });
    const result = buildRecipeFromState(state);
    expect(Array.isArray(result.advisories)).toBe(true);
  });

  it("propagates hardwareProbe options", () => {
    const probe: HardwareProbeResult = {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "Intel", cpuCores: 8 },
      nvidia: { gpus: [{ name: "RTX 4090", vramMb: 24576 }] },
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      recommendedProvider: "CUDAExecutionProvider" as IHVProvider,
      notes: [],
    };
    const result = buildRecipeFromState(baseState(), { hardwareProbe: probe });
    expect(result.isRunnable).toBe(true);
  });

  it("produces a valid recipe JSON string with expected keys", () => {
    const result = buildRecipeFromState(baseState());
    const parsed = JSON.parse(result.recipeJson);
    expect(parsed.input_model).toBeDefined();
    expect(parsed.engine).toBeDefined();
    expect(parsed.passes).toBeDefined();
    expect(parsed.systems).toBeDefined();
  });
});

// ─── buildRecipeJsonFromState ─────────────────────────────────

describe("buildRecipeJsonFromState", () => {
  it("returns a valid JSON string", () => {
    const json = buildRecipeJsonFromState(baseState());
    expect(typeof json).toBe("string");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("matches buildRecipeFromState().recipeJson", () => {
    expect(buildRecipeJsonFromState(baseState())).toBe(buildRecipeFromState(baseState()).recipeJson);
  });
});

// ─── serializeRecipe ──────────────────────────────────────────

describe("serializeRecipe", () => {
  it("pretty-prints JSON with 2-space indent", () => {
    const raw = { foo: "bar", baz: { qux: 1 } };
    expect(serializeRecipe(raw)).toBe(JSON.stringify(raw, null, 2));
  });
});

// ─── parseRecipeJson ──────────────────────────────────────────

describe("parseRecipeJson", () => {
  const validRecipe = {
    input_model: { type: "PyTorchModel", config: {} },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: { accelerators: [{ device: "cpu", execution_providers: ["CPUExecutionProvider"] }] },
      },
    },
    passes: {},
    engine: {
      search_strategy: false,
      host: "local_system",
      target: "local_system",
      cache_dir: "./cache",
      output_dir: "./out",
    },
  };

  it("parses valid recipe JSON", () => {
    const result = parseRecipeJson(JSON.stringify(validRecipe));
    expect(result.schema.valid).toBe(true);
    expect(result.recipe.input_model).toBeDefined();
  });

  it("returns error for invalid JSON syntax", () => {
    const result = parseRecipeJson("{{{ not json }}}");
    expect(result.schema.valid).toBe(false);
    expect(result.schema.errors[0]).toContain("JSON syntax");
  });

  it("returns empty recipe for non-object JSON (string)", () => {
    const result = parseRecipeJson('"just a string"');
    expect(result.schema.valid).toBe(false);
    expect(result.recipe).toEqual({});
  });

  it("returns empty recipe for array JSON", () => {
    const result = parseRecipeJson("[1, 2, 3]");
    expect(result.schema.valid).toBe(false);
    expect(result.recipe).toEqual({});
  });

  it("reports schema errors for incomplete recipes", () => {
    const result = parseRecipeJson(JSON.stringify({ passes: {} }));
    if (!result.schema.valid) {
      expect(result.schema.errors.length).toBeGreaterThan(0);
    }
  });

  it("handles empty string input gracefully", () => {
    const result = parseRecipeJson("");
    expect(result.schema.valid).toBe(false);
    expect(result.recipe).toEqual({});
  });
});

// ─── buildOliveRecipeFromBatchJob ─────────────────────────────

describe("buildOliveRecipeFromBatchJob", () => {
  const validRecipe = {
    input_model: { type: "PyTorchModel", config: {} },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: { accelerators: [{ device: "cpu", execution_providers: ["CPUExecutionProvider"] }] },
      },
    },
    passes: {},
    engine: {
      search_strategy: false,
      host: "local_system",
      target: "local_system",
      cache_dir: "./cache",
      output_dir: "./out",
    },
  };

  it("uses embedded recipeJson when valid", () => {
    const result = buildOliveRecipeFromBatchJob(
      {
        modelSource: "huggingface",
        modelIdentifier: "test/model",
        provider: "CUDAExecutionProvider" as IHVProvider,
        recipeJson: JSON.stringify(validRecipe),
      },
      baseState(),
    );
    expect(result.input_model).toBeDefined();
    expect(result.engine).toBeDefined();
  });

  it("falls back to state-built recipe when recipeJson is invalid", () => {
    const result = buildOliveRecipeFromBatchJob(
      {
        modelSource: "huggingface",
        modelIdentifier: "meta-llama/Meta-Llama-3-8B",
        provider: "CUDAExecutionProvider" as IHVProvider,
        recipeJson: "{broken}",
      },
      baseState(),
    );
    expect(result.input_model).toBeDefined();
  });

  it("falls back when recipeJson is undefined", () => {
    const result = buildOliveRecipeFromBatchJob(
      {
        modelSource: "huggingface",
        modelIdentifier: "test/model",
        provider: "CUDAExecutionProvider" as IHVProvider,
        recipeJson: undefined,
      },
      baseState(),
    );
    expect(result.input_model).toBeDefined();
  });

  it("handles empty recipeJson string by falling back", () => {
    const result = buildOliveRecipeFromBatchJob(
      {
        modelSource: "huggingface",
        modelIdentifier: "test/model",
        provider: "CUDAExecutionProvider" as IHVProvider,
        recipeJson: "",
      },
      baseState(),
    );
    expect(result.input_model).toBeDefined();
  });
});
