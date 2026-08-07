import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockUIState, useFetchRoutesMock, renderWithProviders as render } from "../__tests__/testUtils";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { McpDiagnostic } from "@/types";

/** Full default passes so Execute Live stays enabled (isRunnable). */
function runnableUiState() {
  return createMockUIState({
    passes: { ...DEFAULT_PASSES, conversion: true, quantization: false },
  });
}

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

const MATCHED_DIAGNOSTIC: McpDiagnostic = {
  matched_entry: "onnxruntime-large-model-external-data",
  title: "ONNX Export Fails for Models > 2GB",
  root_cause: "Protobuf size limit.",
  workaround: "Enable external data format.",
  updated_config: { use_external_data_format: true },
  domain: "olive",
  applyable: true,
};

const UNMATCHED_DIAGNOSTIC: McpDiagnostic = {
  matched_entry: null,
  title: "Unrecognized runtime error",
  root_cause: "No KB match.",
  workaround: "Inspect logs manually.",
  domain: null,
};

/** Mutable keyed-diagnostic mock shared across tests. */
const mcpKeyedState = {
  fetchKeyedDiagnostic: vi.fn(),
  diagnostics: {} as Record<string, McpDiagnostic | null>,
  diagnosingKeys: {} as Record<string, boolean>,
  errors: {} as Record<string, string | null>,
  diagnosticKey: "current",
};

const mockRequestFeedback = vi.fn();

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAutoClearError: () => ["", vi.fn()],
    useMcpDiagnosticKeyed: () => ({
      fetchKeyedDiagnostic: mcpKeyedState.fetchKeyedDiagnostic,
      diagnostics: mcpKeyedState.diagnostics,
      diagnosingKeys: mcpKeyedState.diagnosingKeys,
      errors: mcpKeyedState.errors,
      diagnosticKey: mcpKeyedState.diagnosticKey,
    }),
    requestMcpTroubleshootFeedback: (...args: unknown[]) => mockRequestFeedback(...args),
  };
});

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
vi.mock("./recipe-graph/RecipeGraphView", () => ({
  RecipeGraphView: () => <div data-testid="recipe-graph">RecipeGraph</div>,
}));

vi.mock("@/components/features/playground/InBrowserValidation", () => ({
  InBrowserValidation: () => <div data-testid="in-browser-validation">Validation</div>,
}));

vi.mock("@/components/features/playground/WebGpuBenchmarkPanel", () => ({
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

const HW_PROBE = {
  probedAt: "now",
  platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
  detectedProviders: ["CPUExecutionProvider"],
  recommendedProvider: "CPUExecutionProvider",
  notes: [] as string[],
};

/**
 * Runnable CPU conversion recipe + mocked /api/olive/run failure.
 * Execute Live stays enabled (isRunnable), then fails without spawning Olive.
 */
function installNoOliveFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/olive/run")) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Simulated run rejection (no Olive)" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.includes("hardware-probe")) {
      return Promise.resolve(
        new Response(JSON.stringify(HW_PROBE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

async function failExecuteLive() {
  const user = userEvent.setup();
  const executeBtn = await screen.findByRole("button", { name: /execute live/i });
  expect((executeBtn as HTMLButtonElement).disabled).toBe(false);
  await user.click(executeBtn);
  await waitFor(() => {
    expect(screen.getByText(/Olive MCP Error Diagnostic/i)).toBeDefined();
  });
}

describe("ExecutionWorkspace", () => {
  // Baseline fetch mock for non-feedback tests; feedback tests reinstall via installNoOliveFetch.
  useFetchRoutesMock({
    "hardware-probe": HW_PROBE,
  });

  beforeEach(() => {
    mockSetState.mockClear();
    mcpKeyedState.fetchKeyedDiagnostic.mockClear();
    mcpKeyedState.diagnostics = {};
    mcpKeyedState.diagnosingKeys = {};
    mcpKeyedState.errors = {};
    mockRequestFeedback.mockReset();
    mockRequestFeedback.mockResolvedValue({
      status: "ok",
      matched_entry: MATCHED_DIAGNOSTIC.matched_entry,
      rating: "thumbs-up",
      reason_code: null,
      thumbs_up: 1,
      thumbs_down: 0,
      total: 1,
    });
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

  it("wires MCP feedback thumbs for matched diagnostics after a failed run (no Olive)", async () => {
    const fetchSpy = installNoOliveFetch();
    mcpKeyedState.diagnostics = { current: MATCHED_DIAGNOSTIC };

    try {
      await act(async () => {
        render(<ExecutionWorkspace state={runnableUiState()} setState={mockSetState} />);
      });

      await failExecuteLive();

      expect(screen.getByText(MATCHED_DIAGNOSTIC.title)).toBeDefined();
      expect(screen.getByRole("button", { name: /Thumbs up/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Thumbs down/i })).toBeDefined();

      // Auto-diagnose still uses the keyed hook (history path remains intact).
      expect(mcpKeyedState.fetchKeyedDiagnostic).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/olive/run",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("hides feedback controls for unmatched diagnostics and still shows the card", async () => {
    const fetchSpy = installNoOliveFetch();
    mcpKeyedState.diagnostics = { current: UNMATCHED_DIAGNOSTIC };

    try {
      await act(async () => {
        render(<ExecutionWorkspace state={runnableUiState()} setState={mockSetState} />);
      });

      await failExecuteLive();

      expect(screen.getByText(UNMATCHED_DIAGNOSTIC.title)).toBeDefined();
      expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Thumbs down/i })).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("records diagnosis history when the keyed diagnostic updates (no regression)", async () => {
    const fetchSpy = installNoOliveFetch();
    // Start empty so the history effect sees a transition when we re-render with a match.
    mcpKeyedState.diagnostics = {};

    try {
      const { rerender } = render(
        <ExecutionWorkspace state={runnableUiState()} setState={mockSetState} />,
      );

      await failExecuteLive();

      // Simulate MCP returning a match after auto-diagnose (same path as production).
      mcpKeyedState.diagnostics = { current: MATCHED_DIAGNOSTIC };
      await act(async () => {
        rerender(<ExecutionWorkspace state={runnableUiState()} setState={mockSetState} />);
      });

      await waitFor(() => {
        expect(screen.getAllByText(MATCHED_DIAGNOSTIC.title).length).toBeGreaterThanOrEqual(1);
      });

      // DiagnosisHistory sidebar appears once an entry is recorded.
      await waitFor(() => {
        expect(screen.getByText(/History \(1\)/i)).toBeDefined();
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
