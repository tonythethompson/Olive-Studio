import { describe, it, expect } from "vitest";
import {
  markTensorRtVenvLoadable,
  mergeOrtProvidersForDisplay,
  resolveDirectMlDetected,
} from "./systemHardwareProbePolicy.ts";

describe("systemHardwareProbePolicy", () => {
  it("hasDirectMl is true only when default runtime reports DML", () => {
    // System Python may report DML; it must not influence project detection.
    expect(
      resolveDirectMlDetected({
        defaultProviders: ["CPUExecutionProvider"],
      }),
    ).toBe(false);
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
        ["DmlExecutionProvider"],
      ),
    ).toEqual([
      "CPUExecutionProvider",
      "CUDAExecutionProvider",
      "OpenVINOExecutionProvider",
      "DmlExecutionProvider",
    ]);
  });
});
