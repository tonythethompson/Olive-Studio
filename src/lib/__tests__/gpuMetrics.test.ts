import { describe, it, expect } from "vitest";
import {
  formatMb,
  formatPct,
  formatTemp,
  formatPower,
  formatMemPct,
  parseGpuMetrics,
  type GpuMetrics,
} from "@/lib/gpuMetrics";

describe("gpuMetrics formatting", () => {
  it("formatMb converts MiB to GiB when >= 1024", () => {
    expect(formatMb(2048)).toBe("2.0 GiB");
    expect(formatMb(512)).toBe("512 MiB");
    expect(formatMb(null)).toBe("—");
  });

  it("formatPct rounds to integer percentage", () => {
    expect(formatPct(45.7)).toBe("46%");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(null)).toBe("—");
  });

  it("formatTemp formats degrees Celsius", () => {
    expect(formatTemp(72)).toBe("72°C");
    expect(formatTemp(null)).toBe("—");
  });

  it("formatPower formats watts with one decimal", () => {
    expect(formatPower(150.5)).toBe("150.5W");
    expect(formatPower(null)).toBe("—");
  });

  it("formatMemPct computes used/total ratio", () => {
    expect(formatMemPct(512, 2048)).toBe("25%");
    expect(formatMemPct(null, 2048)).toBe("—");
    expect(formatMemPct(512, null)).toBe("—");
    expect(formatMemPct(512, 0)).toBe("—");
  });
});

describe("parseGpuMetrics", () => {
  const validSample = {
    index: 0,
    name: "NVIDIA GeForce RTX 4090",
    utilizationPct: 85,
    memUsedMb: 12000,
    memTotalMb: 24576,
    tempC: 70,
    powerW: 320.5,
  };

  it("accepts a valid GpuMetrics payload", () => {
    const metrics = parseGpuMetrics({
      timestamp: "2025-01-01T00:00:00.000Z",
      gpus: [validSample],
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.gpus).toHaveLength(1);
    expect(metrics!.gpus[0].name).toBe("NVIDIA GeForce RTX 4090");
  });

  it("accepts null metric fields", () => {
    const metrics = parseGpuMetrics({
      timestamp: "2025-01-01T00:00:00.000Z",
      gpus: [
        {
          ...validSample,
          utilizationPct: null,
          memUsedMb: null,
          memTotalMb: null,
          tempC: null,
          powerW: null,
        },
      ],
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.gpus[0].utilizationPct).toBeNull();
  });

  it("rejects non-objects and missing gpus", () => {
    expect(parseGpuMetrics(null)).toBeNull();
    expect(parseGpuMetrics("metrics")).toBeNull();
    expect(parseGpuMetrics({ timestamp: "2025-01-01T00:00:00.000Z" })).toBeNull();
    expect(parseGpuMetrics({ timestamp: "2025-01-01T00:00:00.000Z", gpus: "bad" })).toBeNull();
  });

  it("rejects incomplete GPU entries", () => {
    expect(
      parseGpuMetrics({
        timestamp: "2025-01-01T00:00:00.000Z",
        gpus: [{ index: 0, name: "GPU" }],
      }),
    ).toBeNull();
    expect(
      parseGpuMetrics({
        timestamp: "2025-01-01T00:00:00.000Z",
        gpus: [{ ...validSample, utilizationPct: "85" }],
      }),
    ).toBeNull();
  });
});

describe("GpuMetrics type", () => {
  it("can construct a valid GpuMetrics object", () => {
    const metrics: GpuMetrics = {
      timestamp: "2025-01-01T00:00:00.000Z",
      gpus: [
        {
          index: 0,
          name: "NVIDIA GeForce RTX 4090",
          utilizationPct: 85,
          memUsedMb: 12000,
          memTotalMb: 24576,
          tempC: 70,
          powerW: 320.5,
        },
      ],
    };
    expect(metrics.gpus).toHaveLength(1);
    expect(metrics.gpus[0].name).toBe("NVIDIA GeForce RTX 4090");
    expect(metrics.gpus[0].utilizationPct).toBe(85);
  });

  it("handles null metric values gracefully", () => {
    const metrics: GpuMetrics = {
      timestamp: "2025-01-01T00:00:00.000Z",
      gpus: [
        {
          index: 0,
          name: "Unknown GPU",
          utilizationPct: null,
          memUsedMb: null,
          memTotalMb: null,
          tempC: null,
          powerW: null,
        },
      ],
    };
    expect(formatPct(metrics.gpus[0].utilizationPct)).toBe("—");
    expect(formatMb(metrics.gpus[0].memUsedMb)).toBe("—");
    expect(formatTemp(metrics.gpus[0].tempC)).toBe("—");
    expect(formatPower(metrics.gpus[0].powerW)).toBe("—");
  });
});
