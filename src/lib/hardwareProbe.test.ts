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

describe("mergeDetectedProviders OpenVINO", () => {
  it("detects OpenVINO when hasOpenVinoCompatibleHardware is true (Intel CPU)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: true,
    });
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("detects OpenVINO when hasOpenVino is true (runtime installed)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: true,
      hasOpenVinoCompatibleHardware: false,
    });
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("detects OpenVINO with AMD CPU + Intel Arc GPU scenario", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: true, // Set by Arc GPU detection
    });
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("does not detect OpenVINO without compatible hardware or runtime", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: false,
    });
    expect(detected).not.toContain("OpenVINOExecutionProvider");
  });
});
