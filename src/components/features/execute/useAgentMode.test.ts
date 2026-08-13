// @vitest-environment jsdom
/**
 * Unit tests for useAgentMode hook (Task 6.1).
 *
 * Validates: Requirements 6.1, 6.3, 6.4, 6.6, 7.5
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentMode } from "./useAgentMode";
import { MAX_LOG_ENTRIES } from "@/lib/activityLog";
import type { ActivityLogEntry, AgentOutcome } from "@/lib/types/agentTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<ActivityLogEntry>): ActivityLogEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "reasoning",
    timestamp: "12:00:00",
    text: "Test entry text",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useAgentMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ─── Initial State ───────────────────────────────────────────────────────

  describe("initial state", () => {
    it("defaults to manual mode with agent not running", () => {
      const { result } = renderHook(() => useAgentMode());

      expect(result.current.mode).toBe("manual");
      expect(result.current.agentRunning).toBe(false);
      expect(result.current.entries).toEqual([]);
      expect(result.current.outcome).toBeUndefined();
      expect(result.current.startedAt).toBeUndefined();
    });
  });

  // ─── setMode ─────────────────────────────────────────────────────────────

  describe("setMode", () => {
    it("switches to agent mode", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.setMode("agent");
      });

      expect(result.current.mode).toBe("agent");
    });

    it("switches back to manual mode", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.setMode("agent");
      });
      act(() => {
        result.current.setMode("manual");
      });

      expect(result.current.mode).toBe("manual");
    });
  });

  // ─── startAgent ──────────────────────────────────────────────────────────

  describe("startAgent", () => {
    it("sets agentRunning to true and records startedAt", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
      });

      expect(result.current.agentRunning).toBe(true);
      expect(result.current.startedAt).toBeDefined();
      // startedAt should be a valid ISO 8601 string
      expect(new Date(result.current.startedAt!).toISOString()).toBe(
        result.current.startedAt,
      );
    });

    it("clears previous session entries on new start (Req 7.5)", () => {
      const { result } = renderHook(() => useAgentMode());

      // Simulate some entries from a previous session
      act(() => {
        result.current.appendEntry(makeEntry({ text: "old entry 1" }));
        result.current.appendEntry(makeEntry({ text: "old entry 2" }));
      });
      expect(result.current.entries.length).toBe(2);

      // Start new session — entries should be cleared
      act(() => {
        result.current.startAgent();
      });

      expect(result.current.entries).toEqual([]);
      expect(result.current.outcome).toBeUndefined();
    });

    it("appends error entry after 10s timeout if not confirmed (Req 6.4)", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
      });

      expect(result.current.agentRunning).toBe(true);

      // Fast-forward 10 seconds
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      // Should have an error entry and agentRunning reset to false
      expect(result.current.agentRunning).toBe(false);
      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].kind).toBe("error");
      expect(result.current.entries[0].text).toContain("10 seconds");
      expect(result.current.outcome?.status).toBe("failure");
    });

    it("ignores a late submit after the 10s timeout and cancels that job", async () => {
      let resolveSubmit: (value: Response) => void = () => {};
      const submitPromise = new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
      const fetchMock = vi.fn((url: string) => {
        if (String(url).includes("/olive/jobs/submit")) return submitPromise;
        return Promise.resolve({ ok: true, json: async () => ({ status: "cancelled" }) } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useAgentMode());

      await act(async () => {
        void result.current.startAgent({ recipeJson: "{}" });
      });

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(result.current.agentRunning).toBe(false);
      expect(result.current.jobId).toBeUndefined();

      await act(async () => {
        resolveSubmit({
          ok: true,
          json: async () => ({ jobId: "late-job" }),
        } as Response);
        await Promise.resolve();
      });

      expect(result.current.jobId).toBeUndefined();
      expect(result.current.agentRunning).toBe(false);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/olive/agent/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("does not fire timeout if confirmStart is called before 10s", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
      });

      act(() => {
        result.current.confirmStart();
      });

      // Fast-forward past the timeout
      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      // Agent should still be running, no error entry
      expect(result.current.agentRunning).toBe(true);
      expect(result.current.entries).toEqual([]);
    });
  });

  // ─── stopAgent ───────────────────────────────────────────────────────────

  describe("stopAgent", () => {
    it("sets agentRunning to false and creates cancellation terminal entry (Req 6.6)", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
        result.current.confirmStart();
      });

      act(() => {
        result.current.stopAgent();
      });

      expect(result.current.agentRunning).toBe(false);
      expect(result.current.outcome).toBeDefined();
      expect(result.current.outcome!.status).toBe("cancelled");
      // Terminal entry should be appended
      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].kind).toBe("decision");
      expect(result.current.entries[0].text.toLowerCase()).toContain(
        "cancelled",
      );
    });

    it("reports failure and stays running when cancel API fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (String(url).includes("/olive/jobs/submit")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ jobId: "job-cancel-fail" }),
            } as Response);
          }
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "cancel denied" }),
          } as Response);
        }),
      );

      const { result } = renderHook(() => useAgentMode());

      await act(async () => {
        await result.current.startAgent({ recipeJson: "{}" });
      });
      expect(result.current.jobId).toBe("job-cancel-fail");

      await act(async () => {
        result.current.stopAgent();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.agentRunning).toBe(true);
      expect(result.current.outcome?.status).toBe("failure");
      expect(result.current.outcome?.errorDescription).toContain("cancel denied");
    });

    it("reattaches a late job when stop-during-submit cancel fails", async () => {
      let resolveSubmit: (value: Response) => void = () => {};
      const submitPromise = new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (String(url).includes("/olive/jobs/submit")) return submitPromise;
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "cancel denied" }),
          } as Response);
        }),
      );

      const { result } = renderHook(() => useAgentMode());

      let startDone: Promise<void> = Promise.resolve();
      act(() => {
        startDone = result.current.startAgent({ recipeJson: "{}" });
      });

      act(() => {
        result.current.stopAgent();
        result.current.stopAgent();
        result.current.stopAgent();
      });
      expect(result.current.outcome?.status).not.toBe("cancelled");
      expect(result.current.agentRunning).toBe(true);

      await act(async () => {
        resolveSubmit({
          ok: true,
          json: async () => ({ jobId: "late-job" }),
        } as Response);
        await startDone;
      });

      expect(result.current.jobId).toBe("late-job");
      expect(result.current.agentRunning).toBe(true);
      expect(result.current.outcome?.status).toBe("failure");
    });

    it("does not apply a stale cancel after a newer session starts", async () => {
      let resolveCancel: (value: Response) => void = () => {};
      const cancelPromise = new Promise<Response>((resolve) => {
        resolveCancel = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (String(url).includes("/olive/jobs/submit")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ jobId: `job-${Math.random()}` }),
            } as Response);
          }
          return cancelPromise;
        }),
      );

      const { result } = renderHook(() => useAgentMode());

      await act(async () => {
        await result.current.startAgent({ recipeJson: "{}" });
      });
      const firstJob = result.current.jobId;
      expect(firstJob).toBeDefined();

      act(() => {
        result.current.stopAgent();
      });

      await act(async () => {
        await result.current.startAgent({ recipeJson: "{}" });
      });
      const secondJob = result.current.jobId;
      expect(secondJob).toBeDefined();
      expect(secondJob).not.toBe(firstJob);
      expect(result.current.agentRunning).toBe(true);

      await act(async () => {
        resolveCancel({
          ok: true,
          json: async () => ({ status: "cancelled" }),
        } as Response);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.agentRunning).toBe(true);
      expect(result.current.jobId).toBe(secondJob);
      expect(result.current.outcome).toBeUndefined();
    });

    it("clears the start timeout if stop is called before 10s", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
      });

      // Stop before timeout fires
      act(() => {
        result.current.stopAgent();
      });

      // Advance past timeout — should NOT add an error entry
      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      // Only the terminal cancellation entry should exist
      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].kind).toBe("decision");
    });
  });

  // ─── completeAgent ───────────────────────────────────────────────────────

  describe("completeAgent", () => {
    it("records success outcome with terminal entry", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
        result.current.confirmStart();
      });

      const successOutcome: AgentOutcome = {
        status: "success",
        totalSteps: 5,
        elapsedMs: 12000,
      };

      act(() => {
        result.current.completeAgent(successOutcome);
      });

      expect(result.current.agentRunning).toBe(false);
      expect(result.current.outcome).toEqual(successOutcome);
      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].kind).toBe("decision");
      expect(result.current.entries[0].text).toContain("5");
    });

    it("records failure outcome with error terminal entry", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.startAgent();
        result.current.confirmStart();
      });

      const failureOutcome: AgentOutcome = {
        status: "failure",
        totalSteps: 3,
        elapsedMs: 8000,
        errorDescription: "MCP tool timed out",
      };

      act(() => {
        result.current.completeAgent(failureOutcome);
      });

      expect(result.current.agentRunning).toBe(false);
      expect(result.current.outcome).toEqual(failureOutcome);
      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].kind).toBe("error");
      expect(result.current.entries[0].text).toContain("MCP tool timed out");
    });
  });

  // ─── appendEntry ─────────────────────────────────────────────────────────

  describe("appendEntry", () => {
    it("adds an entry to the log", () => {
      const { result } = renderHook(() => useAgentMode());
      const entry = makeEntry({ text: "agent reasoning step" });

      act(() => {
        result.current.appendEntry(entry);
      });

      expect(result.current.entries.length).toBe(1);
      expect(result.current.entries[0].text).toBe("agent reasoning step");
    });

    it("truncates entries exceeding kind-specific limit", () => {
      const { result } = renderHook(() => useAgentMode());
      const longText = "x".repeat(600);
      const entry = makeEntry({ kind: "reasoning", text: longText });

      act(() => {
        result.current.appendEntry(entry);
      });

      // reasoning limit is 512
      expect(result.current.entries[0].text.length).toBe(512);
      expect(result.current.entries[0].expandedText).toBe(longText);
    });

    it("respects FIFO eviction at MAX_LOG_ENTRIES", () => {
      const { result } = renderHook(() => useAgentMode());

      // Fill to MAX
      act(() => {
        for (let i = 0; i < MAX_LOG_ENTRIES; i++) {
          result.current.appendEntry(
            makeEntry({ id: `entry-${i}`, text: `entry ${i}` }),
          );
        }
      });

      expect(result.current.entries.length).toBe(MAX_LOG_ENTRIES);

      // Append one more — should evict oldest
      act(() => {
        result.current.appendEntry(
          makeEntry({ id: "new-entry", text: "newest" }),
        );
      });

      expect(result.current.entries.length).toBe(MAX_LOG_ENTRIES);
      // The oldest (entry-0) should be gone, newest is at the end
      expect(result.current.entries[0].id).not.toBe("entry-0");
      expect(
        result.current.entries[result.current.entries.length - 1].text,
      ).toBe("newest");
    });
  });

  // ─── clearLog ────────────────────────────────────────────────────────────

  describe("clearLog", () => {
    it("resets entries to empty array", () => {
      const { result } = renderHook(() => useAgentMode());

      act(() => {
        result.current.appendEntry(makeEntry());
        result.current.appendEntry(makeEntry());
      });

      expect(result.current.entries.length).toBe(2);

      act(() => {
        result.current.clearLog();
      });

      expect(result.current.entries).toEqual([]);
    });
  });
});
