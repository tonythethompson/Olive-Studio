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

describe("QNN ABI coercion notice transitions", () => {
  useFetchRoutesMock({
    "hardware-probe": {
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    },
  });

  /** Helper: build a passes object with sensible defaults + per-test overrides. */
  function makePasses(overrides: Record<string, unknown> = {}) {
    return {
      conversion: true,
      conversionFormat: "onnx",
      conversionSourceFormat: "pytorch",
      quantization: false,
      quantizationMethod: "gptq",
      pruning: false,
      lora: false,
      ortTransformers: false,
      outputName: "model",
      trustRemoteCode: false,
      ...overrides,
    };
  }

  it("shows coercion notice when switching to QnnAbiExecutionProvider", async () => {
    // Start on CPU with conversion enabled
    const cpuState = createMockUIState({
      ihvProvider: "CPUExecutionProvider",
      passes: makePasses({ conversion: true }),
    });
    const { rerender } = render(
      <IHVIntegrationPanel state={cpuState} setState={mockSetState} />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    // Switch to QNN ABI — conversion gets coerced off
    const qnnState = createMockUIState({
      ihvProvider: "QnnAbiExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={qnnState} setState={mockSetState} />);
    });

    expect(screen.getByRole("status").textContent).toMatch(/OnnxConversion.*disabled/i);
  });

  it("clears coercion notice when leaving QNN provider", async () => {
    // Start on CPU with conversion enabled
    const cpuState = createMockUIState({
      ihvProvider: "CPUExecutionProvider",
      passes: makePasses({ conversion: true }),
    });
    const { rerender } = render(
      <IHVIntegrationPanel state={cpuState} setState={mockSetState} />,
    );

    // Switch to QNN ABI — notice appears
    const qnnState = createMockUIState({
      ihvProvider: "QnnAbiExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={qnnState} setState={mockSetState} />);
    });
    expect(screen.getByRole("status")).toBeTruthy();

    // Switch back to CPU — notice must be cleared (stale-state fix)
    const backToCpu = createMockUIState({
      ihvProvider: "CPUExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={backToCpu} setState={mockSetState} />);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not resurface stale passes when switching back to QNN without new coercions", async () => {
    // CPU → QNN (coercion) → CPU (clear) → QNN again (no new coercion → no notice)
    const cpuState = createMockUIState({
      ihvProvider: "CPUExecutionProvider",
      passes: makePasses({ conversion: true }),
    });
    const { rerender } = render(
      <IHVIntegrationPanel state={cpuState} setState={mockSetState} />,
    );

    // CPU → QNN with coercion
    const qnnState1 = createMockUIState({
      ihvProvider: "QnnAbiExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={qnnState1} setState={mockSetState} />);
    });
    expect(screen.getByRole("status")).toBeTruthy();

    // QNN → CPU (clears notice)
    const cpuState2 = createMockUIState({
      ihvProvider: "CPUExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={cpuState2} setState={mockSetState} />);
    });
    expect(screen.queryByRole("status")).toBeNull();

    // CPU → QNN again, same passes (no new coercion)
    const qnnState2 = createMockUIState({
      ihvProvider: "QnnAbiExecutionProvider",
      passes: makePasses({ conversion: false }),
    });
    await act(async () => {
      rerender(<IHVIntegrationPanel state={qnnState2} setState={mockSetState} />);
    });
    // No new coercion → no notice
    expect(screen.queryByRole("status")).toBeNull();
  });
});
