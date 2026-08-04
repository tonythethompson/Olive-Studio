import { describe, expect, it } from "vitest";
import {
  evaluateDiskGate,
  formatBytesShort,
  LOCAL_PULL_DISK_HEADROOM,
  starterApproxBytes,
} from "./localEngineDisk";
import { LMS_STARTER_MODELS } from "../components/features/gemini/aiProviderCatalog";

describe("localEngineDisk", () => {
  it("resolves approx bytes for known LMS starters", () => {
    expect(starterApproxBytes(LMS_STARTER_MODELS[0]!.tag, "lms")).toBe(
      LMS_STARTER_MODELS[0]!.approxBytes,
    );
    expect(starterApproxBytes("custom-unknown-model", "lms")).toBeNull();
  });

  it("blocks when free space is below need × headroom", () => {
    const need = 1_000_000_000;
    const gated = evaluateDiskGate("lms", need, need);
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.needBytes).toBe(Math.ceil(need * LOCAL_PULL_DISK_HEADROOM));
      expect(gated.hint).toMatch(/free/i);
    }
  });

  it("allows when free space is sufficient or unknown", () => {
    expect(evaluateDiskGate("ollama", 10_000_000_000, 1_000_000_000).ok).toBe(true);
    expect(evaluateDiskGate("ollama", null, 1_000_000_000).ok).toBe(true);
    expect(evaluateDiskGate("lms", 100, null).ok).toBe(true);
  });

  it("formats byte sizes compactly", () => {
    expect(formatBytesShort(800_000_000)).toMatch(/MB|GB/);
    expect(formatBytesShort(1_700_000_000)).toMatch(/GB/);
  });
});
