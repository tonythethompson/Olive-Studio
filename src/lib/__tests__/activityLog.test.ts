/**
 * Property-based tests for the Activity Log utility functions (Task 5.3).
 * Validates correctness properties from design.md (Properties 9–11).
 *
 * Feature: v05-release, Property 9: Activity Log Entry Truncation
 * Feature: v05-release, Property 10: Activity Log Terminal Entry Correctness
 * Feature: v05-release, Property 11: Activity Log Bounded FIFO
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  truncateEntry,
  appendEntry,
  createTerminalEntry,
  MAX_LOG_ENTRIES,
  TRUNCATION_LIMITS,
} from "@/lib/activityLog";
import type {
  ActivityEntryKind,
  ActivityLogEntry,
  AgentSessionState,
} from "@/lib/types/agentTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_KINDS: ActivityEntryKind[] = [
  "reasoning",
  "tool_call",
  "tool_result",
  "decision",
  "error",
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid ActivityEntryKind. */
function arbKind(): fc.Arbitrary<ActivityEntryKind> {
  return fc.constantFrom(...ALL_KINDS);
}

/** Generate a HH:MM:SS timestamp string. */
function arbTimestamp(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: 23 }),
      fc.integer({ min: 0, max: 59 }),
      fc.integer({ min: 0, max: 59 }),
    )
    .map(
      ([h, m, s]) =>
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    );
}

/** Generate a unique entry ID. */
function arbEntryId(): fc.Arbitrary<string> {
  return fc.uuid();
}

/** Generate an ActivityLogEntry with arbitrary text length. */
function arbEntry(textOptions?: {
  minLength?: number;
  maxLength?: number;
}): fc.Arbitrary<ActivityLogEntry> {
  return fc.record({
    id: arbEntryId(),
    kind: arbKind(),
    timestamp: arbTimestamp(),
    text: fc.string({
      minLength: textOptions?.minLength ?? 0,
      maxLength: textOptions?.maxLength ?? 1024,
    }),
  });
}

/** Generate an entry with text guaranteed to EXCEED its kind-specific limit. */
function arbEntryExceedingLimit(): fc.Arbitrary<ActivityLogEntry> {
  return arbKind().chain((kind) => {
    const limit = TRUNCATION_LIMITS[kind];
    return fc.record({
      id: arbEntryId(),
      kind: fc.constant(kind),
      timestamp: arbTimestamp(),
      text: fc.string({ minLength: limit + 1, maxLength: limit + 200 }),
    });
  });
}

/** Generate an entry with text guaranteed to be WITHIN its kind-specific limit. */
function arbEntryWithinLimit(): fc.Arbitrary<ActivityLogEntry> {
  return arbKind().chain((kind) => {
    const limit = TRUNCATION_LIMITS[kind];
    return fc.record({
      id: arbEntryId(),
      kind: fc.constant(kind),
      timestamp: arbTimestamp(),
      text: fc.string({ minLength: 0, maxLength: limit }),
    });
  });
}

/** Generate a success outcome. */
function arbSuccessOutcome(): fc.Arbitrary<AgentSessionState["outcome"]> {
  return fc.record({
    status: fc.constant("success" as const),
    totalSteps: fc.integer({ min: 1, max: 10000 }),
    elapsedMs: fc.integer({ min: 0, max: 86400000 }),
  });
}

/** Generate a failure outcome. */
function arbFailureOutcome(): fc.Arbitrary<AgentSessionState["outcome"]> {
  return fc.record({
    status: fc.constant("failure" as const),
    totalSteps: fc.integer({ min: 0, max: 10000 }),
    elapsedMs: fc.integer({ min: 0, max: 86400000 }),
    errorDescription: fc.string({ minLength: 1, maxLength: 200 }),
  });
}

/** Generate a cancelled outcome. */
function arbCancelledOutcome(): fc.Arbitrary<AgentSessionState["outcome"]> {
  return fc.record({
    status: fc.constant("cancelled" as const),
    totalSteps: fc.integer({ min: 0, max: 10000 }),
    elapsedMs: fc.integer({ min: 0, max: 86400000 }),
    cancelledAtStep: fc.integer({ min: 1, max: 10000 }),
  });
}

/** Generate any outcome. */
function arbOutcome(): fc.Arbitrary<NonNullable<AgentSessionState["outcome"]>> {
  return fc.oneof(arbSuccessOutcome(), arbFailureOutcome(), arbCancelledOutcome()) as fc.Arbitrary<
    NonNullable<AgentSessionState["outcome"]>
  >;
}

/** Generate an array of entries with specified length. */
function arbEntryArray(
  minLength: number,
  maxLength: number,
): fc.Arbitrary<ActivityLogEntry[]> {
  return fc.array(arbEntry(), { minLength, maxLength });
}

// ─── Property 9: Activity Log Entry Truncation ───────────────────────────────

