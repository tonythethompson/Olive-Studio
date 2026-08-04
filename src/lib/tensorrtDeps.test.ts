import { describe, expect, it } from "vitest";
import {
  PINNED_TENSORRT_VERSION,
  pinnedTensorRtInstallArgs,
  pinnedTensorRtInstallCommand,
  pinnedTensorRtLabel,
} from "./tensorrtDeps.ts";

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

describe("pinnedTensorRtInstallCommand", () => {
  it("renders a paste-able pip install command with the pinned version and no extra index", () => {
    expect(pinnedTensorRtInstallCommand()).toBe(`pip install tensorrt==${PINNED_TENSORRT_VERSION}`);
  });

  it("does not override PyPI with --index-url (TRT 10.x is published on PyPI)", () => {
    expect(pinnedTensorRtInstallCommand()).not.toContain("--index-url");
  });
});
