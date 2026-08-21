import { describe, it, expect } from "vitest";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { estimateVramRequirement } from "@/lib/vramEstimate";
import { baseState } from "@/lib/__tests__/testState";

describe("tiny-gpt2 memory estimate fix", () => {
  it("does not inflate tiny-gpt2 to 26 GB (the reported bug)", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "sshleifer/tiny-gpt2",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float32" },
    });
    const est = estimateVramRequirement(state);
    // Before the fix this was ~26 GB (7B default * 4 bytes FP32).
    // tiny-gpt2 is ~5M params, so the estimate should be well under 1 GB.
    expect(est.sourceWeightGb).toBeLessThan(0.1);
    expect(est.inferenceGb).toBeLessThan(0.1);
    expect(est.peakRunGb).toBeLessThan(0.2);
  });

  it("also works with underscore variant (tiny_gpt2)", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "sshleifer/tiny_gpt2",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float32" },
    });
    const est = estimateVramRequirement(state);
    expect(est.sourceWeightGb).toBeLessThan(0.1);
  });

  it("also works with catalog slug (sshleifer-tiny-gpt2)", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "sshleifer-tiny-gpt2",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float32" },
    });
    const est = estimateVramRequirement(state);
    expect(est.sourceWeightGb).toBeLessThan(0.1);
  });

  it("gpt2 (base/small) estimates ~0.124B params, not 7B", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "gpt2",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
    });
    const est = estimateVramRequirement(state);
    // 0.124B * 2 bytes FP16 ≈ 0.231 GiB
    expect(est.sourceWeightGb).toBeGreaterThan(0.2);
    expect(est.sourceWeightGb).toBeLessThan(0.3);
  });

  it("gpt2-large estimates ~0.774B params, not 7B", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "gpt2-large",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
    });
    const est = estimateVramRequirement(state);
    // 0.774B * 2 bytes FP16 ≈ 1.44 GiB
    expect(est.sourceWeightGb).toBeGreaterThan(1.0);
    expect(est.sourceWeightGb).toBeLessThan(2.0);
  });

  it("still uses 7B default for truly unknown models", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "some-org/some-unknown-model",
      passes: { ...DEFAULT_PASSES, conversionInputTargetTypes: "float16" },
    });
    const est = estimateVramRequirement(state);
    // 7B * 2 bytes FP16 ≈ 13.02 GiB
    expect(est.sourceWeightGb).toBeGreaterThan(12);
    expect(est.sourceWeightGb).toBeLessThan(14);
  });
});
