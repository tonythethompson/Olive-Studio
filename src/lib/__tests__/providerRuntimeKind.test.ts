import { describe, expect, it } from "vitest";
import {
  alwaysSelectableProviders,
  getProviderRuntimeKind,
  isExportTargetProvider,
  isLegacyExportProvider,
  isPlatformLocalProvider,
} from "@/lib/providerRuntimeKind";
import {
  getProviderAvailabilityBlock,
  getSelectableProviders,
  mapOrtProvidersToIhv,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";

function cpuOnlyProbe(): HardwareProbeResult {
  return {
    probedAt: new Date().toISOString(),
    platform: { os: "linux", arch: "x64", cpuModel: "Test CPU", cpuCores: 8 },
    detectedProviders: ["CPUExecutionProvider"],
    recommendedProvider: "CPUExecutionProvider",
    notes: [],
  };
}

describe("providerRuntimeKind", () => {
  it("classifies local / export / platform roles", () => {
    expect(getProviderRuntimeKind("CUDAExecutionProvider")).toBe("local");
    expect(getProviderRuntimeKind("WebGpuExecutionProvider")).toBe("exportTarget");
    expect(getProviderRuntimeKind("NNAPIExecutionProvider")).toBe("exportTarget");
    expect(getProviderRuntimeKind("CoreMLExecutionProvider")).toBe("platformLocal");
    expect(getProviderRuntimeKind("VitisAIExecutionProvider")).toBe("platformLocal");
    expect(getProviderRuntimeKind("QNNExecutionProvider")).toBe("platformLocal");
    expect(getProviderRuntimeKind("QnnAbiExecutionProvider")).toBe("platformLocal");
    expect(isLegacyExportProvider("SNPEExecutionProvider")).toBe(true);
    expect(isExportTargetProvider("WasmExecutionProvider")).toBe(true);
    expect(isPlatformLocalProvider("CoreMLExecutionProvider")).toBe(true);
    expect(isPlatformLocalProvider("QNNExecutionProvider")).toBe(true);
    expect(isPlatformLocalProvider("QnnAbiExecutionProvider")).toBe(true);
  });

  it("classifies MIGraphXExecutionProvider as local", () => {
    expect(getProviderRuntimeKind("MIGraphXExecutionProvider")).toBe("local");
  });

  it("classifies DnnlExecutionProvider as local", () => {
    expect(getProviderRuntimeKind("DnnlExecutionProvider")).toBe("local");
  });
});

describe("export-target probe carve-outs", () => {
  it("never treats export targets as availability failures", () => {
    const probe = cpuOnlyProbe();
    for (const provider of alwaysSelectableProviders()) {
      expect(getProviderAvailabilityBlock(provider, probe)).toBeNull();
    }
  });

  it("keeps export targets selectable even when absent from detectedProviders", () => {
    const selectable = getSelectableProviders(cpuOnlyProbe());
    expect(selectable).toContain("CPUExecutionProvider");
    expect(selectable).toContain("WebGpuExecutionProvider");
    expect(selectable).toContain("NNAPIExecutionProvider");
    expect(selectable).toContain("XnnpackExecutionProvider");
    expect(selectable).toContain("WasmExecutionProvider");
    expect(selectable).toContain("CoreMLExecutionProvider");
    expect(selectable).toContain("VitisAIExecutionProvider");
    expect(selectable).toContain("QNNExecutionProvider");
    expect(selectable).toContain("QnnAbiExecutionProvider");
    expect(selectable).not.toContain("CUDAExecutionProvider");
  });

  it("includes platform-local providers in alwaysSelectableProviders", () => {
    const always = alwaysSelectableProviders();
    expect(always).toEqual(
      expect.arrayContaining([
        "CoreMLExecutionProvider",
        "VitisAIExecutionProvider",
        "QNNExecutionProvider",
        "QnnAbiExecutionProvider",
      ]),
    );
  });

  it("maps CoreML / VitisAI ORT names when present", () => {
    expect(mapOrtProvidersToIhv(["CoreMLExecutionProvider", "VitisAIExecutionProvider"])).toEqual(
      expect.arrayContaining(["CoreMLExecutionProvider", "VitisAIExecutionProvider"]),
    );
    expect(mapOrtProvidersToIhv(["WebGPUExecutionProvider", "NnapiExecutionProvider"])).toEqual(
      expect.arrayContaining(["WebGpuExecutionProvider", "NNAPIExecutionProvider"]),
    );
  });
});
