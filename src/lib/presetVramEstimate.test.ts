import { describe, expect, it } from "vitest";
import { estimateVramForCatalogPreset } from "@/lib/presetVramEstimate";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

const catalogItem = (repoPath: string, device = "CUDA"): RecipeCatalogItem => ({
  name: repoPath.split("/").pop() ?? repoPath,
  repoPath,
  device,
  description: "Official microsoft/olive-recipes run config",
  architecture: "Other",
});

const probeWithGpu = (vramMb: number, systemRamGb = 32): HardwareProbeResult =>
  ({
    probedAt: "test",
    platform: { os: "win32", arch: "x64", cpuModel: "test", cpuCores: 8, systemRamGb },
    nvidia: { gpus: [{ name: "Test GPU", vramMb }] },
    detectedProviders: ["CUDAExecutionProvider"],
    recommendedProvider: "CUDAExecutionProvider",
    notes: [],
  }) as HardwareProbeResult;

describe("estimateVramForCatalogPreset fitHint", () => {
  const olmoFp16 = "allenai-Olmo-3-7B-Instruct/cuda/allenai-Olmo-3-7B-Instruct_cuda_fp16.json";
  const olmoFp16Eval = "allenai-Olmo-3-7B-Instruct/cuda/allenai-Olmo-3-7B-Instruct_cuda_fp16_with_eval.json";
  const olmoInt4 = "allenai-Olmo-3-7B-Instruct/cuda/allenai-Olmo-3-7B-Instruct_cuda_int4.json";

  it("warns the same for fp16 siblings when deployed size exceeds GPU VRAM", () => {
    const probe = probeWithGpu(12 * 1024);
    const a = estimateVramForCatalogPreset(catalogItem(olmoFp16), probe);
    const b = estimateVramForCatalogPreset(catalogItem(olmoFp16Eval), probe);
    expect(a.fitHint).toBe("Deployed model may exceed GPU VRAM");
    expect(b.fitHint).toBe(a.fitHint);
    expect(a.inferenceGb).toBeCloseTo(b.inferenceGb, 2);
  });

  it("warns when Olive peak exceeds GPU even if quantized deploy fits", () => {
    const probe = probeWithGpu(12 * 1024);
    const estimate = estimateVramForCatalogPreset(catalogItem(olmoInt4), probe);
    expect(estimate.inferenceGb).toBeLessThan(12);
    expect(estimate.peakRunGb).toBeGreaterThan(12);
    expect(estimate.fitHint).toBe("Peak Olive run may exceed GPU VRAM");
  });

  it("reports deployed size in the summary for quantized presets", () => {
    const probe = probeWithGpu(12 * 1024);
    const estimate = estimateVramForCatalogPreset(catalogItem(olmoInt4), probe);
    expect(estimate.summaryLine).toMatch(/^~3\.3 GB VRAM model/);
    expect(estimate.summaryLine).not.toMatch(/^~13 GB/);
  });

  it("prefers deploy exceed over hybrid-pool messaging for huge models", () => {
    const probe = probeWithGpu(12 * 1024);
    const estimate = estimateVramForCatalogPreset(
      catalogItem("Qwen-Qwen2.5-72B-Instruct/cuda/fp16.json"),
      probe,
    );
    expect(estimate.fitHint).toBe("Deployed model may exceed GPU VRAM");
  });

  it("stays quiet when both deploy and peak fit the GPU", () => {
    const probe = probeWithGpu(24 * 1024);
    const estimate = estimateVramForCatalogPreset(
      catalogItem("microsoft-Phi-3-mini-4k-instruct/cuda/fp16.json"),
      probe,
    );
    expect(estimate.fitHint).toBeNull();
  });

  it("warns CPU recipes when the model footprint exceeds system RAM", () => {
    const probe = probeWithGpu(12 * 1024, 2);
    const estimate = estimateVramForCatalogPreset(
      catalogItem("google-gemma/olive/gemma-3-1b-it_model_builder_cpu_fp32.json", "CPU"),
      probe,
    );
    expect(estimate.usesGpu).toBe(false);
    expect(estimate.inferenceGb).toBeGreaterThan(2);
    expect(estimate.fitHint).toBe("Deployed model may exceed system RAM");
  });

  it("stays quiet for CPU recipes when system RAM is ample", () => {
    const probe = probeWithGpu(12 * 1024, 64);
    const estimate = estimateVramForCatalogPreset(
      catalogItem("google-gemma/olive/gemma-3-1b-it_model_builder_cpu_fp32.json", "CPU"),
      probe,
    );
    expect(estimate.usesGpu).toBe(false);
    expect(estimate.inferenceGb).toBeGreaterThan(12);
    expect(estimate.fitHint).toBeNull();
  });
});
