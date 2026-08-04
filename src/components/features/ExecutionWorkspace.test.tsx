import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

// Mock hooks
vi.mock("@/lib/hooks", () => ({
  useAutoClearError: () => [null, vi.fn()],
  useMcpDiagnosticKeyed: () => ({
    fetchKeyedDiagnostic: vi.fn(),
    diagnostics: {},
    diagnosingKeys: {},
    errors: {},
    diagnosticKey: "current",
  }),
}));

// Mock hardware probe
vi.mock("@/lib/hardwareProbe", () => ({
  fetchHardwareProbe: () =>
    Promise.resolve({
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    }),
  getProviderAvailabilityBlock: () => null,
}));

// Mock vram estimate (accesses state.passes fields not in minimal mock)
vi.mock("@/lib/vramEstimate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vramEstimate")>();
  return {
    ...actual,
    estimateVramRequirement: () => null,
  };
});

// Mock VramEstimateBanner (accesses estimate result without null check)
vi.mock("@/components/features/VramEstimateBanner", () => ({
  VramEstimateBanner: () => <div data-testid="vram-banner">VRAM</div>,
}));

// Mock JSZip (heavy dependency)
vi.mock("jszip", () => ({
  default: vi.fn().mockImplementation(() => ({
    file: vi.fn(),
    generateAsync: () => Promise.resolve(new Blob()),
  })),
}));

// Mock lazy-loaded children
vi.mock("./RecipeGraphView", () => ({
  RecipeGraphView: () => <div data-testid="recipe-graph">RecipeGraph</div>,
}));

vi.mock("@/components/features/InBrowserValidation", () => ({
  InBrowserValidation: () => <div data-testid="in-browser-validation">Validation</div>,
}));

vi.mock("@/components/features/WebGpuBenchmarkPanel", () => ({
  WebGpuBenchmarkPanel: () => <div data-testid="webgpu-benchmark">Benchmark</div>,
}));

// Mock job history store
vi.mock("@/lib/jobHistoryStore", () => ({
  saveJobHistory: vi.fn(),
}));

// Mock GPU metrics
vi.mock("@/lib/gpuMetrics", () => ({
  parseGpuMetrics: () => null,
}));

import { ExecutionWorkspace } from "./ExecutionWorkspace";

describe("ExecutionWorkspace", () => {
  useFetchRoutesMock({
    "hardware-probe": {
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    },
  });

  it("renders the workspace heading", async () => {
    await act(async () => {
      render(<ExecutionWorkspace />);
    });
    expect(screen.getAllByText(/execute/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState();
    await act(async () => {
      render(<ExecutionWorkspace state={state} setState={mockSetState} />);
    });
    expect(screen.getAllByText(/execute/i).length).toBeGreaterThan(0);
  });

  it("throws when only state is provided without setState", () => {
    const state = createMockUIState();
    expect(() => {
      render(<ExecutionWorkspace state={state} />);
    }).toThrow(/both be provided or both omitted/);
  });

  it("throws when only setState is provided without state", () => {
    expect(() => {
      render(<ExecutionWorkspace setState={mockSetState} />);
    }).toThrow(/both be provided or both omitted/);
  });

  it("renders recipe JSON view controls", async () => {
    await act(async () => {
      render(<ExecutionWorkspace />);
    });
    // Should have a JSON/code view toggle or recipe-related control
    const jsonControl = screen.queryByText(/json/i) || screen.queryByText(/recipe/i);
    expect(jsonControl).not.toBeNull();
  });

  it("More menu no longer lists Browser Test or Benchmark (Task 11.4)", async () => {
    await act(async () => {
      render(<ExecutionWorkspace />);
    });

    const moreButton = screen.getByRole("button", { name: /more/i });
    await act(async () => {
      moreButton.click();
    });

    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /run history/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /export report/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /export for owr/i })).toBeTruthy();

    expect(screen.queryByRole("menuitem", { name: /browser test/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /benchmark/i })).toBeNull();
    // Text nodes for promoted Playground views must not appear in the menu
    expect(menu.textContent).not.toMatch(/Browser Test/i);
    expect(menu.textContent).not.toMatch(/Benchmark/i);
  });
});
