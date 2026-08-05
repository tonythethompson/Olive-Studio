import { describe, expect, it } from "vitest";
import {
  ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
  OPEN_VINO_PIP_PACKAGE,
  OPENVINO_CONFLICTING_ORT_PACKAGES,
  OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE,
  PINNED_ONNXRUNTIME_OPENVINO_VERSION,
  PINNED_OPENVINO_VERSION,
  PINNED_OPTIMUM_INTEL_SPEC,
  isOpenVinoTargetAvailable,
  normalizeOpenVinoTargetDevice,
  openvinoOrtInstallArgs,
  openvinoPackageConstraints,
  openvinoStackInstallArgs,
  openvinoStackLabel,
  openvinoTargetToOliveDevice,
  pickOpenVinoTargetFromDevices,
} from "./openvinoDeps.ts";

describe("openvinoStackInstallArgs", () => {
  it("returns pinned openvino + optimum-intel without onnxruntime-openvino", () => {
    expect(openvinoStackInstallArgs()).toEqual([
      "--upgrade",
      "--upgrade-strategy",
      "eager",
      `${OPEN_VINO_PIP_PACKAGE}==${PINNED_OPENVINO_VERSION}`,
      `${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE}${PINNED_OPTIMUM_INTEL_SPEC}`,
    ]);
    expect(openvinoStackInstallArgs()).not.toContain(ONNXRUNTIME_OPENVINO_PIP_PACKAGE);
  });

  it("does not split the bracketed extra into a bare token", () => {
    const args = openvinoStackInstallArgs();
    expect(args.some((a) => a.startsWith("["))).toBe(false);
    expect(args.some((a) => a.startsWith(`${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE}`))).toBe(true);
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

  it("keeps ORT / openvino / optimum-intel pins aligned across install and constraints", () => {
    const constraints = openvinoPackageConstraints();
    const ortArgs = openvinoOrtInstallArgs();
    const stackArgs = openvinoStackInstallArgs();

    expect(ortArgs).toEqual([
      `${ONNXRUNTIME_OPENVINO_PIP_PACKAGE}==${PINNED_ONNXRUNTIME_OPENVINO_VERSION}`,
    ]);
    expect(constraints).toContain(
      `${ONNXRUNTIME_OPENVINO_PIP_PACKAGE}==${PINNED_ONNXRUNTIME_OPENVINO_VERSION}`,
    );
    expect(constraints).toContain(`${OPEN_VINO_PIP_PACKAGE}==${PINNED_OPENVINO_VERSION}`);
    expect(constraints).toContain(`optimum-intel${PINNED_OPTIMUM_INTEL_SPEC}`);
    expect(stackArgs).toContain(`${OPEN_VINO_PIP_PACKAGE}==${PINNED_OPENVINO_VERSION}`);
    expect(stackArgs).toContain(
      `${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE}${PINNED_OPTIMUM_INTEL_SPEC}`,
    );
  });
});

describe("OpenVINO target device helpers", () => {
  it("maps targets to Olive accelerator devices", () => {
    expect(openvinoTargetToOliveDevice("CPU")).toBe("cpu");
    expect(openvinoTargetToOliveDevice("GPU")).toBe("gpu");
    expect(openvinoTargetToOliveDevice("NPU")).toBe("npu");
  });

  it("normalizes probe and recipe device tokens", () => {
    expect(normalizeOpenVinoTargetDevice("cpu")).toBe("CPU");
    expect(normalizeOpenVinoTargetDevice("GPU.0")).toBe("GPU");
    expect(normalizeOpenVinoTargetDevice("NPU")).toBe("NPU");
    expect(normalizeOpenVinoTargetDevice("AUTO")).toBeNull();
  });

  it("picks GPU over NPU over CPU from probe devices", () => {
    expect(pickOpenVinoTargetFromDevices(["CPU", "GPU", "NPU"])).toBe("GPU");
    expect(pickOpenVinoTargetFromDevices(["CPU", "NPU"])).toBe("NPU");
    expect(pickOpenVinoTargetFromDevices(["CPU"])).toBe("CPU");
    expect(pickOpenVinoTargetFromDevices(undefined)).toBe("CPU");
  });

  it("treats CPU as always available and gates GPU/NPU on probe devices", () => {
    expect(isOpenVinoTargetAvailable("CPU", [])).toBe(true);
    expect(isOpenVinoTargetAvailable("GPU", ["CPU", "GPU.0"])).toBe(true);
    expect(isOpenVinoTargetAvailable("NPU", ["CPU", "GPU"])).toBe(false);
  });
});
