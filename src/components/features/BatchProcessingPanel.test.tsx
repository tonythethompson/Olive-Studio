import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";
import type { UIState, BatchJob, McpDiagnostic } from "@/types";
import { BatchProcessingPanel } from "./BatchProcessingPanel";

// Mock the pipeline store to avoid zustand coupling
const mockSetState = vi.fn();
let mockStoreState = createMockUIState();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: mockStoreState,
    setState: mockSetState,
  }),
}));

const MATCHED_DIAGNOSTIC: McpDiagnostic = {
  matched_entry: "quantization-precision-mismatch",
  title: "Quantization Precision Not Supported",
  root_cause: "EP does not support requested precision.",
  workaround: "Switch to INT8 or a supporting EP.",
  domain: "olive",
  applyable: false,
};

const UNMATCHED_DIAGNOSTIC: McpDiagnostic = {
  matched_entry: null,
  title: "Local unmatched failure",
  root_cause: "No MCP entry.",
  workaround: "Inspect batch logs.",
};

// Mock hooks that make network calls
const mockFetchKeyedDiagnostic = vi.fn();
const batchMcpState = {
  diagnostics: {} as Record<string, McpDiagnostic | null>,
  diagnosingKeys: {} as Record<string, boolean>,
  errors: {} as Record<string, string | null>,
};

const mockRequestFeedback = vi.fn();

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAutoClearError: () => ["", vi.fn()],
    useMcpDiagnosticKeyed: () => ({
      fetchKeyedDiagnostic: mockFetchKeyedDiagnostic,
      diagnostics: batchMcpState.diagnostics,
      diagnosingKeys: batchMcpState.diagnosingKeys,
      errors: batchMcpState.errors,
      diagnosticKey: "current",
    }),
    requestMcpTroubleshootFeedback: (...args: unknown[]) => mockRequestFeedback(...args),
  };
});

// Mock hardware probe
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
    getSelectableProviders: () => ["CPUExecutionProvider"],
  };
});

