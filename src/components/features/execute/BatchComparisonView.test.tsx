import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchComparisonView } from "./BatchComparisonView";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";

function makeRecord(overrides: Partial<JobHistoryRecord> = {}): JobHistoryRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    jobId: "job-1",
    modelId: "meta-llama/Llama-3-8B",
    ihvProvider: "CUDAExecutionProvider",
    memoryOffload: "none",
    status: "completed",
    exitCode: 0,
    durationMs: 45000,
    timestamp: "2025-01-15T10:30:00Z",
    passCount: 3,
    passNames: ["Conversion", "Quantization", "Optimization"],
    vramEstimateGb: 8.5,
    logSummary: { totalLogs: 120, errorCount: 0, lastLog: "Done" },
    recipeJson: "",
    ...overrides,
  };
}

describe("BatchComparisonView", () => {
  it("renders comparison table with correct record count", () => {
    const records = [
      makeRecord({ id: "a", modelId: "model-a" }),
      makeRecord({ id: "b", modelId: "model-b", durationMs: 60000 }),
    ];
    render(<BatchComparisonView records={records} />);
    expect(screen.getByText("Comparing 2 Runs")).toBeDefined();
    expect(screen.getByText("model-a")).toBeDefined();
    expect(screen.getByText("model-b")).toBeDefined();
  });

  it("shows delta indicators relative to baseline", () => {
    const records = [
      makeRecord({ id: "a", modelId: "fast", durationMs: 10000 }),
      makeRecord({ id: "b", modelId: "slow", durationMs: 50000 }),
    ];
    render(<BatchComparisonView records={records} />);
    // The slower record should show a positive delta
    expect(screen.getByText("+40s")).toBeDefined();
  });

  it("renders close button when onClose is provided", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    let closed = false;
    render(
      <BatchComparisonView
        records={records}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    const closeBtn = screen.getByRole("button");
    fireEvent.click(closeBtn);
    expect(closed).toBe(true);
  });

  it("does not render close button when onClose is omitted", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    render(<BatchComparisonView records={records} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sorts by column header click", () => {
    const records = [
      makeRecord({ id: "a", modelId: "zebra", durationMs: 10000 }),
      makeRecord({ id: "b", modelId: "alpha", durationMs: 50000 }),
    ];
    render(<BatchComparisonView records={records} />);
    // Click "Model" header to sort alphabetically
    fireEvent.click(screen.getByText("Model"));
    const rows = screen.getAllByRole("row");
    // First data row should be "alpha" after ascending sort
    expect(rows[1].textContent).toContain("alpha");
  });

  it("displays VRAM values formatted to 1 decimal", () => {
    const records = [
      makeRecord({ id: "a", vramEstimateGb: 12.345 }),
      makeRecord({ id: "b", vramEstimateGb: 8.0 }),
    ];
    render(<BatchComparisonView records={records} />);
    expect(screen.getByText("12.3")).toBeDefined();
    expect(screen.getByText("8.0")).toBeDefined();
  });
});
