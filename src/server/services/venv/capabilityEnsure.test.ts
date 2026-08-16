import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureCoremltoolsMock = vi.fn();
const ensureMigraphxMock = vi.fn();
const ensureVenvFamilyMock = vi.fn();
const getDualRuntimeStatusMock = vi.fn();
const probeFamilyStatusMock = vi.fn();

vi.mock("../olive/coreml.ts", () => ({
  ensureCoremltools: (...args: unknown[]) => ensureCoremltoolsMock(...args),
}));

vi.mock("../olive/migraphx.ts", () => ({
  ensureMigraphx: (...args: unknown[]) => ensureMigraphxMock(...args),
}));

vi.mock("./familyEnsure.ts", () => ({
  ensureVenvFamily: (...args: unknown[]) => ensureVenvFamilyMock(...args),
}));

vi.mock("./paths.ts", () => ({
  getVenvPython: () => "/fake/.venv/bin/python",
}));

vi.mock("./status.ts", () => ({
  capabilityForProvider: () => undefined,
  familyFlagsFromStatus: () => ({
    default: { cpuUsable: true, prepared: true },
    cuda: { cpuUsable: false, prepared: false },
    openvino: { cpuUsable: false, prepared: false },
    qnn: { cpuUsable: false, prepared: false },
  }),
  getDualRuntimeStatus: (...args: unknown[]) => getDualRuntimeStatusMock(...args),
  invalidateRuntimeStatusCache: vi.fn(),
  probeFamilyStatus: (...args: unknown[]) => probeFamilyStatusMock(...args),
}));

import { ensureProviderCapability } from "./capabilityEnsure.ts";

describe("ensureProviderCapability CoreML host gating", () => {
  beforeEach(() => {
    ensureCoremltoolsMock.mockReset();
    ensureCoremltoolsMock.mockResolvedValue({ ok: true });
    ensureVenvFamilyMock.mockReset();
    ensureVenvFamilyMock.mockResolvedValue({ ok: true });
    getDualRuntimeStatusMock.mockReset();
    probeFamilyStatusMock.mockReset();
  });

  it("does not install coremltools on a non-macOS host", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "win32" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider"],
    });

    const result = await ensureProviderCapability("CoreMLExecutionProvider", () => undefined);

    expect(result).toEqual({
      ok: false,
      error:
        "CoreMLExecutionProvider is not registered in default runtime ORT; export the recipe or run on a host where the hardware probe detects it",
      family: "default",
      python: "/fake/.venv/bin/python",
    });
    expect(ensureCoremltoolsMock).not.toHaveBeenCalled();
  });

  it("preserves coremltools installation and registered-provider success on macOS", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "darwin" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider", "CoreMLExecutionProvider"],
    });

    const onLine = vi.fn();
    const result = await ensureProviderCapability("CoreMLExecutionProvider", onLine);

    expect(result).toEqual({
      ok: true,
      family: "default",
      python: "/fake/.venv/bin/python",
    });
    expect(ensureCoremltoolsMock).toHaveBeenCalledOnce();
    expect(ensureCoremltoolsMock).toHaveBeenCalledWith(onLine);
  });
});

describe("ensureProviderCapability DnnlExecutionProvider", () => {
  beforeEach(() => {
    ensureVenvFamilyMock.mockReset();
    ensureVenvFamilyMock.mockResolvedValue({ ok: true });
    getDualRuntimeStatusMock.mockReset();
    probeFamilyStatusMock.mockReset();
  });

  it("succeeds when ORT reports DnnlExecutionProvider in available providers", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider", "DnnlExecutionProvider"],
    });

    const result = await ensureProviderCapability("DnnlExecutionProvider", () => undefined);

    expect(result).toEqual({
      ok: true,
      family: "default",
      python: "/fake/.venv/bin/python",
    });
  });

  it("returns failure with ORT wheel suggestion when DnnlExecutionProvider is absent from providers", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider"],
    });

    const result = await ensureProviderCapability("DnnlExecutionProvider", () => undefined);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("DnnlExecutionProvider is not registered");
    expect(result.error).toContain("oneDNN/DNNL support");
    expect(result.family).toBe("default");
    expect(result.python).toBe("/fake/.venv/bin/python");
  });

  it("does not attempt package installation for DnnlExecutionProvider", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider", "DnnlExecutionProvider"],
    });

    // If installCapabilityPackages tried to install something, it would invoke
    // one of the ensure* mocks. None should be called for DNNL.
    ensureCoremltoolsMock.mockReset();
    await ensureProviderCapability("DnnlExecutionProvider", () => undefined);
    expect(ensureCoremltoolsMock).not.toHaveBeenCalled();
  });
});

describe("ensureProviderCapability MIGraphXExecutionProvider", () => {
  beforeEach(() => {
    ensureMigraphxMock.mockReset();
    ensureMigraphxMock.mockResolvedValue({ ok: true });
    ensureVenvFamilyMock.mockReset();
    ensureVenvFamilyMock.mockResolvedValue({ ok: true });
    getDualRuntimeStatusMock.mockReset();
    probeFamilyStatusMock.mockReset();
  });

  it("succeeds when ORT reports MIGraphXExecutionProvider in available providers", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider", "MIGraphXExecutionProvider"],
    });

    const result = await ensureProviderCapability("MIGraphXExecutionProvider", () => undefined);

    expect(result).toEqual({
      ok: true,
      family: "default",
      python: "/fake/.venv/bin/python",
    });
    expect(ensureMigraphxMock).toHaveBeenCalledOnce();
  });

  it("returns failure with supported-GPU/ROCm hint when MIGraphXExecutionProvider is absent from providers", async () => {
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });
    probeFamilyStatusMock.mockResolvedValue({
      capabilities: { cpu: { usable: true } },
      ortProviders: ["CPUExecutionProvider", "ROCMExecutionProvider"],
    });

    const result = await ensureProviderCapability("MIGraphXExecutionProvider", () => undefined);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("MIGraphXExecutionProvider is not registered");
    expect(result.error).toContain("RDNA3/RDNA4");
    expect(result.family).toBe("default");
    expect(result.python).toBe("/fake/.venv/bin/python");
  });

  it("surfaces the migraphx install failure instead of the ORT check", async () => {
    ensureMigraphxMock.mockResolvedValue({ ok: false, error: "migraphx install boom" });
    getDualRuntimeStatusMock.mockResolvedValue({ families: {}, platform: "linux" });

    const result = await ensureProviderCapability("MIGraphXExecutionProvider", () => undefined);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("migraphx install boom");
  });
});
