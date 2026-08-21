import { describe, it, expect } from "vitest";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { getVramModelLabel, getVramModelShortName, estimateVramRequirement } from "@/lib/vramEstimate";
import { baseState } from "@/lib/__tests__/testState";
describe("VRAM panel regression: switch to Local after loading a HF recipe", () => {
  const hfModel = "microsoft/Phi-3.5-mini-instruct";
  // Pin the estimate to FP16 so the comparison against the ~7B FP16
  // placeholder is apples-to-apples (the real DEFAULT_PASSES default is float32).
  const loaded = baseState({
    modelSource: "huggingface",
    hfModelId: hfModel,
    passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
  });
  // Switch the source tab to Local without uploading any files.
  const switched = baseState({
    modelSource: "local",
    localFiles: [],
    hfModelId: hfModel,
    passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
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
    const none = estimateVramRequirement(
      baseState({
        modelSource: "huggingface",
        hfModelId: "",
        passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
      }),
    );
    expect(after.sourceWeightGb).toBeLessThan(none.sourceWeightGb);
  });

  it("switches to local-file sizing once files are uploaded", () => {
    const uploaded = baseState({
      modelSource: "local",
      localFiles: [{ name: "model.safetensors", size: 1 * 1024 ** 3 }],
      hfModelId: hfModel,
    });
    const est = estimateVramRequirement(uploaded);
    expect(est.sourceWeightGb).toBeCloseTo(1, 5);
  });
});
