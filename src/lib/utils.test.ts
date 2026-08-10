import { describe, expect, it } from "vitest";
import { formatBytes } from "./utils";

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("2 KB");
  });

  it("clamps unit index for very large values", () => {
    const atPiB = 1024 ** 5;
    expect(formatBytes(atPiB)).toMatch(/TB$/);
    expect(formatBytes(atPiB)).not.toContain("undefined");
  });

  it("supports custom decimal precision", () => {
    expect(formatBytes(5_000_000, 2)).toBe("4.77 MB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(-1)).toBe("?");
    expect(formatBytes(NaN)).toBe("?");
  });
});
