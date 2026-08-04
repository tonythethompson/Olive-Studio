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
  it("includes --upgrade-strategy eager and all OpenVINO stack packages", () => {
    const args = openvinoStackInstallArgs();
    expect(args).toContain("--upgrade-strategy");
    expect(args).toContain("eager");
    expect(args).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(args).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
    expect(args).toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });

  it("does not split the bracketed extra into a bare token", () => {
    const args = openvinoStackInstallArgs();
    expect(args.some((a) => a.startsWith("["))).toBe(false);
    expect(args).toContain(`${OPEN_VINO_PIP_PACKAGE}`);
    expect(args).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
  });

  it("labels the stack for UI/logs including the ORT OpenVINO EP wheel", () => {
    expect(openvinoStackLabel()).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(openvinoStackLabel()).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
    expect(openvinoStackLabel()).toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });

  it("lists ORT wheels that must be removed before installing onnxruntime-openvino", () => {
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime");
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime-gpu");
    expect(OPENVINO_CONFLICTING_ORT_PACKAGES).toContain("onnxruntime-directml");
  });
});
