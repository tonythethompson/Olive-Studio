import { describe, it, expect } from "vitest";
import { inferRequiredPackages } from "./recipe.ts";
import { openvinoStackInstallArgs, ONNXRUNTIME_OPENVINO_PIP_PACKAGE } from "../../../lib/openvinoDeps.ts";
import { getFamilySpec } from "../venv/spec.ts";

function openvinoRecipe() {
  return {
    input_model: { type: "HfModel", config: { model_path: "gpt2" } },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: {
          accelerators: [{ device: "cpu", execution_providers: ["OpenVINOExecutionProvider"] }],
        },
      },
    },
    passes: {
      ov: { type: "OpenVINOConversion", config: {} },
    },
  };
}

describe("inferRequiredPackages OpenVINO", () => {
  it("uses default-family ORT and openvino stack without onnxruntime-openvino", () => {
    const pkgs = inferRequiredPackages(openvinoRecipe(), "cpu");
    const ort = pkgs.find((p) => p.importName === "onnxruntime");
    expect(ort).toBeDefined();
    expect(ort!.installArgs).toEqual(getFamilySpec("default").ortInstallArgs);
    expect(ort!.installArgs).not.toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);

    const ov = pkgs.find((p) => p.importName === "openvino");
    expect(ov).toBeDefined();
    expect(ov!.installArgs).toEqual(openvinoStackInstallArgs());
    expect(ov!.installArgs).not.toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });
});
