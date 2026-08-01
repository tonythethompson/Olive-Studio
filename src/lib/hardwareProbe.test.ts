import { describe, expect, it } from "vitest";
import { mergeDetectedProviders, pickRecommendedProvider } from "@/lib/hardwareProbe";

describe("mergeDetectedProviders TensorRT", () => {
  it("does not infer classic TensorRT until the runtime probe succeeds", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: true,
    });
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).not.toContain("TensorrtExecutionProvider");
    expect(detected).toContain("NvTensorRTRTXExecutionProvider");
  });

  it("includes classic TensorRT when the runtime probe succeeds", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: true,
      tensorRtRtxLoadable: false,
    });
    expect(detected).toContain("TensorrtExecutionProvider");
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