function failedJob(id = "job-failed"): BatchJob {
  return {
    id,
    name: "Failed Job",
    modelSource: "huggingface",
    modelIdentifier: "microsoft/phi-2",
    provider: "CPUExecutionProvider",
    passes: ["Model Conversion (ONNX)"],
    recipeJson: undefined,
    status: "failed",
    progress: 0,
    progressKnown: true,
    logs: ["[ERROR] Simulated batch failure (no Olive)"],
  };
}

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

  beforeEach(() => {
    mockStoreState = createMockUIState();
    mockSetState.mockClear();
    mockFetchKeyedDiagnostic.mockClear();
    batchMcpState.diagnostics = {};
    batchMcpState.diagnosingKeys = {};
    batchMcpState.errors = {};
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
    }) as unknown as typeof fetch;

    // Mock EventSource for the valid job's stream. Capture the "done"
    // listener so the test can immediately signal a successful run,
    // letting the sequential job loop proceed to the invalid job.
    const doneListeners: Array<(e: { data: string }) => void> = [];
    const mockEventSource = {
      addEventListener: vi.fn((event: string, cb: (e: { data: string }) => void) => {
        if (event === "done") doneListeners.push(cb);
      }),
      close: vi.fn(),
      onerror: null,
    };
    global.EventSource = vi.fn(function EventSourceMock() {
      return mockEventSource;
    }) as unknown as typeof EventSource;

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    const startButton = screen.getByRole("button", { name: /start queue/i });
    expect(startButton).toBeDefined();

    await act(async () => {
      await userEvent.click(startButton);
      // Let the valid job's SSE stream complete so the sequential loop
      // moves on to validate the invalid job.
      await waitFor(() => expect(doneListeners.length).toBeGreaterThan(0));
      doneListeners.forEach((cb) => cb({ data: JSON.stringify({ exitCode: 0 }) }));
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

  it("settles a job when halt wins before SSE and cancel reports already completed", async () => {
    const queuedJob: BatchJob = {
      id: "job-race",
      name: "Race Job",
      modelSource: "huggingface",
      modelIdentifier: "meta-llama/Llama-3-8B",
      provider: "CPUExecutionProvider",
      passes: ["Model Conversion (ONNX)"],
      recipeJson: undefined,
      status: "queued",
      progress: 0,
      progressKnown: true,
      logs: ["Queued"],
    };
    const stateWithJobs: UIState = {
      ...createMockUIState(),
      batchJobs: [queuedJob],
    };
    mockStoreState = stateWithJobs;
    mockSetState.mockClear();

    let resolveRun!: (value: Response) => void;
    const runPending = new Promise<Response>((resolve) => {
      resolveRun = resolve;
    });

    global.fetch = vi.fn((url) => {
      if (url === "/api/olive/run") return runPending;
      if (url === "/api/olive/cancel") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, status: "completed" }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    }) as unknown as typeof fetch;

    const eventSourceCtor = vi.fn(function EventSourceMock() {
      return { addEventListener: vi.fn(), close: vi.fn(), onerror: null };
    });
    global.EventSource = eventSourceCtor as unknown as typeof EventSource;

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /start queue/i }));
    });

    // Halt while POST /olive/run is still in flight.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /halt/i })).toBeDefined();
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /halt/i }));
    });

    await act(async () => {
      resolveRun({
        ok: true,
        json: () => Promise.resolve({ jobId: "olive-already-done" }),
      } as Response);
    });

    await waitFor(() => {
      const settled = mockSetState.mock.calls.some((call) => {
        const update = call[0] as { batchJobs?: BatchJob[] };
        return update.batchJobs?.some(
          (j) =>
            j.id === "job-race" &&
            j.status === "completed" &&
            j.oliveJobId === "olive-already-done" &&
            j.logs.some((log) => log.includes("already completed")),
        );
      });
      expect(settled).toBe(true);
    });

    expect(eventSourceCtor).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/olive/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jobId: "olive-already-done" }),
      }),
    );
  });

  it("shows feedback thumbs for a failed job with a matched MCP diagnostic", async () => {
    const user = userEvent.setup();
    const job = failedJob("job-fb-matched");
    const stateWithJobs: UIState = {
      ...createMockUIState(),
      batchJobs: [job],
    };
    mockStoreState = stateWithJobs;
    batchMcpState.diagnostics = { [job.id]: MATCHED_DIAGNOSTIC };

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    // Select the failed job to open the detail panel + MCP card.
    await user.click(screen.getByText(job.name));

    await waitFor(() => {
      expect(screen.getByText(/Olive MCP Error Diagnostic/i)).toBeDefined();
    });
    expect(screen.getByText(MATCHED_DIAGNOSTIC.title)).toBeDefined();
    expect(screen.getByRole("button", { name: /Thumbs up/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Thumbs down/i })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i }));
    await waitFor(() => {
      expect(mockRequestFeedback).toHaveBeenCalledWith(
        { matched_entry: MATCHED_DIAGNOSTIC.matched_entry, rating: "thumbs-up" },
        expect.any(AbortSignal),
      );
    });
  });

  it("hides feedback controls for unmatched diagnostics on failed batch jobs", async () => {
    const user = userEvent.setup();
    const job = failedJob("job-fb-unmatched");
    const stateWithJobs: UIState = {
      ...createMockUIState(),
      batchJobs: [job],
    };
    mockStoreState = stateWithJobs;
    batchMcpState.diagnostics = { [job.id]: UNMATCHED_DIAGNOSTIC };

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    await user.click(screen.getByText(job.name));

    await waitFor(() => {
      expect(screen.getByText(UNMATCHED_DIAGNOSTIC.title)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thumbs down/i })).toBeNull();
  });

  it("deletes a job with Enter/Space on the delete control without relying on card selection", async () => {
    const user = userEvent.setup();
    const job: BatchJob = {
      id: "job-kbd-delete",
      name: "Keyboard Delete Job",
      modelSource: "huggingface",
      modelIdentifier: "microsoft/phi-2",
      provider: "CPUExecutionProvider",
      passes: ["Model Conversion (ONNX)"],
      recipeJson: undefined,
      status: "queued",
      progress: 0,
      progressKnown: true,
      logs: ["queued"],
    };
    const stateWithJobs: UIState = {
      ...createMockUIState(),
      batchJobs: [job],
    };
    mockStoreState = stateWithJobs;

    await act(async () => {
      render(<BatchProcessingPanel state={stateWithJobs} setState={mockSetState} />);
    });

    const deleteBtn = screen.getByRole("button", { name: /Delete batch job Keyboard Delete Job/i });
    deleteBtn.focus();
    await user.keyboard("{Enter}");

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        batchJobs: [],
      }),
    );
  });
});
