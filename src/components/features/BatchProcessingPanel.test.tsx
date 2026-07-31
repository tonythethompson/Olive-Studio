import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";

// Mock the pipeline store to avoid zustand coupling
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

// Mock hooks that make network calls
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
  fetchHardwareProbe: () =>
    Promise.resolve({
      providers: ["CPUExecutionProvider"],
      detectedProviders: ["CPUExecutionProvider"],
      cpuModel: "Test CPU",
    }),
  getSelectableProviders: () => ["CPUExecutionProvider"],
}));

import { BatchProcessingPanel } from "./BatchProcessingPanel";

describe("BatchProcessingPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": { providers: ["CPUExecutionProvider"] },
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
});
