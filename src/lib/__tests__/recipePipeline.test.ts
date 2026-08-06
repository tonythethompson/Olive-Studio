import { describe, it, expect } from "vitest";
import {
  buildRecipeFromState,
  parseRecipeJson,
  buildRecipeJsonFromState,
  buildOliveRecipeFromBatchJob,
  projectUiStateToRecipeEvaluation,
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
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
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
    expect(result).toHaveProperty("localExecutionIssues");
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
    openvinoTargetDevice: "CPU",
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

// ─── projectUiStateToRecipeEvaluation (MCP / studio-recipe bridge) ─

describe("projectUiStateToRecipeEvaluation", () => {
  /** Stable payload keys for the MCP bridge contract (camelCase, JSON-safe). */
  const EVALUATION_KEYS = [
    "effectiveState",
    "recipe",
    "schemaErrors",
    "pipelineIssues",
    "criticalCount",
    "warningCount",
    "isBlocked",
    "advisories",
    "localExecutionIssues",
    "warnings",
    "isRunnable",
  ] as const;

  // ✅ Positive: clean GPU config projects a full runnable evaluation payload
  it("returns the stable UiStateRecipeEvaluation shape for a clean GPU config", () => {
    // Arrange
    const state = baseState();

    // Act
    const result = projectUiStateToRecipeEvaluation(state);

    // Assert — lock payload keys for MCP Python consumers
    for (const key of EVALUATION_KEYS) {
      expect(result).toHaveProperty(key);
    }
    expect(result.isBlocked).toBe(false);
    expect(result.isRunnable).toBe(true);
    expect(result.schemaErrors).toEqual([]);
    expect(result.criticalCount).toBe(0);
    expect(Array.isArray(result.pipelineIssues)).toBe(true);
    expect(Array.isArray(result.advisories)).toBe(true);
    expect(Array.isArray(result.localExecutionIssues)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.recipe).toHaveProperty("input_model");
    expect(result.recipe).toHaveProperty("engine");
    expect(result.recipe).toHaveProperty("passes");
    expect(result.recipe).toHaveProperty("systems");
    expect(result.effectiveState.hfModelId).toBe(state.hfModelId);
  });

  // ✅ Positive: projection matches buildRecipeFromState (single source of truth)
  it("mirrors buildRecipeFromState recipe, counts, and runnability", () => {
    // Arrange
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider" as IHVProvider,
      passes: { ...DEFAULT_PASSES, quantization: true, quantMethod: "awq", quantPrecision: "int4" },
    });

    // Act
    const built = buildRecipeFromState(state);
    const projected = projectUiStateToRecipeEvaluation(state);

    // Assert
    expect(projected.recipe).toEqual(built.recipe);
    expect(projected.effectiveState).toEqual(built.state);
    expect(projected.isRunnable).toBe(built.isRunnable);
    expect(projected.isBlocked).toBe(built.validation.isBlocked);
    expect(projected.criticalCount).toBe(built.validation.criticalCount);
    expect(projected.warningCount).toBe(built.validation.warningCount);
    expect(projected.schemaErrors).toEqual([...built.schema.errors]);
    expect(projected.pipelineIssues).toEqual([...built.validation.issues]);
    expect(projected.advisories).toEqual([...built.advisories]);
    expect(projected.localExecutionIssues).toEqual([...built.localExecutionIssues]);
    expect(projected.warnings).toEqual(
      built.validation.issues.filter((issue) => issue.severity === "warning"),
    );
  });

  // ✅ Positive: payload is plain JSON (no functions / circular refs)
  it("produces a JSON-serializable payload without custom replacers", () => {
    // Arrange
    const result = projectUiStateToRecipeEvaluation(baseState());

    // Act
    const json = JSON.stringify(result);
    const roundTrip = JSON.parse(json) as typeof result;

    // Assert
    expect(roundTrip.isRunnable).toBe(result.isRunnable);
    expect(roundTrip.recipe).toEqual(result.recipe);
    expect(roundTrip.effectiveState.ihvProvider).toBe(result.effectiveState.ihvProvider);
    expect(roundTrip.pipelineIssues).toEqual(result.pipelineIssues);
  });

  // ✅ Positive: sanitization is reflected in effectiveState
  it("exposes sanitized effectiveState (e.g. OpenVINO format coerced on non-OpenVINO EP)", () => {
    // Arrange
    const state = baseState({
      ihvProvider: "CPUExecutionProvider" as IHVProvider,
      passes: { ...DEFAULT_PASSES, conversion: true, conversionFormat: "openvino" },
    });

    // Act
    const result = projectUiStateToRecipeEvaluation(state);

    // Assert
    expect(result.effectiveState.passes.conversionFormat).toBe("onnx");
  });

  // ❌ Negative: blocked pipeline still returns recipe + structured critical issues
  it("returns recipe plus structured issues when the pipeline is blocked", () => {
    // Arrange — Whisper model with a non-ASR task is a critical runtime issue (no autofix)
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "openai/whisper-tiny",
      hfTask: "text-generation",
      ihvProvider: "CPUExecutionProvider" as IHVProvider,
    });

    // Act
    const result = projectUiStateToRecipeEvaluation(state);

    // Assert — evaluation succeeds as data; caller decides not to run Olive
    expect(result.isBlocked).toBe(true);
    expect(result.isRunnable).toBe(false);
    expect(result.criticalCount).toBeGreaterThan(0);
    expect(result.pipelineIssues.some((i) => i.severity === "critical")).toBe(true);
    expect(result.pipelineIssues.some((i) => i.id === "hf-task-whisper-mismatch")).toBe(true);
    expect(result.recipe).toBeDefined();
    expect(result.recipe).toHaveProperty("input_model");
    expect(result.recipe).toHaveProperty("passes");
    // Still JSON-safe for the bridge
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  // ❌ Negative: WebGPU is not locally runnable (local-execution issues)
  it("marks WebGPU configs non-runnable with localExecutionIssues", () => {
    // Arrange
    const state = baseState({
      ihvProvider: "WebGpuExecutionProvider" as IHVProvider,
    });

    // Act
    const result = projectUiStateToRecipeEvaluation(state);

    // Assert
    expect(result.isRunnable).toBe(false);
    expect(result.localExecutionIssues.length).toBeGreaterThan(0);
    expect(
      result.localExecutionIssues.some((i) => i.id === "webgpu-local-execution-unsupported"),
    ).toBe(true);
    expect(result.recipe).toHaveProperty("systems");
  });

  // ❌ Negative: returned issue arrays are defensive copies
  it("returns defensive copies of issue arrays (mutation does not leak)", () => {
    // Arrange
    const result = projectUiStateToRecipeEvaluation(baseState());
    const originalIssueLen = result.pipelineIssues.length;
    const originalAdvisoryLen = result.advisories.length;

    // Act — mutate projected arrays
    result.pipelineIssues.push({
      id: "test-mutation",
      severity: "critical",
      title: "mutated",
      description: "should not affect a fresh projection",
    });
    result.advisories.push({
      id: "test-adv",
      severity: "warning",
      title: "mutated",
      description: "should not affect a fresh projection",
    });
    result.schemaErrors.push("mutated-schema-error");

    // Assert — fresh projection is unaffected
    const fresh = projectUiStateToRecipeEvaluation(baseState());
    expect(fresh.pipelineIssues).toHaveLength(originalIssueLen);
    expect(fresh.advisories).toHaveLength(originalAdvisoryLen);
    expect(fresh.schemaErrors).not.toContain("mutated-schema-error");
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
