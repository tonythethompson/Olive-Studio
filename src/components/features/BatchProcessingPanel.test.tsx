import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  fetchHardwareProbe: () => Promise.resolve({ providers: ["CPUExecutionProvider"] }),
  getSelectableProviders: () => ["CPUExecutionProvider"],
}));

import { BatchProcessingPanel } from "./BatchProcessingPanel";

describe("BatchProcessingPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": { providers: ["CPUExecutionProvider"] },
  });

  it("renders the panel heading", () => {
    render(<BatchProcessingPanel />);
    expect(screen.getAllByText(/batch/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", () => {
    const state = createMockUIState();
    render(<BatchProcessingPanel state={state} setState={mockSetState} />);
    expect(screen.getAllByText(/batch/i).length).toBeGreaterThan(0);
  });

  it("shows empty state when no jobs exist", () => {
    render(<BatchProcessingPanel />);
    // The panel should render without errors when no batch jobs are present
    expect(screen.queryByText(/running/i)).toBeNull();
  });

  it("renders the Custom Job button to add jobs", () => {
    render(<BatchProcessingPanel />);
    const addButton = screen.getByRole("button", { name: /custom job/i });
    expect(addButton).toBeDefined();
  });
});
