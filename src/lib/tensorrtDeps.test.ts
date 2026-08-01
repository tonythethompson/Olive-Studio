import { describe, expect, it } from "vitest";
import { PINNED_TENSORRT_VERSION, pinnedTensorRtInstallArgs, pinnedTensorRtLabel } from "./tensorrtDeps.ts";

describe("pinnedTensorRtInstallArgs", () => {
  it("passes a single pip requirement (package==version)", () => {
    expect(pinnedTensorRtInstallArgs()).toEqual([`tensorrt==${PINNED_TENSORRT_VERSION}`]);
  });

  it("does not split the pin into a bare ==version token", () => {
    for (const arg of pinnedTensorRtInstallArgs()) {
      expect(arg.startsWith("==")).toBe(false);
    }
  });

  it("labels the pin for UI/logs", () => {
    expect(pinnedTensorRtLabel()).toContain(PINNED_TENSORRT_VERSION);
  });
});
