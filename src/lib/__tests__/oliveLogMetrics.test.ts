import { describe, it, expect } from "vitest";
import { parseOliveMetricsFromLogs } from "@/lib/oliveLogMetrics";

describe("parseOliveMetricsFromLogs", () => {
  it("returns undefined when no metric pattern matches", () => {
    expect(parseOliveMetricsFromLogs(["Starting Olive run...", "No metrics here."])).toBeUndefined();
  });

  it("emits '-' for fields absent from a partial match", () => {
    const result = parseOliveMetricsFromLogs(["latency: 12.5 ms"]);
    expect(result).toEqual({
      latency: "12.5 ms",
      throughput: "-",
      memory: "-",
      compression: "-",
    });
  });

  it("captures all four fields when present, leaving no sentinel", () => {
    const result = parseOliveMetricsFromLogs([
      "latency: 12.5 ms",
      "throughput: 80 tok/s",
      "memory: 512 MB",
      "compression: 2.5x",
    ]);
    expect(result).toEqual({
      latency: "12.5 ms",
      throughput: "80 tok/s",
      memory: "512 MB",
      compression: "2.5x",
    });
  });
});
