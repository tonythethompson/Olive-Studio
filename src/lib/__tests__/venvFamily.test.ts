import { describe, it, expect } from "vitest";
import {
  emptyFamilyFlags,
  mandatoryFamilyForProvider,
  normalizeIhvProvider,
  resolveRequiredFamilies,
  resolveVenvFamily,
} from "../venvFamily";

describe("venvFamily policy", () => {
  it("normalizes known aliases (exact, case-insensitive)", () => {
    expect(normalizeIhvProvider("dml")).toBe("DmlExecutionProvider");
    expect(normalizeIhvProvider("DirectML")).toBe("DmlExecutionProvider");
    expect(normalizeIhvProvider("cuda")).toBe("CUDAExecutionProvider");
    expect(normalizeIhvProvider("tensorrt")).toBe("TensorrtExecutionProvider");
    expect(normalizeIhvProvider("trt")).toBe("TensorrtExecutionProvider");
    expect(normalizeIhvProvider("openvino")).toBe("OpenVINOExecutionProvider");
    expect(normalizeIhvProvider("CUDAExecutionProvider")).toBe("CUDAExecutionProvider");
    expect(normalizeIhvProvider("cudaexecutionprovider")).toBe("CUDAExecutionProvider");
    expect(normalizeIhvProvider("not-a-provider")).toBeNull();
  });

  it("rejects substring-only tokens that are not exact aliases", () => {
    expect(normalizeIhvProvider("fake-cuda")).toBeNull();
    expect(normalizeIhvProvider("unsupported-cpu-backend")).toBeNull();
    expect(normalizeIhvProvider("openvino-custom")).toBeNull();
  });

  it("maps mandatory families", () => {
    expect(mandatoryFamilyForProvider("CUDAExecutionProvider")).toBe("cuda");
    expect(mandatoryFamilyForProvider("TensorrtExecutionProvider")).toBe("cuda");
    expect(mandatoryFamilyForProvider("DmlExecutionProvider")).toBe("default");
    expect(mandatoryFamilyForProvider("OpenVINOExecutionProvider")).toBe("default");
    expect(mandatoryFamilyForProvider("CPUExecutionProvider")).toBeNull();
  });

  it("resolves single-job CPU with ready-environment reuse", () => {
    expect(resolveVenvFamily("CPUExecutionProvider")).toBe("default");
    expect(
      resolveVenvFamily("CPUExecutionProvider", {
        default: { cpuUsable: false, prepared: false },
        cuda: { cpuUsable: true, prepared: true },
      }),
    ).toBe("cuda");
    expect(resolveVenvFamily("CUDAExecutionProvider", emptyFamilyFlags())).toBe("cuda");
    expect(resolveVenvFamily("DmlExecutionProvider", emptyFamilyFlags())).toBe("default");
    expect(resolveVenvFamily("WebGpuExecutionProvider", emptyFamilyFlags())).toBe("default");
  });

  it("plans required families for batch queues", () => {
    expect(resolveRequiredFamilies(["CPUExecutionProvider"])).toEqual(["default"]);
    expect(resolveRequiredFamilies(["CPUExecutionProvider", "CUDAExecutionProvider"])).toEqual([
      "cuda",
    ]);
    expect(resolveRequiredFamilies(["CPUExecutionProvider", "DmlExecutionProvider"])).toEqual([
      "default",
    ]);
    expect(
      resolveRequiredFamilies([
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "DmlExecutionProvider",
      ]),
    ).toEqual(["default", "cuda"]);
    expect(resolveRequiredFamilies(["CUDAExecutionProvider"])).toEqual(["cuda"]);
    expect(resolveRequiredFamilies(["WebGpuExecutionProvider"])).toEqual([]);
    expect(resolveRequiredFamilies([])).toEqual([]);
  });
});
