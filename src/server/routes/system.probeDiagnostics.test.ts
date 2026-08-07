import { describe, expect, it } from "vitest";
import { buildProbeDiagnostics, type ProbeDiagnosticInput } from "./system.ts";

function baseInput(overrides: Partial<ProbeDiagnosticInput> = {}): ProbeDiagnosticInput {
  return {
    tensorRtRtxVenvLoadable: false,
    tensorRtVenvLoadable: false,
    cudaVenvLoadable: false,
    openvinoVenvAvailable: false,
    qnnVenvLoadable: false,
    platformArch: "x64",
    platformOs: "linux",
    ...overrides,
  };
}

describe("buildProbeDiagnostics", () => {
  it("marks TensorRT-family capable at the SM 7.5 floor", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        nvidia: {
          gpus: [{ name: "Turing", computeCapability: "7.5", vramMb: 8192 }],
        },
      }),
    );
    expect(diag.nvidiaTensorRtFamilyCapable).toBe(true);
    expect(diag.notes.some((n) => n.includes("below TensorRT 10.x floor"))).toBe(false);
  });

  it("hides TensorRT-family when GPUs are below the floor", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        nvidia: {
          gpus: [{ name: "Pascal", computeCapability: "6.1", vramMb: 8192 }],
        },
      }),
    );
    expect(diag.nvidiaTensorRtFamilyCapable).toBe(false);
    expect(diag.notes.some((n) => n.includes("below TensorRT 10.x floor"))).toBe(true);
  });

  it("does not warn about TensorRT floor when there are zero GPUs", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        nvidia: { gpus: [] },
      }),
    );
    expect(diag.nvidiaTensorRtFamilyCapable).toBe(false);
    expect(diag.notes.some((n) => n.includes("below TensorRT 10.x floor"))).toBe(false);
  });

  it("does not recommend CUDA install on pre-Maxwell GPUs", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        nvidia: {
          gpus: [{ name: "Kepler", computeCapability: "3.5", vramMb: 2048 }],
        },
      }),
    );
    expect(diag.notes.some((n) => n.includes("GPU is compatible"))).toBe(false);
    expect(diag.notes.some((n) => n.includes("Install onnxruntime-gpu"))).toBe(false);
    expect(diag.notes.some((n) => n.includes("below CUDA 12 toolkit floor"))).toBe(true);
  });

  it("recommends CUDA install when GPUs meet the CUDA floor", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        nvidia: {
          gpus: [{ name: "Turing", computeCapability: "7.5", vramMb: 8192 }],
        },
      }),
    );
    expect(diag.notes.some((n) => n.includes("Install onnxruntime-gpu") || n.includes("onnxruntime-gpu"))).toBe(
      true,
    );
    expect(diag.notes.some((n) => n.includes("below CUDA 12 toolkit floor"))).toBe(false);
  });

  it("reports qnnHostMode preparation on Windows x64 and shapes QNN notes", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        platformOs: "win32",
        platformArch: "x64",
        qnnVenvLoadable: true,
        qnn: { available: true, loadable: true, pluginVersion: "2.0" },
      }),
    );
    expect(diag.qnnHostMode).toBe("preparation");
    expect(diag.notes.some((n) => n.includes("Windows x64 preparation"))).toBe(true);
  });

  it("reports qnnHostMode local-inference on Windows arm64", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        platformOs: "win32",
        platformArch: "arm64",
      }),
    );
    expect(diag.qnnHostMode).toBe("local-inference");
    expect(diag.notes.some((n) => n.includes("Windows ARM64"))).toBe(true);
  });

  it("reports out-of-scope QNN host mode on non-Windows platforms", () => {
    const diag = buildProbeDiagnostics(
      baseInput({
        platformOs: "linux",
        platformArch: "x64",
      }),
    );
    expect(diag.qnnHostMode).toBe("out-of-scope");
    expect(diag.notes.some((n) => n.includes("Windows-first"))).toBe(true);
  });
});
