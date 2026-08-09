import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchHardwareProbe,
  resetHardwareProbeFetchStateForTests,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";

const baseProbe = (overrides?: Partial<HardwareProbeResult>): HardwareProbeResult => ({
  probedAt: "2026-08-09T00:00:00.000Z",
  platform: {
    os: "Windows",
    arch: "x64",
    cpuModel: "test-cpu",
    cpuCores: 8,
    systemRamGb: 32,
  },
  detectedProviders: ["CPUExecutionProvider"],
  recommendedProvider: "CPUExecutionProvider",
  notes: [],
  ...overrides,
  platform: {
    os: "Windows",
    arch: "x64",
    cpuModel: "test-cpu",
    cpuCores: 8,
    systemRamGb: 32,
    ...overrides?.platform,
  },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("fetchHardwareProbe", () => {
  beforeEach(() => {
    resetHardwareProbeFetchStateForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    resetHardwareProbeFetchStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValueOnce(pending);

    const first = fetchHardwareProbe();
    const second = fetchHardwareProbe();

    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(baseProbe()));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(a.platform.systemRamGb).toBe(32);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached result within TTL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(baseProbe()));

    const first = await fetchHardwareProbe();
    const second = await fetchHardwareProbe();

    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(baseProbe({ probedAt: "t1" })))
      .mockResolvedValueOnce(jsonResponse(baseProbe({ probedAt: "t2" })));

    const first = await fetchHardwareProbe();
    vi.setSystemTime(new Date("2026-08-09T00:00:31.000Z"));
    const second = await fetchHardwareProbe();

    expect(first.probedAt).toBe("t1");
    expect(second.probedAt).toBe("t2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache when refresh=true", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(baseProbe({ probedAt: "cached" })))
      .mockResolvedValueOnce(jsonResponse(baseProbe({ probedAt: "refreshed" })));

    await fetchHardwareProbe();
    const refreshed = await fetchHardwareProbe(true);

    expect(refreshed.probedAt).toBe("refreshed");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/system/hardware-probe?refresh=1");
  });

  it("retries with refresh when systemRamGb is missing without deadlocking", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          baseProbe({
            platform: {
              os: "Windows",
              arch: "x64",
              cpuModel: "test-cpu",
              cpuCores: 8,
              systemRamGb: 0,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          baseProbe({
            platform: {
              os: "Windows",
              arch: "x64",
              cpuModel: "test-cpu",
              cpuCores: 8,
              systemRamGb: 16,
            },
          }),
        ),
      );

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("fetchHardwareProbe hung (deadlock)")), 1000);
    });

    const result = await Promise.race([fetchHardwareProbe(), timeout]);

    expect(result.platform.systemRamGb).toBe(16);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/system/hardware-probe");
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/system/hardware-probe?refresh=1");
  });

  it("throws when the probe endpoint returns an error status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "probe unavailable" }, 503));

    await expect(fetchHardwareProbe()).rejects.toThrow("probe unavailable");
  });
});
