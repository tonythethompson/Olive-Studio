import fs from "fs";
import { describe, it, expect, afterEach } from "vitest";
import {
  allowedOrtPackageNames,
  enforcePackageConstraintsOrThrow,
  findForbiddenOrtInstallArgs,
  packageNameFromPipArg,
  withFamilyPipConstraintArgs,
} from "./packageConstraints.ts";
import { getFamilySpec } from "./spec.ts";
import { ONNXRUNTIME_OPENVINO_PIP_PACKAGE, openvinoOrtInstallArgs, openvinoPackageConstraints } from "../../../lib/openvinoDeps.ts";
import { pinnedOrtGpuInstallArgs } from "../../../lib/oliveGpuRuntime.ts";

describe("packageConstraints", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("parses package names from pip requirement tokens", () => {
    expect(packageNameFromPipArg("onnxruntime-gpu==1.26.0")).toBe("onnxruntime-gpu");
    expect(packageNameFromPipArg("optimum-intel[openvino]")).toBe("optimum-intel");
    expect(packageNameFromPipArg("--upgrade")).toBeNull();
    expect(packageNameFromPipArg("https://example.com/wheel.whl")).toBeNull();
  });

  it("allows canonical default ORT and rejects openvino / gpu wheels", () => {
    const allowed = allowedOrtPackageNames("default");
    expect(allowed.has(getFamilySpec("default").ortDistribution)).toBe(true);
    expect(findForbiddenOrtInstallArgs("default", ["openvino", "optimum-intel[openvino]"])).toEqual(
      [],
    );
    expect(findForbiddenOrtInstallArgs("default", [ONNXRUNTIME_OPENVINO_PIP_PACKAGE])).toEqual([
      ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
    ]);
    expect(findForbiddenOrtInstallArgs("default", ["onnxruntime-gpu"])).toEqual(["onnxruntime-gpu"]);
    expect(findForbiddenOrtInstallArgs("default", ["onnxruntime_gpu"])).toEqual(["onnxruntime_gpu"]);
    expect(() =>
      enforcePackageConstraintsOrThrow("default", [ONNXRUNTIME_OPENVINO_PIP_PACKAGE]),
    ).toThrow(/Refusing to install ORT packages/);
  });

  it("rejects path-like pip tokens and underscore ORT names", () => {
    expect(packageNameFromPipArg("file:///tmp/onnxruntime_gpu-1.26.0.whl")).toBeNull();
    expect(packageNameFromPipArg("https://example.com/wheel.whl")).toBeNull();
  });

  it("allows openvino family onnxruntime-openvino and rejects DirectML / gpu wheels", () => {
    expect(findForbiddenOrtInstallArgs("openvino", ["onnxruntime-openvino"])).toEqual([]);
    expect(findForbiddenOrtInstallArgs("openvino", openvinoOrtInstallArgs())).toEqual([]);
    expect(findForbiddenOrtInstallArgs("openvino", ["onnxruntime-directml"])).toEqual([
      "onnxruntime-directml",
    ]);
    expect(findForbiddenOrtInstallArgs("openvino", ["onnxruntime-gpu"])).toEqual([
      "onnxruntime-gpu",
    ]);
    expect(findForbiddenOrtInstallArgs("openvino", ["openvino", "optimum-intel[openvino]"])).toEqual(
      [],
    );
    expect(getFamilySpec("openvino").packageConstraints).toEqual(openvinoPackageConstraints());
    expect(getFamilySpec("openvino").ortInstallArgs).toEqual(openvinoOrtInstallArgs());
  });

  it("allows pinned onnxruntime-gpu for cuda and rejects DirectML / openvino ORT", () => {
    expect(findForbiddenOrtInstallArgs("cuda", pinnedOrtGpuInstallArgs())).toEqual([]);
    expect(findForbiddenOrtInstallArgs("cuda", ["tensorrt==10.13.3.9"])).toEqual([]);
    expect(findForbiddenOrtInstallArgs("cuda", ["onnxruntime-directml"])).toEqual([
      "onnxruntime-directml",
    ]);
    expect(findForbiddenOrtInstallArgs("cuda", [ONNXRUNTIME_OPENVINO_PIP_PACKAGE])).toEqual([
      ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
    ]);
  });

  it("injects a --constraint file from family packageConstraints", () => {
    const { args, cleanup } = withFamilyPipConstraintArgs("cuda", ["tensorrt"]);
    cleanups.push(cleanup);
    expect(args[0]).toBe("--constraint");
    expect(args[2]).toBe("tensorrt");
    const constraintPath = args[1]!;
    expect(fs.existsSync(constraintPath)).toBe(true);
    const body = fs.readFileSync(constraintPath, "utf8");
    expect(body).toContain(pinnedOrtGpuInstallArgs()[0]!);
    cleanup();
    expect(fs.existsSync(constraintPath)).toBe(false);
  });

  it("skips flag values when scanning for forbidden ORT packages", () => {
    expect(
      findForbiddenOrtInstallArgs("default", [
        "--upgrade",
        "--upgrade-strategy",
        "eager",
        "openvino",
      ]),
    ).toEqual([]);
  });
});
