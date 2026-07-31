import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

// Mock hardware probe
vi.mock("@/lib/hardwareProbe", () => ({
  fetchHardwareProbe: () => Promise.resolve({ providers: ["CPUExecutionProvider"] }),
  getSelectableProviders: () => ["CPUExecutionProvider", "CUDAExecutionProvider"],
  isProviderDetectedLocally: () => false,
}));

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
  VramEstimateBanner: () => <div data-testid="vram-banner">VRAM</div>,
}));

import { IHVIntegrationPanel, getCellCompatibility } from "./IHVIntegrationPanel";

describe("IHVIntegrationPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": { providers: ["CPUExecutionProvider"] },
  });

  it("renders the provider selection panel", () => {
    render(<IHVIntegrationPanel />);
    // Panel should render with provider-related content
    expect(screen.getAllByText(/provider/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", () => {
    const state = createMockUIState({ ihvProvider: "CUDAExecutionProvider" });
    render(<IHVIntegrationPanel state={state} setState={mockSetState} />);
    expect(screen.getAllByText(/provider/i).length).toBeGreaterThan(0);
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
