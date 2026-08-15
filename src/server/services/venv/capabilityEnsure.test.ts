import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureCoremltoolsMock = vi.fn();
const ensureVenvFamilyMock = vi.fn();
const getDualRuntimeStatusMock = vi.fn();
const probeFamilyStatusMock = vi.fn();

vi.mock("../olive/coreml.ts", () => ({
  ensureCoremltools: (...args: unknown[]) => ensureCoremltoolsMock(...args),
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
