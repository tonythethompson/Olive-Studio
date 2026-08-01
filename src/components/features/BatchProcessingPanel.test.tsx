import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";
import { BatchProcessingPanel } from "./BatchProcessingPanel";
import type { UIState, BatchJob } from "@/types";

// Mock the pipeline store to avoid zustand coupling
const mockSetState = vi.fn();
let mockStoreState = createMockUIState();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: mockStoreState,
    setState: mockSetState,
  }),
}));

// Mock hooks that make network calls
const mockFetchKeyedDiagnostic = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useAutoClearError: () => [null, vi.fn()],
  useMcpDiagnosticKeyed: () => ({
    fetchKeyedDiagnostic: mockFetchKeyedDiagnostic,
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
  getSelectableProviders: () => ["CPUExecutionProvider"],
}));

describe("BatchProcessingPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": {
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    },
  });

  it("renders the panel heading", async () => {
    await act(async () => {
      render(<BatchProcessingPanel />);
    });
    expect(screen.getAllByText(/batch/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState();
    await act(async () => {
      render(<BatchProcessingPanel state={state} setState={mockSetState} />);
    });
    expect(screen.getAllByText(/batch/i).length).toBeGreaterThan(0);
  });

  it("shows empty state when no jobs exist", async () => {
    await act(async () => {
      render(<BatchProcessingPanel />);
    });
    // The panel should render without errors when no batch jobs are present
    expect(screen.queryByText(/running/i)).toBeNull();
  });

  it("renders the Custom Job button to add jobs", async () => {
    await act(async () => {
      render(<BatchProcessingPanel />);
    });
    const addButton = screen.getByRole("button", { name: /custom job/i });
    expect(addButton).toBeDefined();
  });

  it("validates each queued job individually and blocks invalid jobs while allowing valid ones to proceed", async () => {
    // Setup: valid global state with one valid job and one invalid job in the queue
    const validJob: BatchJob = {
      id: "job-valid",
      name: "Valid Job",
      modelSource: "huggingface",
      modelIdentifier: "meta-llama/Llama-3-8B",
      provider: "CPUExecutionProvider",
      passes: ["Model Conversion (ONNX)"],
      recipeJson: undefined,
      status: "queued",
      progress: 0,
      progressKnown: true,
      logs: ["Valid job queued"],
    };

    // Invalid job: WebGpuExecutionProvider is browser-only, blocked for local execution
    const invalidJob: BatchJob = {
      id: "job-invalid",
      name: "Invalid Job",
      modelSource: "huggingface",
      modelIdentifier: "microsoft/phi-2",
      provider: "WebGpuExecutionProvider",
      passes: ["Model Conversion (ONNX)"],
      recipeJson: undefined,
      status: "queued",
      progress: 0,
      progressKnown: true,
      logs: ["Invalid job queued"],
    };

    const stateWithJobs: UIState = {
      ...createMockUIState(),
      batchJobs: [validJob, invalidJob],
    };

    mockStoreState = stateWithJobs;
    mockSetState.mockClear();
    mockFetchKeyedDiagnostic.mockClear();

    // Mock fetch for the valid job's POST request
    global.fetch = vi.fn((url) => {
      if (url === "/api/olive/run") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobId: "olive-job-123" }),
        } as Response);
      }
      return Promise.reject(new Error("Unexpected fetch"));
    });

    // Mock EventSource for the valid job's stream
    const mockEventSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      onerror: null,
    };
    global.EventSource = vi.fn(() => mockEventSource) as unknown as typeof EventSource;

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    const startButton = screen.getByRole("button", { name: /start queue/i });
    expect(startButton).toBeDefined();

    await act(async () => {
      await userEvent.click(startButton);
    });

    // Wait for the validation and state updates
    await waitFor(
      () => {
        expect(mockSetState).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    // Verify the invalid job was marked as failed due to validation
    const failedJobUpdates = mockSetState.mock.calls.filter((call) => {
      const update = call[0];
      return (
        update.batchJobs &&
        update.batchJobs.some(
          (j: BatchJob) =>
            j.id === "job-invalid" &&
            j.status === "failed" &&
            j.logs.some((log: string) => log.includes("validation failed")),
        )
      );
    });
    expect(failedJobUpdates.length).toBeGreaterThan(0);

    // Verify diagnostic was called for the failed invalid job
    expect(mockFetchKeyedDiagnostic).toHaveBeenCalledWith("job-invalid", expect.any(Array));

    // Verify the valid job was attempted to run (fetch was called for /api/olive/run)
    await waitFor(
      () => {
        expect(global.fetch).toHaveBeenCalledWith("/api/olive/run", expect.any(Object));
      },
      { timeout: 3000 },
    );
  });
});