describe("Property 9: Activity Log Entry Truncation", () => {
  /**
   * Feature: v05-release, Property 9: Activity Log Entry Truncation
   *
   * For any ActivityLogEntry with kind "reasoning", the displayed text must be
   * at most 512 characters. For any entry with kind "tool_call" or "decision",
   * text must be at most 256 characters. For any entry with kind "tool_result"
   * or "error", text must be at most 512 characters. When the original text
   * exceeds the limit, expandedText must contain the full untruncated value.
   *
   * Validates: Requirements 7.2
   */

  it("entries exceeding the kind-specific limit are truncated to that limit", () => {
    fc.assert(
      fc.property(arbEntryExceedingLimit(), (entry) => {
        const result = truncateEntry(entry);
        const limit = TRUNCATION_LIMITS[entry.kind];

        // text must be truncated to exactly the limit
        expect(result.text.length).toBe(limit);
        expect(result.text.length).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 100 },
    );
  });

  it("entries exceeding the limit have expandedText set to the original full text", () => {
    fc.assert(
      fc.property(arbEntryExceedingLimit(), (entry) => {
        const result = truncateEntry(entry);

        // expandedText must equal the original full text
        expect(result.expandedText).toBe(entry.text);
      }),
      { numRuns: 100 },
    );
  });

  it("entries within the limit are returned as-is with no expandedText", () => {
    fc.assert(
      fc.property(arbEntryWithinLimit(), (entry) => {
        const result = truncateEntry(entry);

        // text unchanged
        expect(result.text).toBe(entry.text);
        // no expandedText added
        expect(result.expandedText).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("truncated text is a prefix of the original text", () => {
    fc.assert(
      fc.property(arbEntryExceedingLimit(), (entry) => {
        const result = truncateEntry(entry);
        const limit = TRUNCATION_LIMITS[entry.kind];

        // The truncated text must be the first N characters of the original
        expect(result.text).toBe(entry.text.slice(0, limit));
      }),
      { numRuns: 100 },
    );
  });

  it("all entry kinds have their correct truncation limits applied", () => {
    fc.assert(
      fc.property(arbEntry({ minLength: 0, maxLength: 1024 }), (entry) => {
        const result = truncateEntry(entry);
        const limit = TRUNCATION_LIMITS[entry.kind];

        // Result text never exceeds the kind-specific limit
        expect(result.text.length).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Activity Log Terminal Entry Correctness ────────────────────

describe("Property 10: Activity Log Terminal Entry Correctness", () => {
  /**
   * Feature: v05-release, Property 10: Activity Log Terminal Entry Correctness
   *
   * For any agent loop termination, the terminal entry must contain: on success
   * — total step count and elapsed wall-clock duration; on failure — the error
   * description from the failing step; on cancellation — the step number at
   * which cancellation occurred.
   *
   * Validates: Requirements 7.4
   */

  it("success outcome produces entry with totalSteps and elapsed duration", () => {
    fc.assert(
      fc.property(arbSuccessOutcome(), (outcome) => {
        const entry = createTerminalEntry(outcome);

        // Entry should be of kind "decision" for success
        expect(entry.kind).toBe("decision");

        // Text must contain the total steps count
        expect(entry.text).toContain(String(outcome!.totalSteps));

        // Text must contain "completed" or similar success indicator
        expect(entry.text.toLowerCase()).toContain("completed");

        // Entry must have a valid timestamp and id
        expect(entry.id).toBeTruthy();
        expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("failure outcome produces entry with error description", () => {
    fc.assert(
      fc.property(arbFailureOutcome(), (outcome) => {
        const entry = createTerminalEntry(outcome);

        // Entry should be of kind "error" for failure
        expect(entry.kind).toBe("error");

        // Text must contain the error description
        expect(entry.text).toContain(outcome!.errorDescription!);

        // Text must contain "failed" indicator
        expect(entry.text.toLowerCase()).toContain("failed");

        // Entry must have a valid timestamp and id
        expect(entry.id).toBeTruthy();
        expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("cancelled outcome produces entry with cancelledAtStep", () => {
    fc.assert(
      fc.property(arbCancelledOutcome(), (outcome) => {
        const entry = createTerminalEntry(outcome);

        // Entry should be of kind "decision" for cancellation
        expect(entry.kind).toBe("decision");

        // Text must contain the cancelled step number
        expect(entry.text).toContain(String(outcome!.cancelledAtStep));

        // Text must contain "cancelled" indicator
        expect(entry.text.toLowerCase()).toContain("cancelled");

        // Entry must have a valid timestamp and id
        expect(entry.id).toBeTruthy();
        expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("null outcome produces a graceful error entry", () => {
    const entry = createTerminalEntry(undefined);
    expect(entry.kind).toBe("error");
    expect(entry.text).toBeTruthy();
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("terminal entries always have valid structure regardless of outcome", () => {
    fc.assert(
      fc.property(arbOutcome(), (outcome) => {
        const entry = createTerminalEntry(outcome);

        // Always has required fields
        expect(entry.id).toBeTruthy();
        expect(typeof entry.id).toBe("string");
        expect(entry.kind).toBeTruthy();
        expect(ALL_KINDS).toContain(entry.kind);
        expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(typeof entry.text).toBe("string");
        expect(entry.text.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Activity Log Bounded FIFO ──────────────────────────────────

describe("Property 11: Activity Log Bounded FIFO", () => {
  /**
   * Feature: v05-release, Property 11: Activity Log Bounded FIFO
   *
   * For any activity log state, the entry count must never exceed 2000. When
   * at maximum capacity and a new entry is appended, the oldest entry must be
   * removed such that the count remains exactly 2000. When a new agent session
   * starts, all entries from the previous session must be cleared before
   * appending new entries.
   *
   * Validates: Requirements 7.5, 7.6
   */

  it("result length never exceeds MAX_LOG_ENTRIES after append", () => {
    fc.assert(
      fc.property(
        arbEntryArray(0, MAX_LOG_ENTRIES + 50),
        arbEntry(),
        (entries, newEntry) => {
          const result = appendEntry(entries, newEntry);
          expect(result.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when below capacity, all existing entries plus new entry are preserved", () => {
    fc.assert(
      fc.property(
        arbEntryArray(0, MAX_LOG_ENTRIES - 1),
        arbEntry(),
        (entries, newEntry) => {
          const result = appendEntry(entries, newEntry);

          // Length is entries.length + 1
          expect(result.length).toBe(entries.length + 1);

          // New entry is at the end
          expect(result[result.length - 1]).toEqual(newEntry);

          // All original entries preserved in order
          for (let i = 0; i < entries.length; i++) {
            expect(result[i]).toEqual(entries[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when at maximum capacity, oldest entry is evicted and new entry is appended", () => {
    // Pre-build a base array of MAX_LOG_ENTRIES entries for performance.
    // The property test varies only the new entry being appended.
    const baseEntries: ActivityLogEntry[] = Array.from(
      { length: MAX_LOG_ENTRIES },
      (_, i) => ({
        id: `base-${i}`,
        kind: "reasoning" as ActivityEntryKind,
        timestamp: "00:00:00",
        text: `entry-${i}`,
      }),
    );

    fc.assert(
      fc.property(arbEntry(), (newEntry) => {
        const result = appendEntry(baseEntries, newEntry);

        // Length must remain exactly MAX_LOG_ENTRIES
        expect(result.length).toBe(MAX_LOG_ENTRIES);

        // New entry is at the end
        expect(result[result.length - 1]).toEqual(newEntry);

        // First element of original was evicted
        expect(result[0]).toEqual(baseEntries[1]);

        // Spot-check FIFO order at a few positions
        expect(result[1]).toEqual(baseEntries[2]);
        expect(result[MAX_LOG_ENTRIES - 2]).toEqual(
          baseEntries[MAX_LOG_ENTRIES - 1],
        );
      }),
      { numRuns: 100 },
    );
  });

  it("appendEntry always returns a new array (no mutation)", () => {
    fc.assert(
      fc.property(
        arbEntryArray(0, 100),
        arbEntry(),
        (entries, newEntry) => {
          const originalLength = entries.length;
          const result = appendEntry(entries, newEntry);

          // Original array not mutated
          expect(entries.length).toBe(originalLength);

          // Result is a different reference
          expect(result).not.toBe(entries);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when above capacity (overflow scenario), multiple oldest entries are evicted", () => {
    // Pre-build base entries slightly above the max for performance
    const overflowCount = 10;
    const baseEntries: ActivityLogEntry[] = Array.from(
      { length: MAX_LOG_ENTRIES + overflowCount },
      (_, i) => ({
        id: `overflow-${i}`,
        kind: "tool_call" as ActivityEntryKind,
        timestamp: "12:00:00",
        text: `overflow-entry-${i}`,
      }),
    );

    fc.assert(
      fc.property(arbEntry(), (newEntry) => {
        const result = appendEntry(baseEntries, newEntry);

        // Result must be exactly MAX_LOG_ENTRIES
        expect(result.length).toBe(MAX_LOG_ENTRIES);

        // New entry is always at the end
        expect(result[result.length - 1]).toEqual(newEntry);
      }),
      { numRuns: 100 },
    );
  });

  it("FIFO order: the newest entry is always the last element", () => {
    fc.assert(
      fc.property(
        arbEntryArray(0, MAX_LOG_ENTRIES),
        arbEntry(),
        (entries, newEntry) => {
          const result = appendEntry(entries, newEntry);
          expect(result[result.length - 1]).toEqual(newEntry);
        },
      ),
      { numRuns: 100 },
    );
  });
});
