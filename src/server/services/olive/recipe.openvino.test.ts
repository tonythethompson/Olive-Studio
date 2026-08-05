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
  it("uses openvino-family ORT (onnxruntime-openvino) plus openvino stack", () => {
    const pkgs = inferRequiredPackages(openvinoRecipe(), "cpu");
    const ort = pkgs.find((p) => p.importName === "onnxruntime");
    expect(ort).toBeDefined();
    expect(ort!.installArgs).toEqual(getFamilySpec("openvino").ortInstallArgs);
    expect(ort!.installArgs).toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);

    const ov = pkgs.find((p) => p.importName === "openvino");
    expect(ov).toBeDefined();
    expect(ov!.installArgs).toEqual(openvinoStackInstallArgs());
  });
});
