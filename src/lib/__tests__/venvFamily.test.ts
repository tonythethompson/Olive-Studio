import { describe, it, expect } from "vitest";
import {
  emptyFamilyFlags,
  mandatoryFamilyForProvider,
  normalizeIhvProvider,
  resolveRequiredFamilies,
  resolveVenvFamily,
  humanFamilyLabel,
  humanFamilyRootHint,
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
    expect(normalizeIhvProvider("QnnAbiExecutionProvider")).toBe("QnnAbiExecutionProvider");
    expect(normalizeIhvProvider("qnnabi")).toBe("QnnAbiExecutionProvider");
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
    expect(mandatoryFamilyForProvider("OpenVINOExecutionProvider")).toBe("openvino");
    expect(mandatoryFamilyForProvider("QNNExecutionProvider")).toBe("qnn");
    expect(mandatoryFamilyForProvider("CPUExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("WebGpuExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("CoreMLExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("NNAPIExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("VitisAIExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("SNPEExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("TensorflowLiteExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("XnnpackExecutionProvider")).toBeNull();
    expect(mandatoryFamilyForProvider("WasmExecutionProvider")).toBeNull();
  });

  it("normalizes new export/platform aliases", () => {
    expect(normalizeIhvProvider("coreml")).toBe("CoreMLExecutionProvider");
    expect(normalizeIhvProvider("nnapi")).toBe("NNAPIExecutionProvider");
    expect(normalizeIhvProvider("vitisai")).toBe("VitisAIExecutionProvider");
    expect(normalizeIhvProvider("snpe")).toBe("SNPEExecutionProvider");
    expect(normalizeIhvProvider("tflite")).toBe("TensorflowLiteExecutionProvider");
    expect(normalizeIhvProvider("xnnpack")).toBe("XnnpackExecutionProvider");
    expect(normalizeIhvProvider("wasm")).toBe("WasmExecutionProvider");
  });

  it("labels openvino and qnn families", () => {
    expect(humanFamilyLabel("openvino")).toBe("OpenVINO runtime");
    expect(humanFamilyRootHint("openvino")).toBe(".venvs/openvino");
    expect(humanFamilyLabel("qnn")).toBe("QNN runtime");
    expect(humanFamilyRootHint("qnn")).toBe(".venvs/qnn");
  });

  it("resolves single-job CPU with ready-environment reuse (not openvino/qnn)", () => {
    expect(resolveVenvFamily("CPUExecutionProvider")).toBe("default");
    expect(
      resolveVenvFamily("CPUExecutionProvider", {
        default: { cpuUsable: false, prepared: false },
        cuda: { cpuUsable: true, prepared: true },
        openvino: { cpuUsable: true, prepared: true },
        qnn: { cpuUsable: true, prepared: true },
      }),
    ).toBe("cuda");
    expect(resolveVenvFamily("CUDAExecutionProvider", emptyFamilyFlags())).toBe("cuda");
    expect(resolveVenvFamily("OpenVINOExecutionProvider", emptyFamilyFlags())).toBe("openvino");
    expect(resolveVenvFamily("QNNExecutionProvider", emptyFamilyFlags())).toBe("qnn");
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
    expect(resolveRequiredFamilies(["OpenVINOExecutionProvider"])).toEqual(["openvino"]);
    expect(
      resolveRequiredFamilies(["CPUExecutionProvider", "OpenVINOExecutionProvider"]),
    ).toEqual(["default", "openvino"]);
    expect(resolveRequiredFamilies(["QNNExecutionProvider"])).toEqual(["qnn"]);
    expect(resolveRequiredFamilies(["CPUExecutionProvider", "QNNExecutionProvider"])).toEqual([
      "default",
      "qnn",
    ]);
    expect(resolveRequiredFamilies(["CUDAExecutionProvider"])).toEqual(["cuda"]);
    expect(resolveRequiredFamilies(["WebGpuExecutionProvider"])).toEqual([]);
    expect(resolveRequiredFamilies([])).toEqual([]);
  });
});
