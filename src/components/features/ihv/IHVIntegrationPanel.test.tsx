import { describe, it, expect, vi } from "vitest";
import { screen, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock, renderWithProviders as render } from "../__tests__/testUtils";
import type { UIState } from "@/types";

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

// Mock hardware probe (keep DirectML helpers real so darwin ≠ Windows)
vi.mock("@/lib/hardwareProbe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hardwareProbe")>();
  return {
    ...actual,
    fetchHardwareProbe: () =>
      Promise.resolve({
        probedAt: "now",
        platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
        detectedProviders: ["CPUExecutionProvider"],
        recommendedProvider: "CPUExecutionProvider",
        notes: [],
      }),
    getSelectableProviders: () => ["CPUExecutionProvider", "CUDAExecutionProvider"],
    isProviderDetectedLocally: () => false,
  };
});

// Mock pipeline validation functions used by the panel
vi.mock("@/lib/pipelineValidation", () => ({
  applyProviderConflictAutofixes: vi.fn(),
  getProviderConflicts: () => [],
  getProviderHardwareBlock: () => null,
  getQuantMethodActivationBlock: () => null,
  isConversionFormatAllowed: () => true,
  isPeftAllowed: () => true,
  isPeftMethodAllowed: () => true,
  isQuantMethodAllowed: () => true,
  isStructuredPruningAllowed: () => true,
  prepareProviderChange: () => ({}),
}));

vi.mock("@/lib/memoryOffload", () => ({
  isMemoryOffloadAvailable: () => false,
  hasHuggingFaceModel: () => true,
}));

vi.mock("@/lib/vramEstimate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vramEstimate")>();
  return {
    ...actual,
    isGpuProvider: () => false,
    estimateVramRequirement: () => null,
  };
});

// Mock VramEstimateBanner (accesses estimate result without null check)
vi.mock("@/components/features/VramEstimateBanner", () => ({
  VramEstimateBanner: ({ setState }: { setState?: (s: Partial<UIState>) => void }) => (
    <div data-testid="vram-banner" data-has-set-state={String(Boolean(setState))}>
      VRAM
    </div>
  ),
}));

import { IHVIntegrationPanel } from "./IHVIntegrationPanel";
import { getCellCompatibility } from "./hardwarePassCompatibility";

describe("IHVIntegrationPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": {
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    },
  });

  it("renders the provider selection panel", async () => {
    await act(async () => {
      render(<IHVIntegrationPanel />);
    });
    // Panel should render with provider-related content
    expect(screen.getAllByText(/provider/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState({ ihvProvider: "CUDAExecutionProvider" });
    await act(async () => {
      render(<IHVIntegrationPanel state={state} setState={mockSetState} />);
    });
    expect(screen.getAllByText(/provider/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("vram-banner").getAttribute("data-has-set-state")).toBe("true");
  });
});

describe("getCellCompatibility (pure function)", () => {
  const mockPass = {
    id: "onnx-conversion",
    isUnsupported: (provider: string) => provider === "QNNExecutionProvider",
    getIncompatibilityReason: (provider: string) => `${provider} does not support this pass`,
  };

  it("returns compatible for supported provider", () => {
    const result = getCellCompatibility(mockPass as never, "CPUExecutionProvider");
    expect(result.status).not.toBe("unsupported");
  });

  it("returns unsupported for incompatible provider", () => {
    const result = getCellCompatibility(mockPass as never, "QNNExecutionProvider");
    expect(result.status).toBe("unsupported");
  });
});
