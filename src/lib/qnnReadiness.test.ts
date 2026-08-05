import { describe, expect, it } from "vitest";
import {
  assessQnnRecipeReadiness,
  isQnnSdkBackedPass,
  isUnresolvedDynamicDim,
  modelIoHasUnresolvedDynamicShapes,
  qnnExplicitRetryProviders,
  qnnRuntimeUiLabel,
} from "./qnnReadiness";
import { isQnnSnapdragonReleaseGatePassed } from "./qnnDeps";
import type { HardwareProbeResult } from "./hardwareProbe";
import type { UIState } from "@/types";

const basePasses = {
  conversion: true,
  conversionSourceFormat: "pytorch" as const,
  conversionFormat: "onnx" as const,
  conversionOpset: 17,
  conversionInputTargetTypes: "",
  quantization: false,
  quantMethod: "ptq" as const,
  quantPrecision: "int8" as const,
  gptqBlockSize: 128,
  gptqDescAct: false,
  gptqGroupSize: 128,
  awqGroupSize: 128,
  awqDampPercent: 0.01,
  awqSym: false,
  qatQuantPrecision: "int8" as const,
  qatCalibrateMethod: "minmax" as const,
  qatCalibrateSteps: 100,
  quantPreset: "",
  pruning: false,
  pruningSparsity: 0.5,
  pruningType: "unstructured" as const,
  pruningMethod: "magnitude" as const,
  pruningCriteria: "l1_norm" as const,
  splitting: false,
  onnxTransforms: false,
  peft: false,
  peftMethod: "lora" as const,
  diffusionLora: false,
};

function probe(partial: Partial<HardwareProbeResult["qnn"]> = {}): HardwareProbeResult {
  return {
    probedAt: new Date().toISOString(),
    platform: { os: "win32 10.0", arch: "arm64", cpuModel: "Snapdragon", cpuCores: 8 },
    detectedProviders: ["CPUExecutionProvider", "QNNExecutionProvider"],
    recommendedProvider: "QNNExecutionProvider",
    notes: [],
    qnn: {
      available: true,
      loadable: true,
      preparation: true,
      npuDevice: true,
      potentialInference: true,
      verifiedInference: false,
      hostMode: "local-inference",
      ...partial,
    },
  };
}

describe("qnnReadiness", () => {
  it("classifies dynamic dims and io_config shapes", () => {
    expect(isUnresolvedDynamicDim("batch")).toBe(true);
    expect(isUnresolvedDynamicDim(-1)).toBe(true);
    expect(isUnresolvedDynamicDim(1)).toBe(false);
    expect(
      modelIoHasUnresolvedDynamicShapes({
        input_shapes: [[1, "seq"]],
      }),
    ).toBe(true);
    expect(
      modelIoHasUnresolvedDynamicShapes({
        input_shapes: [[1, 128]],
      }),
    ).toBe(false);
  });

  it("gates SDK-backed passes separately from plugin prep", () => {
    expect(isQnnSdkBackedPass("QNNConversion")).toBe(true);
    expect(isQnnSdkBackedPass("QNNPreprocess")).toBe(false);
  });

  it("emits fail-closed + unverified NPU issues for ARM64 inference", () => {
    const state = {
      ihvProvider: "QNNExecutionProvider" as const,
      passes: basePasses,
    } satisfies Pick<UIState, "ihvProvider" | "passes">;
    const issues = assessQnnRecipeReadiness({
      state,
      probe: probe(),
      ioConfig: { input_shapes: [[1, "dyn"]] },
    });
    expect(issues.some((i) => i.code === "qnn_dynamic_shapes" && i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.code === "qnn_fail_closed")).toBe(true);
    expect(issues.some((i) => i.code === "qnn_npu_unverified")).toBe(true);
    expect(isQnnSnapdragonReleaseGatePassed()).toBe(false);
  });

  it("keeps UI label below NPU ready until release gate", () => {
    expect(qnnRuntimeUiLabel(probe())).toBe("QNN runtime installed (NPU device)");
    expect(qnnExplicitRetryProviders()).toEqual([
      "DmlExecutionProvider",
      "CPUExecutionProvider",
    ]);
  });
});
