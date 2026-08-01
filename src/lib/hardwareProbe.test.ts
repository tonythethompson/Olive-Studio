import { describe, expect, it } from "vitest";
import { mergeDetectedProviders, pickRecommendedProvider } from "@/lib/hardwareProbe";

describe("mergeDetectedProviders TensorRT", () => {
  it("marks classic TensorRT as detected on NVIDIA GPU even before SDK install", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: true,
    });
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).toContain("TensorrtExecutionProvider");
    expect(detected).toContain("NvTensorRTRTXExecutionProvider");
  });

  it("does not recommend uninstalled classic TensorRT over CUDA", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: false,
    });
    expect(pickRecommendedProvider(detected, { tensorRtLoadable: false, tensorRtRtxLoadable: false })).toBe(
      "CUDAExecutionProvider",
    );
  });

  it("prefers loadable TensorRT RTX when present", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: true,
    });
    expect(pickRecommendedProvider(detected, { tensorRtRtxLoadable: true, tensorRtLoadable: false })).toBe(
      "NvTensorRTRTXExecutionProvider",
    );
  });
});
