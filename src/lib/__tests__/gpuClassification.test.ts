import { describe, it, expect } from "vitest";
import { isGpuProvider } from "../vramEstimate";
import { providerToAccelerator } from "../oliveRecipeBuilder";

// ─── isGpuProvider ─────────────────────────────────────────────

describe("isGpuProvider – MIGraphX and DNNL classification", () => {
  it("returns true for MIGraphXExecutionProvider", () => {
    expect(isGpuProvider("MIGraphXExecutionProvider")).toBe(true);
  });

  it("returns false for DnnlExecutionProvider", () => {
    expect(isGpuProvider("DnnlExecutionProvider")).toBe(false);
  });
});

// ─── providerToAccelerator ─────────────────────────────────────

describe("providerToAccelerator – MIGraphX and DNNL mapping", () => {
  it("maps MIGraphXExecutionProvider to gpu device", () => {
    const result = providerToAccelerator("MIGraphXExecutionProvider");
    expect(result).toEqual({
      device: "gpu",
      execution_providers: ["MIGraphXExecutionProvider"],
    });
  });

  it("maps DnnlExecutionProvider to cpu device", () => {
    const result = providerToAccelerator("DnnlExecutionProvider");
    expect(result).toEqual({
      device: "cpu",
      execution_providers: ["DnnlExecutionProvider"],
    });
  });
});

// ─── GPU_PROVIDERS membership (verified via providerToAccelerator) ──

describe("GPU_PROVIDERS membership – indirect verification", () => {
  it("MIGraphXExecutionProvider is in GPU_PROVIDERS (device === gpu)", () => {
    // providerToAccelerator returns device "gpu" only for GPU-class providers (GPU_PROVIDERS).
    expect(providerToAccelerator("MIGraphXExecutionProvider").device).toBe("gpu");
  });

  it("DnnlExecutionProvider is NOT in GPU_PROVIDERS (device === cpu)", () => {
    // Providers not in GPU_PROVIDERS or NPU_PROVIDERS get device "cpu"
    expect(providerToAccelerator("DnnlExecutionProvider").device).toBe("cpu");
  });
});
