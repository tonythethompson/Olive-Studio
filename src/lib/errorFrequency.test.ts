import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  errorFrequency,
  formatFrequencyDisplay,
  formatFrequencyForReport,
  type ErrorFrequencyInfo,
} from "./errorFrequency";

describe("errorFrequency", () => {
  beforeEach(() => {
    errorFrequency.clear();
  });

  describe("recordError", () => {
    it("records a new error and returns count 1", () => {
      const info = errorFrequency.recordError("Recipe builder", "Cannot read property 'map'");
      expect(info.count).toBe(1);
      expect(info.frequencyLabel).toBe("First occurrence");
    });

    it("increments count for repeated errors with same component and message", () => {
      errorFrequency.recordError("Recipe builder", "Cannot read property 'map'");
      errorFrequency.recordError("Recipe builder", "Cannot read property 'map'");
      const info = errorFrequency.recordError("Recipe builder", "Cannot read property 'map'");
      expect(info.count).toBe(3);
    });

    it("tracks different errors separately", () => {
      errorFrequency.recordError("Recipe builder", "Error A");
      errorFrequency.recordError("Recipe builder", "Error B");
      const infoA = errorFrequency.getFrequency("Recipe builder", "Error A");
      const infoB = errorFrequency.getFrequency("Recipe builder", "Error B");
      expect(infoA?.count).toBe(1);
      expect(infoB?.count).toBe(1);
    });

    it("tracks different components separately", () => {
      errorFrequency.recordError("Component A", "Same error");
      errorFrequency.recordError("Component B", "Same error");
      const infoA = errorFrequency.getFrequency("Component A", "Same error");
      const infoB = errorFrequency.getFrequency("Component B", "Same error");
      expect(infoA?.count).toBe(1);
      expect(infoB?.count).toBe(1);
    });

    it("updates lastOccurrence on repeat", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      const first = errorFrequency.recordError("Test", "Error");
      vi.advanceTimersByTime(1000);
      const second = errorFrequency.recordError("Test", "Error");

      expect(second.lastOccurrenceAgo).toBe(0);
      expect(first.lastOccurrenceAgo).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("getFrequency", () => {
    it("returns null for unknown errors", () => {
      const info = errorFrequency.getFrequency("Unknown", "Unknown error");
      expect(info).toBeNull();
    });

    it("returns info for known errors", () => {
      errorFrequency.recordError("Test", "Error");
      const info = errorFrequency.getFrequency("Test", "Error");
      expect(info).not.toBeNull();
      expect(info?.count).toBe(1);
    });

    it("prunes expired entries before lookup", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      errorFrequency.recordError("Aging", "stale error");
      expect(errorFrequency.getFrequency("Aging", "stale error")).not.toBeNull();

      // Advance past MAX_ENTRY_AGE_MS (1 hour)
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      expect(errorFrequency.getFrequency("Aging", "stale error")).toBeNull();
      expect(errorFrequency.getRecentErrors()).toEqual([]);

      vi.useRealTimers();
    });
  });

  describe("getRecentErrors", () => {
    it("returns empty array when no errors", () => {
      const errors = errorFrequency.getRecentErrors();
      expect(errors).toEqual([]);
    });

    it("returns errors sorted by count descending", () => {
      errorFrequency.recordError("A", "Error 1");
      errorFrequency.recordError("A", "Error 1");
      errorFrequency.recordError("A", "Error 1");
      errorFrequency.recordError("B", "Error 2");
      errorFrequency.recordError("B", "Error 2");

      const errors = errorFrequency.getRecentErrors();
      expect(errors.length).toBe(2);
      expect(errors[0]!.count).toBe(3);
      expect(errors[1]!.count).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all tracked errors", () => {
      errorFrequency.recordError("A", "Error 1");
      errorFrequency.recordError("B", "Error 2");
      errorFrequency.clear();
      const errors = errorFrequency.getRecentErrors();
      expect(errors).toEqual([]);
    });
  });
});

describe("formatFrequencyDisplay", () => {
  it("returns empty string for first occurrence", () => {
    const info: ErrorFrequencyInfo = {
      count: 1,
      firstOccurrenceAgo: 0,
      lastOccurrenceAgo: 0,
      frequencyLabel: "First occurrence",
    };
    expect(formatFrequencyDisplay(info)).toBe("");
  });

  it("returns frequency string for repeated errors", () => {
    const info: ErrorFrequencyInfo = {
      count: 5,
      firstOccurrenceAgo: 120,
      lastOccurrenceAgo: 10,
      frequencyLabel: "5 times in the last 5 minutes",
    };
    expect(formatFrequencyDisplay(info)).toContain("5 times");
  });
});

describe("formatFrequencyForReport", () => {
  it("returns empty string for first occurrence", () => {
    const info: ErrorFrequencyInfo = {
      count: 1,
      firstOccurrenceAgo: 0,
      lastOccurrenceAgo: 0,
      frequencyLabel: "First occurrence",
    };
    expect(formatFrequencyForReport(info)).toBe("");
  });

  it("returns formatted frequency for repeated errors", () => {
    const info: ErrorFrequencyInfo = {
      count: 3,
      firstOccurrenceAgo: 120,
      lastOccurrenceAgo: 10,
      frequencyLabel: "3 times in the last 5 minutes",
    };
    const report = formatFrequencyForReport(info);
    expect(report).toContain("3 occurrences");
    expect(report).toContain("First seen");
  });

  it("formats time correctly in minutes", () => {
    const info: ErrorFrequencyInfo = {
      count: 2,
      firstOccurrenceAgo: 90,
      lastOccurrenceAgo: 0,
      frequencyLabel: "2 times in the last minute",
    };
    const report = formatFrequencyForReport(info);
    expect(report).toContain("1m 30s ago");
  });

  it("formats time correctly in seconds only", () => {
    const info: ErrorFrequencyInfo = {
      count: 2,
      firstOccurrenceAgo: 30,
      lastOccurrenceAgo: 0,
      frequencyLabel: "2 times in the last minute",
    };
    const report = formatFrequencyForReport(info);
    expect(report).toContain("30s ago");
  });
});
