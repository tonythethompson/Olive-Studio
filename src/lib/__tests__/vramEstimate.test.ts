import { describe, it, expect } from "vitest";
import type { UIState, IHVProvider } from "@/types";
import {
  getEffectiveModelSource,
  getVramModelLabel,
  getVramModelShortName,
  estimateVramRequirement,
} from "@/lib/vramEstimate";

const DEFAULT_PASSES = {
  quantization: false,
  quantMethod: "awq",
  quantPrecision: "int4",
  conversion: false,
  conversionFormat: "onnx",
  conversionSourceFormat: "pytorch",
  conversionOpset: 17,
  conversionInputTargetTypes: "fp32",
  pruning: false,
  pruningType: "structured",
  pruningMethod: "omc",
  pruningCriteria: "snip_magnitude",
  pruningSparsity: 0.3,
  peft: false,
  peftMethod: "lora",
  diffusionLora: false,
  splitting: false,
  onnxTransforms: false,
  gptqBlockSize: 128,
  gptqGroupSize: 128,
  gptqDescAct: false,
  awqGroupSize: 128,
  awqDampPercent: 0.45,
  awqSym: true,
  qatQuantPrecision: "int8",
  qatCalibrateMethod: "entropy",
  qatCalibrateSteps: 1000,
  quantPreset: "weighted",
  trustRemoteCode: false,
import { describe, it, expect } from "vitest";
import type { UIState, IHVProvider } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import {
  getEffectiveModelSource,
  getVramModelLabel,
  getVramModelShortName,
  estimateVramRequirement,
} from "@/lib/vramEstimate";

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: { ...DEFAULT_PASSES, ...overrides?.passes },
  } as UIState;
}

describe("getEffectiveModelSource", () => {
  it("prefers the active tab when it has a model", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [{ name: "model.bin", size: 1024 }],
      hfModelId: "microsoft/phi-3",
    });
    expect(getEffectiveModelSource(state)).toBe("local");
  });

  it("falls back to a Hugging Face model when the active Local tab is empty", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [],
      hfModelId: "microsoft/Phi-3.5-mini-instruct",
    });
    expect(getEffectiveModelSource(state)).toBe("huggingface");
  });

  it("falls back to an Azure path when the active Local tab is empty", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [],
      azureModelPath: "azureml://models/m/versions/1",
    });
    expect(getEffectiveModelSource(state)).toBe("azure");
  });

  it("returns null when no source has any model", () => {
    const state = baseState({ modelSource: "local", localFiles: [] });
    expect(getEffectiveModelSource(state)).toBeNull();
  });

  it("is defensive against partial states (missing fields)", () => {
    const partial = { ihvProvider: "cuda", passes: [] } as unknown as UIState;
    expect(getEffectiveModelSource(partial)).toBeNull();
  });
});

describe("VRAM panel regression: switch to Local after loading a HF recipe", () => {
  const hfModel = "microsoft/Phi-3.5-mini-instruct";
  const loaded = baseState({ modelSource: "huggingface", hfModelId: hfModel });
  // Switch the source tab to Local without uploading any files.
  const switched = baseState({
    modelSource: "local",
    localFiles: [],
    hfModelId: hfModel,
  });

  it("keeps showing the loaded model label", () => {
    expect(getVramModelLabel(switched)).toBe(hfModel);
    expect(getVramModelShortName(switched)).toBe("Phi-3.5-mini-instruct");
  });

  it("estimates the loaded model's VRAM, not a generic 7B placeholder", () => {
    const before = estimateVramRequirement(loaded);
    const after = estimateVramRequirement(switched);
    expect(after.sourceWeightGb).toBeCloseTo(before.sourceWeightGb, 5);
    expect(after.inferenceGb).toBeCloseTo(before.inferenceGb, 5);

    // The 7B placeholder (used when truly nothing is selected) is larger than
    // the real ~3.8B Phi-3.5 model at FP16 — the bug inflated to this value.
    const none = estimateVramRequirement(baseState({ modelSource: "huggingface", hfModelId: "" }));
    expect(after.sourceWeightGb).toBeLessThan(none.sourceWeightGb);
  });

  it("switches to local-file sizing once files are uploaded", () => {
    const uploaded = baseState({
      modelSource: "local",
      localFiles: [{ name: "model.safetensors", size: 1 * 1024 ** 3 }],
      hfModelId: hfModel,
    });
    expect(getEffectiveModelSource(uploaded)).toBe("local");
    const est = estimateVramRequirement(uploaded);
    expect(est.sourceWeightGb).toBeCloseTo(1, 5);
  });
});
