import { describe, it, expect } from "vitest";
import {
  markQnnVenvLoadable,
  markTensorRtVenvLoadable,
  mergeOrtProvidersForDisplay,
  resolveDirectMlDetected,
  resolveDirectMlEpDetected,
  resolveDirectMlHardwareReady,
} from "./systemHardwareProbePolicy.ts";

describe("systemHardwareProbePolicy", () => {
  it("DirectML hardware readiness is Windows / DX12 class, not EP registration", () => {
    expect(resolveDirectMlHardwareReady({ os: "win32 10.0" })).toBe(true);
    expect(resolveDirectMlHardwareReady({ os: "Windows_NT" })).toBe(true);
    expect(resolveDirectMlHardwareReady({ os: "linux 6.8" })).toBe(false);
    expect(resolveDirectMlHardwareReady({})).toBe(false);
  });

  it("DirectML EP detection stays on default-runtime providers for install guidance", () => {
    expect(
      resolveDirectMlEpDetected({
        defaultProviders: ["CPUExecutionProvider"],
      }),
    ).toBe(false);
    expect(
      resolveDirectMlEpDetected({
        defaultProviders: ["CPUExecutionProvider", "DmlExecutionProvider"],
      }),
    ).toBe(true);
    // Legacy alias retained for EP-based checks.
    expect(
      resolveDirectMlDetected({
        defaultProviders: ["CPUExecutionProvider", "DmlExecutionProvider"],
      }),
    ).toBe(true);
  });

  it("marks TRT loadable on cuda runtime", () => {
    expect(
      markTensorRtVenvLoadable({
        isCuda: true,
        isDefault: false,
        cudaPythonExists: true,
        loadable: true,
      }),
    ).toBe(true);
  });

  it("marks TRT loadable on default fallback when cuda python missing", () => {
    expect(
      markTensorRtVenvLoadable({
        isCuda: false,
        isDefault: true,
        cudaPythonExists: false,
        loadable: true,
      }),
    ).toBe(true);
  });

  it("does not mark TRT loadable on default when cuda python exists", () => {
    expect(
      markTensorRtVenvLoadable({
        isCuda: false,
        isDefault: true,
        cudaPythonExists: true,
        loadable: true,
      }),
    ).toBe(false);
  });

  it("merges ORT providers in family order", () => {
    expect(
      mergeOrtProvidersForDisplay(
        ["CPUExecutionProvider"],
        ["CUDAExecutionProvider"],
        ["OpenVINOExecutionProvider"],
        ["QNNExecutionProvider"],
        ["DmlExecutionProvider"],
      ),
    ).toEqual([
      "CPUExecutionProvider",
      "CUDAExecutionProvider",
      "OpenVINOExecutionProvider",
      "QNNExecutionProvider",
      "DmlExecutionProvider",
    ]);
  });

  it("marks QNN loadable only on the qnn family python", () => {
    expect(markQnnVenvLoadable({ isQnn: true, loadable: true })).toBe(true);
    expect(markQnnVenvLoadable({ isQnn: false, loadable: true })).toBe(false);
  });
});
