import { describe, expect, it } from "vitest";
import {
  hintForLmsPullFailure,
  mapLmsDownloadPercent,
  parseLmsGetPercent,
  splitCliLines,
  stripAnsi,
} from "./lmsPullProgress";

describe("lmsPullProgress", () => {
  it("parses CLI progress percent from bar and size lines", () => {
    expect(parseLmsGetPercent("[█▌                    ] 6.60% | 108.60 MB / 1.65 GB")).toBeCloseTo(6.6);
    expect(parseLmsGetPercent("42% | 100 MB / 200 MB")).toBe(42);
    expect(parseLmsGetPercent("Searching staff picks with the term phi")).toBeNull();
  });

  it("maps download percent into the NDJSON 5–95 band", () => {
    expect(mapLmsDownloadPercent(0)).toBe(5);
    expect(mapLmsDownloadPercent(100)).toBe(95);
    expect(mapLmsDownloadPercent(50)).toBe(50);
  });

  it("splits ANSI / CR CLI chunks into clean lines", () => {
    const chunk = "\x1b[2K\r[▏ ] 1.00% | 1 MB\r\nResolution completed.\n";
    expect(splitCliLines(chunk)).toEqual(
      expect.arrayContaining([expect.stringContaining("1.00%"), "Resolution completed."]),
    );
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("maps common failure logs to actionable hints", () => {
    expect(hintForLmsPullFailure("No staff picks found with the specified search criteria.", 1).hint).toMatch(
      /Hugging Face/i,
    );
    expect(hintForLmsPullFailure("This download is already in progress.", 1).error).toMatch(/already in progress/i);
    expect(hintForLmsPullFailure("Download failed: Timed-out. Please try to resume.", 1).hint).toMatch(/resume/i);
    expect(hintForLmsPullFailure("random cli noise", 1).hint).toMatch(/lms get/);
    // Byte counts must not be confused with HTTP 401 auth failures.
    expect(hintForLmsPullFailure("6.60% | 401.20 MB / 1.65 GB", 1).error).not.toMatch(/auth/i);
    expect(hintForLmsPullFailure("HTTP 401 Unauthorized from huggingface.co", 1).error).toMatch(/auth/i);
    expect(hintForLmsPullFailure("ENOSPC: no space left on device", 1).hint).toMatch(/space|disk/i);
  });
});
