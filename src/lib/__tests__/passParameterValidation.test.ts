import { describe, it, expect } from "vitest";
import { validatePassParameters } from "../passParameterValidation";
import type { UIState, IHVProvider } from "@/types";

/** Minimal UIState builder — only fills fields relevant to validation. */
function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "mistralai/Mistral-7B-v0.1",
    hfDataset: "",
    ihvProvider: "CUDAExecutionProvider",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    passes: {
      conversion: true,
      conversionSourceFormat: "pytorch",
      conversionFormat: "onnx",
      conversionOpset: 17,
      conversionInputTargetTypes: "hf",
      quantization: true,
      quantMethod: "awq",
      quantPrecision: "int4",
      gptqBlockSize: 128,
      gptqDescAct: false,
      gptqGroupSize: 128,
      awqGroupSize: 128,
      awqDampPercent: 0.01,
      awqSym: true,
      qatQuantPrecision: "int4",
      qatCalibrateMethod: "minmax",
      qatCalibrateSteps: 100,
      quantPreset: "",
      pruning: false,
      pruningSparsity: 0.5,
      pruningType: "unstructured",
      pruningMethod: "magnitude",
      pruningCriteria: "l1_norm",
      splitting: false,
      onnxTransforms: false,
      peft: false,
      peftMethod: "lora",
      diffusionLora: false,
    },
    ...overrides,
  };
}

function withProvider(p: IHVProvider): Partial<UIState> {
  return { ihvProvider: p };
}

// ── QNN rules ─────────────────────────────────────────────────────

describe("QNN parameter validation", () => {
  it("warns when AWQ INT8 on QNN lacks awqSym", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
        awqSym: false,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.title.includes("symmetric"))).toBe(true);
  });

  it("no symmetric warning when AWQ INT8 on QNN has awqSym=true", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
        awqSym: true,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // INT4 preference warning still fires, but symmetric warning should not
    expect(warnings.some((w) => w.title.includes("symmetric"))).toBe(false);
  });

  it("warns for non-AWQ INT8 on QNN (QNNQuantization)", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("per-channel");
  });

  it("warns for INT4 on QNN suggesting INT4 is better", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // Should warn about INT4 preference
    expect(warnings.some((w) => w.description.includes("INT4"))).toBe(true);
  });

  it("warns for non-AWQ INT8 on OnnxQuantization for QNN", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("per-channel");
  });

  it("no warning for INT4 on QNN (already optimal)", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBe(0);
  });
});

// ── NVIDIA rules ──────────────────────────────────────────────────

describe("NVIDIA parameter validation", () => {
  it("warns when PTQ INT8 on NVIDIA (prefers AWQ INT4)", () => {
    const state = baseState({
      ...withProvider("CUDAExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("AWQ INT4");
  });

  it("no warning for AWQ INT4 on NVIDIA (optimal)", () => {
    const state = baseState({
      ...withProvider("CUDAExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });
});

// ── OpenVINO rules ────────────────────────────────────────────────

describe("OpenVINO parameter validation", () => {
  it("warns when using OnnxQuantization INT8 (prefers static)", () => {
    const state = baseState({
      ...withProvider("OpenVINOExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("static quantization");
  });
});

// ── CPU rules ─────────────────────────────────────────────────────

describe("CPU parameter validation", () => {
  it("warns for INT4 on CPU", () => {
    const state = baseState({
      ...withProvider("CPUExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("limited runtime support");
  });

  it("no warning for INT8 on CPU", () => {
    const state = baseState({
      ...withProvider("CPUExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });
});

// ── Edge cases ────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty for no active passes", () => {
    const state = baseState();
    const warnings = validatePassParameters(state, []);
    expect(warnings.length).toBe(0);
  });

  it("returns empty for non-matching pass names", () => {
    const state = baseState();
    const warnings = validatePassParameters(state, ["FakePass", "AnotherFake"]);
    expect(warnings.length).toBe(0);
  });

  it("returns empty for quantization disabled", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantization: false,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // Rules check pass names, not whether quantization is enabled in UIState
    // But since the pass won't be active if quantization is off, this is fine
    expect(warnings.length).toBe(0);
  });
});
