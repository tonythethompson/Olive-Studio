import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformanceMetrics } from "./PerformanceMetrics";

describe("PerformanceMetrics", () => {
  it("omits cards for '-' sentinel values", () => {
    render(<PerformanceMetrics logs={["latency: 12.5 ms"]} />);
    expect(screen.getByText("Latency")).toBeTruthy();
    expect(screen.queryByText("Throughput")).toBeNull();
    expect(screen.queryByText("Memory")).toBeNull();
    expect(screen.queryByText("Compression")).toBeNull();
  });

  it("renders all cards when every metric is present", () => {
    render(
      <PerformanceMetrics
        logs={["latency: 12.5 ms", "throughput: 80 tok/s", "memory: 512 MB", "compression: 2.5x"]}
      />,
    );
    expect(screen.getByText("Latency")).toBeTruthy();
    expect(screen.getByText("Throughput")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("Compression")).toBeTruthy();
  });

  it("shows the empty-state description when no logs are provided", () => {
    render(<PerformanceMetrics />);
    expect(screen.getByText(/metrics will appear here/i)).toBeTruthy();
  });
});
