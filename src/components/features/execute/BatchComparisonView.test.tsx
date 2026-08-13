import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchComparisonView } from "./BatchComparisonView";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import type { CompareResultsOutput } from "@/lib/types/agentTypes";

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

function makeCompareResults(overrides: Partial<CompareResultsOutput> = {}): CompareResultsOutput {
  return {
    results: [
      { job_id: "job-a", latency_ms: 120.5, model_size_mb: 4096, accuracy: 0.9521, score: 0.87 },
      { job_id: "job-b", latency_ms: 95.3, model_size_mb: 2048, accuracy: 0.9412, score: 0.92 },
    ],
    winner: "job-b",
    reasoning: "Job B has lower latency and smaller model size with minimal accuracy trade-off.",
    excluded_jobs: [],
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
    const closeBtn = screen.getByLabelText("Close comparison");
    fireEvent.click(closeBtn);
    expect(closed).toBe(true);
  });

  it("does not render close button when onClose is omitted", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    render(<BatchComparisonView records={records} />);
    expect(screen.queryByLabelText("Close comparison")).toBeNull();
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

  // ────────────────────────────────────────────────────────────
  // Scoring preference tests (Requirement 8.7)
  // ────────────────────────────────────────────────────────────

  it("hides scoring selector when onCompare is absent", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    render(<BatchComparisonView records={records} />);
    expect(screen.queryByLabelText("Scoring:")).toBeNull();
    expect(screen.queryByText("Compare Results")).toBeNull();
  });

  it("renders scoring preference selector with default 'balanced'", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    render(<BatchComparisonView records={records} onCompare={vi.fn()} />);
    const select = screen.getByLabelText("Scoring:") as HTMLSelectElement;
    expect(select.value).toBe("balanced");
  });

  it("scoring preference selector has all four options", () => {
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    render(<BatchComparisonView records={records} onCompare={vi.fn()} />);
    expect(screen.getByText("Balanced")).toBeDefined();
    expect(screen.getByText("Latency")).toBeDefined();
    expect(screen.getByText("Size")).toBeDefined();
    expect(screen.getByText("Accuracy")).toBeDefined();
  });

  it("calls onCompare with the selected scoring preference", () => {
    const onCompare = vi.fn();
    const records = [
      makeRecord({ id: "a", status: "completed" }),
      makeRecord({ id: "b", status: "completed" }),
    ];
    render(<BatchComparisonView records={records} onCompare={onCompare} completedJobCount={3} />);

    // Change to "latency" preference
    const select = screen.getByLabelText("Scoring:") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "latency" } });

    // Click Compare Results
    fireEvent.click(screen.getByText("Compare Results"));
    expect(onCompare).toHaveBeenCalledWith("latency");
  });

  // ────────────────────────────────────────────────────────────
  // Compare button enable/disable (Requirements 8.1, 8.2, 8.6)
  // ────────────────────────────────────────────────────────────

  it("disables Compare Results button when fewer than 2 completed jobs", () => {
    const records = [makeRecord({ id: "a", status: "completed" })];
    const onCompare = vi.fn();
    render(<BatchComparisonView records={records} onCompare={onCompare} completedJobCount={1} />);
    const btn = screen.getByText("Compare Results");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("enables Compare Results button when 2 or more completed jobs", () => {
    const records = [
      makeRecord({ id: "a", status: "completed" }),
      makeRecord({ id: "b", status: "completed" }),
    ];
    const onCompare = vi.fn();
    render(<BatchComparisonView records={records} onCompare={onCompare} completedJobCount={2} />);
    const btn = screen.getByText("Compare Results");
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("shows tooltip when Compare Results is disabled", () => {
    const records = [makeRecord({ id: "a", status: "completed" })];
    render(<BatchComparisonView records={records} onCompare={vi.fn()} completedJobCount={1} />);
    const btn = screen.getByText("Compare Results");
    const hint = screen.getByRole("tooltip");
    expect(hint).toBeDefined();
    expect(screen.getByText("At least 2 completed jobs required")).toBeDefined();
    expect(btn.getAttribute("aria-describedby")).toBe(hint.getAttribute("id"));
    expect(btn.getAttribute("title")).toBe("At least 2 completed jobs required");
  });

  // ────────────────────────────────────────────────────────────
  // Winner highlight (Requirement 8.4)
  // ────────────────────────────────────────────────────────────

  it("highlights winner row and shows reasoning when winner is non-null", () => {
    const records = [
      makeRecord({ id: "a", jobId: "job-a" }),
      makeRecord({ id: "b", jobId: "job-b" }),
    ];
    const compareResults = makeCompareResults({ winner: "job-b" });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    // Winner row should have the test id
    const winnerRow = screen.getByTestId("winner-row");
    expect(winnerRow).toBeDefined();

    // Reasoning text should be displayed
    expect(
      screen.getByText(/Job B has lower latency and smaller model size/),
    ).toBeDefined();
  });

  it("displays winner label with trophy icon prefix", () => {
    const records = [
      makeRecord({ id: "a", jobId: "job-a" }),
      makeRecord({ id: "b", jobId: "job-b" }),
    ];
    const compareResults = makeCompareResults({ winner: "job-b" });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);
    expect(screen.getByText(/Winner: job-b/)).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────
  // Null winner + excluded jobs (Requirement 8.5)
  // ────────────────────────────────────────────────────────────

  it("shows 'No clear winner' notice when winner is null", () => {
    const records = [
      makeRecord({ id: "a", jobId: "job-a" }),
      makeRecord({ id: "b", jobId: "job-b" }),
    ];
    const compareResults = makeCompareResults({
      winner: null,
      reasoning: "Metrics are too similar to determine a winner.",
      excluded_jobs: [
        { job_id: "job-c", reason: "Incomplete metrics" },
        { job_id: "job-d", reason: "Failed optimization" },
      ],
    });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    expect(screen.getByText("No clear winner could be determined")).toBeDefined();
    expect(screen.getByText("Metrics are too similar to determine a winner.")).toBeDefined();
  });

  it("lists excluded jobs with reasons when winner is null", () => {
    const records = [
      makeRecord({ id: "a", jobId: "job-a" }),
      makeRecord({ id: "b", jobId: "job-b" }),
    ];
    const compareResults = makeCompareResults({
      winner: null,
      excluded_jobs: [
        { job_id: "job-c", reason: "Incomplete metrics" },
        { job_id: "job-d", reason: "Failed optimization" },
      ],
    });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    expect(screen.getByText("Excluded Jobs")).toBeDefined();
    expect(screen.getByText("job-c")).toBeDefined();
    expect(screen.getByText(/Incomplete metrics/)).toBeDefined();
    expect(screen.getByText("job-d")).toBeDefined();
    expect(screen.getByText(/Failed optimization/)).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────
  // MCP compare_results table columns (Requirement 8.3)
  // ────────────────────────────────────────────────────────────

  it("displays MCP result columns matching metric keys", () => {
    const records = [makeRecord({ id: "a", jobId: "job-a" })];
    const compareResults = makeCompareResults();
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    expect(screen.getByText("Latency (ms)")).toBeDefined();
    expect(screen.getByText("Model Size (MB)")).toBeDefined();
    // "Accuracy" appears both in the scoring selector and column header
    expect(screen.getAllByText("Accuracy").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Weighted Score")).toBeDefined();
  });

  it("renders metric values from compare results", () => {
    const records = [makeRecord({ id: "a", jobId: "job-a" })];
    const compareResults = makeCompareResults({
      results: [
        { job_id: "job-a", latency_ms: 120.5, model_size_mb: 4096.0, accuracy: 0.9521, score: 0.87 },
      ],
      winner: "job-a",
    });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    expect(screen.getByText("120.5")).toBeDefined();
    expect(screen.getByText("4096.0")).toBeDefined();
    expect(screen.getByText("0.9521")).toBeDefined();
    expect(screen.getByText("0.87")).toBeDefined();
  });

  it("renders dash for null metric values", () => {
    const records = [makeRecord({ id: "a", jobId: "job-a" })];
    const compareResults = makeCompareResults({
      results: [
        { job_id: "job-a", latency_ms: null, model_size_mb: null, accuracy: null, score: 0.5 },
      ],
      winner: "job-a",
    });
    render(<BatchComparisonView records={records} compareResults={compareResults} />);

    // Count the dashes (some are from the original table too)
    const cells = screen.getAllByText("-");
    // At minimum there should be the 3 null metrics rendered as "-"
    expect(cells.length).toBeGreaterThanOrEqual(3);
  });
});
