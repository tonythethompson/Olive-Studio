import { describe, it, expect, vi } from "vitest";
import { screen, render } from "@testing-library/react";
import { ProviderCardGrid } from "./ProviderCardGrid";
import { createMockUIState } from "../__tests__/testUtils";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { getProviderRuntimeKind } from "@/lib/providerRuntimeKind";
import type { IHVProvider } from "@/types";

describe("ProviderCardGrid", () => {
  const defaultProps = {
    probeLoading: false,
    localAccelerators: PROVIDER_CATALOG.filter((p) => getProviderRuntimeKind(p.id) === "local"),
    exportAndPlatformTargets: PROVIDER_CATALOG.filter((p) => getProviderRuntimeKind(p.id) !== "local"),
    providerCardProps: {
      state: createMockUIState({ ihvProvider: "CPUExecutionProvider" }),
      setState: vi.fn(),
      hardwareProbe: null,
      probeLoading: false,
      detectedProviders: ["CPUExecutionProvider" as IHVProvider],
      trtRtxNeedsInstall: false,
      trtNeedsInstall: false,
      openvinoNeedsInstall: false,
      hardwareInstallBusy: false,
      installingTrtRtx: false,
      installTrtRtxError: null,
      installTrtRtxLog: [],
      onInstallTensorRtRtx: vi.fn(),
      installingTrt: false,
      installTrtError: null,
      installTrtLog: [],
      onInstallTensorRt: vi.fn(),
      openvinoInstall: { state: { installing: false, error: null, log: [] }, install: vi.fn() },
      qnnInstall: { state: { installing: false, testing: false, error: null, log: [] }, install: vi.fn(), testNpu: vi.fn() },
      directMlInstall: { state: { installing: false, error: null, log: [] }, install: vi.fn() },
      isPreMaxwellBox: false,
      cudaNeedsOrtGpuInstall: false,
      cudaToolkitMissingAndEpWorks: false,
      cudaToolkitMissing: false,
      cudaEpInVenv: false,
      nvidiaGpus: [],
      installingOrtGpu: false,
      installOrtGpuError: null,
      installOrtGpuLog: [],
      onInstallOrtGpu: vi.fn(),
    },
  };

  it("does not classify CPU as hardware-blocked when hardwareProbe is null", () => {
    render(<ProviderCardGrid {...defaultProps} />);

    // CPU provider header
    const cpuHeader = screen.getByText("Native CPU");
    expect(cpuHeader).toBeTruthy();

    // The container for Native CPU should contain "Active Target" badge
    const cpuCard = cpuHeader.closest(".relative");
    expect(cpuCard).toBeTruthy();
    expect(cpuCard?.textContent).toContain("Active Target");
    expect(cpuCard?.textContent).not.toContain("Unavailable hardware");
    expect(cpuCard?.textContent).not.toContain("Not on this system");
  });
});
