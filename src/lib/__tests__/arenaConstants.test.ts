import { describe, it, expect } from "vitest";
import {
  ARENA_CLOUD_TIMEOUT_MS,
  ARENA_CLOUD_TIMEOUT_MIN_MS,
  ARENA_CLOUD_TIMEOUT_MAX_MS,
  resolveCloudTimeoutMs,
} from "@/lib/arenaConstants";

describe("resolveCloudTimeoutMs", () => {
  it("returns default for non-number / non-finite input", () => {
    expect(resolveCloudTimeoutMs(undefined)).toBe(ARENA_CLOUD_TIMEOUT_MS);
    expect(resolveCloudTimeoutMs(null)).toBe(ARENA_CLOUD_TIMEOUT_MS);
    expect(resolveCloudTimeoutMs("30000")).toBe(ARENA_CLOUD_TIMEOUT_MS);
    expect(resolveCloudTimeoutMs(Number.NaN)).toBe(ARENA_CLOUD_TIMEOUT_MS);
    expect(resolveCloudTimeoutMs(Number.POSITIVE_INFINITY)).toBe(ARENA_CLOUD_TIMEOUT_MS);
  });

  it("clamps below the minimum", () => {
    expect(resolveCloudTimeoutMs(0)).toBe(ARENA_CLOUD_TIMEOUT_MIN_MS);
    expect(resolveCloudTimeoutMs(-5)).toBe(ARENA_CLOUD_TIMEOUT_MIN_MS);
    expect(resolveCloudTimeoutMs(1)).toBe(ARENA_CLOUD_TIMEOUT_MIN_MS);
  });

  it("clamps above the maximum", () => {
    expect(resolveCloudTimeoutMs(ARENA_CLOUD_TIMEOUT_MAX_MS + 1)).toBe(ARENA_CLOUD_TIMEOUT_MAX_MS);
    expect(resolveCloudTimeoutMs(1_000_000)).toBe(ARENA_CLOUD_TIMEOUT_MAX_MS);
  });

  it("passes through values inside the range", () => {
    expect(resolveCloudTimeoutMs(15_000)).toBe(15_000);
    expect(resolveCloudTimeoutMs(ARENA_CLOUD_TIMEOUT_MS)).toBe(ARENA_CLOUD_TIMEOUT_MS);
  });
});
