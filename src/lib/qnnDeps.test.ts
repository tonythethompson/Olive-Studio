import { describe, it, expect } from "vitest";
import {
  ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE,
  ONNXRUNTIME_QNN_PLUGIN_PACKAGE,
  PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION,
  PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION,
  isQnnSnapdragonReleaseGatePassed,
  qnnNumpyPinForPythonMinor,
  qnnOrtInstallArgs,
  qnnPackageConstraints,
  qnnStackInstallCommand,
  qnnStackLabel,
  qnnSupplementalInstallArgs,
  resolveQnnHostMode,
} from "./qnnDeps";

describe("qnnDeps", () => {
  it("pins the QNN 2.4.0 tested ORT/plugin pair", () => {
    expect(ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE).toBe("onnxruntime");
    expect(PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION).toBe("1.26.0");
    expect(ONNXRUNTIME_QNN_PLUGIN_PACKAGE).toBe("onnxruntime-qnn");
    expect(PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION).toBe("2.4.0");
    expect(qnnOrtInstallArgs()).toEqual(["onnxruntime==1.26.0"]);
    expect(qnnSupplementalInstallArgs()).toContain("onnxruntime-qnn==2.4.0");
  });

  it("pins NumPy per supported Python minor and rejects 3.10", () => {
    expect(qnnNumpyPinForPythonMinor("3.10")).toBeNull();
    expect(qnnNumpyPinForPythonMinor("3.11")).toBe("1.26.4");
    expect(qnnNumpyPinForPythonMinor("3.12")).toBe("2.2.6");
    expect(qnnNumpyPinForPythonMinor("3.13")).toBe("2.2.6");
  });

  it("keeps constraints and labels in lockstep with pins", () => {
    expect(qnnPackageConstraints()).toContain("onnxruntime==1.26.0");
    expect(qnnPackageConstraints()).toContain("onnxruntime-qnn==2.4.0");
    expect(qnnStackLabel()).toContain("1.26.0");
    expect(qnnStackLabel()).toContain("2.4.0");
    expect(qnnStackInstallCommand()).toContain("onnxruntime-qnn==2.4.0");
  });

  it("resolves Windows-first host modes", () => {
    expect(resolveQnnHostMode({ platform: "win32", arch: "arm64" })).toBe("local-inference");
    expect(resolveQnnHostMode({ platform: "win32", arch: "x64" })).toBe("preparation");
    expect(resolveQnnHostMode({ platform: "linux", arch: "x64" })).toBe("out-of-scope");
    expect(resolveQnnHostMode({ platform: "darwin", arch: "arm64" })).toBe("out-of-scope");
  });

  it("keeps Snapdragon release gate closed until hardware validation", () => {
    expect(isQnnSnapdragonReleaseGatePassed()).toBe(false);
  });
});
