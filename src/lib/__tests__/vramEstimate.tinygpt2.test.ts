import { describe, it, expect } from "vitest";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { estimateVramRequirement } from "@/lib/vramEstimate";
import { baseState } from "@/lib/__tests__/testState";

// Every GPT-2 branch inferParamBillions recognizes, plus the unknown-model
// fallback. dtype drives the bytes-per-param multiplier (float32 -> 4, float16 -> 2).
const cases = [
  { id: "sshleifer/tiny-gpt2", paramsB: 0.005, confidence: "medium", dtype: "float32" },
  { id: "sshleifer/tiny_gpt2", paramsB: 0.005, confidence: "medium", dtype: "float32" },
  { id: "sshleifer-tiny-gpt2", paramsB: 0.005, confidence: "medium", dtype: "float32" },
  { id: "distilgpt2/distilgpt2", paramsB: 0.082, confidence: "low", dtype: "float16" },
  { id: "openai-community/gpt2", paramsB: 0.124, confidence: "low", dtype: "float16" },
  { id: "openai-community/gpt2-medium", paramsB: 0.355, confidence: "low", dtype: "float16" },
  { id: "openai-community/gpt2_large", paramsB: 0.774, confidence: "low", dtype: "float16" },
  { id: "openai-community/gpt2-xl", paramsB: 1.5, confidence: "low", dtype: "float16" },
  // Hyphenated spellings are normalized to the same gpt2 token.
  { id: "openai-community/gpt-2", paramsB: 0.124, confidence: "low", dtype: "float16" },
  { id: "flax-community/gpt-2-medium", paramsB: 0.355, confidence: "low", dtype: "float16" },
  { id: "flax-community/gpt_2_large", paramsB: 0.774, confidence: "low", dtype: "float16" },
  // Truly unknown ids still fall through to the 7B default.
  { id: "some-org/some-unknown-model", paramsB: 7, confidence: "low", dtype: "float16" },
];

describe("tiny-gpt2 memory estimate fix", () => {
  it("does not inflate tiny-gpt2 to ~26 GB (issue #387)", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "sshleifer/tiny-gpt2",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float32" },
    });
    const est = estimateVramRequirement(state);
    // tiny-gpt2 is ~5M params, so the FP32 estimate stays well under 1 GB.
    expect(est.sourceWeightGb).toBeLessThan(0.1);
    expect(est.inferenceGb).toBeLessThan(0.1);
    expect(est.peakRunGb).toBeLessThan(0.2);
  });

  it.each(cases)("$id infers ~$paramsB B params (not 7B)", ({ id, paramsB, confidence, dtype }) => {
    const bytesPerParam = dtype === "float32" ? 4 : 2;
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: id,
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: dtype },
    });
    const est = estimateVramRequirement(state);
    const expectedGb = (paramsB * 1e9 * bytesPerParam) / 1024 ** 3;
    expect(est.sourceWeightGb).toBeCloseTo(expectedGb, 3);
    expect(est.confidence).toBe(confidence);
  });
});
