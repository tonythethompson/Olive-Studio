import { describe, expect, it } from "vitest";
import {
  ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
  OPEN_VINO_PIP_PACKAGE,
  OPENVINO_CONFLICTING_ORT_PACKAGES,
  OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE,
  openvinoStackInstallArgs,
  openvinoStackLabel,
} from "./openvinoDeps.ts";

describe("openvinoStackInstallArgs", () => {
  it("returns openvino + optimum-intel without onnxruntime-openvino", () => {
    expect(openvinoStackInstallArgs()).toEqual([
      "--upgrade",
      "--upgrade-strategy",
      "eager",
      OPEN_VINO_PIP_PACKAGE,
      OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE,
    ]);
    expect(openvinoStackInstallArgs()).not.toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });

  it("does not split the bracketed extra into a bare token", () => {
    const args = openvinoStackInstallArgs();
    expect(args.some((a) => a.startsWith("["))).toBe(false);
    expect(args).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(args).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
  });

  it("labels the Python OpenVINO stack without the ORT OpenVINO EP wheel", () => {
    expect(openvinoStackLabel()).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(openvinoStackLabel()).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
    expect(openvinoStackLabel()).not.toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });

  it("documents ORT wheels that conflict with onnxruntime-openvino (must not be uninstalled)", () => {
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime");
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime-gpu");
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime-directml");
  });
});
