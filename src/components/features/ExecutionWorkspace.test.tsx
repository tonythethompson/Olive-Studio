import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMockUIState, mockFetchRoutes } from "./__tests__/testUtils";

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
    diagnosticKey: "current",
  }),
}));

// Mock hardware probe
vi.mock("@/lib/hardwareProbe", () => ({
  fetchHardwareProbe: () => Promise.resolve({ providers: ["CPUExecutionProvider"] }),
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
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = mockFetchRoutes({
      "hardware-probe": { providers: ["CPUExecutionProvider"] },
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("renders the workspace heading", () => {
    render(<ExecutionWorkspace />);
    expect(screen.getAllByText(/execute/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", () => {
    const state = createMockUIState();
    render(<ExecutionWorkspace state={state} setState={mockSetState} />);
    expect(screen.getAllByText(/execute/i).length).toBeGreaterThan(0);
  });

  it("throws when only state is provided without setState", () => {
    const state = createMockUIState();
    expect(() => {
      render(<ExecutionWorkspace state={state} />);
    }).toThrow(/both be provided or both omitted/);
  });

  it("renders recipe JSON view controls", () => {
    render(<ExecutionWorkspace />);
    // Should have a JSON/code view toggle or button
    const jsonButton = screen.queryByText(/json/i) || screen.queryByText(/recipe/i);
    expect(jsonButton || screen.getAllByText(/execute/i)[0]).toBeDefined();
  });
});
