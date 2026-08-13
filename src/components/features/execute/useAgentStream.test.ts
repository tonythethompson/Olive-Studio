// @vitest-environment jsdom
/**
 * Unit tests for the useAgentStream SSE hook (Task 6.2).
 *
 * Tests cover:
 * - EventSource creation and cleanup on enabled/disabled
 * - Parsing of incoming SSE events into ActivityLogEntry format
 * - Auto-reconnect with exponential backoff (max 3 retries)
 * - Error callback on connection failure after retries exhausted
 *
 * Requirements: 7.1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "./useAgentStream";

// ─── EventSource Mock ────────────────────────────────────────────────────────

interface MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  addEventListener: ReturnType<typeof vi.fn>;
}

let mockEventSources: MockEventSource[];

function createMockEventSourceClass() {
  return vi.fn(function MockEventSourceConstructor(url: string) {
    const instance: MockEventSource = {
      url,
      onmessage: null,
      onopen: null,
      onerror: null,
      close: vi.fn(),
      readyState: 0, // CONNECTING
      addEventListener: vi.fn(),
    };
    mockEventSources.push(instance);
    return instance;
  }) as unknown as typeof EventSource;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  mockEventSources = [];
  vi.useFakeTimers();
  global.EventSource = createMockEventSourceClass();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useAgentStream", () => {
  describe("connection lifecycle", () => {
    it("opens EventSource when enabled is true", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      expect(mockEventSources).toHaveLength(1);
      expect(mockEventSources[0].url).toBe("/api/olive/agent/stream/job-1");
    });

    it("does not open EventSource when enabled is false", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: false, onEntry }));

      expect(mockEventSources).toHaveLength(0);
    });

    it("closes EventSource when enabled becomes false", () => {
      const onEntry = vi.fn();
      const { rerender } = renderHook(
        ({ enabled }) => useAgentStream({ enabled, jobId: "job-1", onEntry }),
        { initialProps: { enabled: true } },
      );

      expect(mockEventSources).toHaveLength(1);
      const es = mockEventSources[0];

      rerender({ enabled: false });

      expect(es.close).toHaveBeenCalled();
    });

    it("closes EventSource on unmount", () => {
      const onEntry = vi.fn();
      const { unmount } = renderHook(() =>
        useAgentStream({ enabled: true, jobId: "job-1", onEntry }),
      );

      const es = mockEventSources[0];
      unmount();

      expect(es.close).toHaveBeenCalled();
    });

    it("opens a new EventSource when enabled transitions from false to true", () => {
      const onEntry = vi.fn();
      const { rerender } = renderHook(
        ({ enabled }) => useAgentStream({ enabled, jobId: "job-1", onEntry }),
        { initialProps: { enabled: false } },
      );

      expect(mockEventSources).toHaveLength(0);

      rerender({ enabled: true });

      expect(mockEventSources).toHaveLength(1);
    });
  });

  describe("event parsing", () => {
    it("parses valid message events into ActivityLogEntry and calls onEntry", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      const eventData = JSON.stringify({
        kind: "reasoning",
        text: "Analyzing the model structure",
      });

      act(() => {
        es.onmessage?.(new MessageEvent("message", { data: eventData }));
      });

      expect(onEntry).toHaveBeenCalledTimes(1);
      const entry = onEntry.mock.calls[0][0];
      expect(entry.kind).toBe("reasoning");
      expect(entry.text).toBe("Analyzing the model structure");
      expect(entry.id).toMatch(/^agent-\d+-\d+$/);
      expect(entry.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("includes stepRef in the entry when present in the event", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      const eventData = JSON.stringify({
        kind: "error",
        text: "MCP tool timed out",
        stepRef: "step-42",
      });

      act(() => {
        es.onmessage?.(new MessageEvent("message", { data: eventData }));
      });

      expect(onEntry).toHaveBeenCalledTimes(1);
      const entry = onEntry.mock.calls[0][0];
      expect(entry.kind).toBe("error");
      expect(entry.stepRef).toBe("step-42");
    });

    it("ignores malformed JSON in message events", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];

      act(() => {
        es.onmessage?.(new MessageEvent("message", { data: "not valid json{" }));
      });

      expect(onEntry).not.toHaveBeenCalled();
    });

    it("adapts server log {line} payloads into activity entries", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      act(() => {
        es.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ line: "[INFO] Olive pass started" }),
          }),
        );
      });

      expect(onEntry).toHaveBeenCalledTimes(1);
      expect(onEntry.mock.calls[0][0].text).toBe("[INFO] Olive pass started");
      expect(onEntry.mock.calls[0][0].kind).toBe("tool_result");
    });

    it("keeps repeated identical log lines when they have no event id", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const payload = JSON.stringify({ line: "[INFO] retrying pass" });
      act(() => {
        mockEventSources[0].onmessage?.(new MessageEvent("message", { data: payload }));
        mockEventSources[0].onmessage?.(new MessageEvent("message", { data: payload }));
      });
      expect(onEntry).toHaveBeenCalledTimes(2);
    });

    it("skips reconnect replay that matches the already-rendered prefix", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const lineA = JSON.stringify({ line: "[INFO] pass A" });
      const lineB = JSON.stringify({ line: "[INFO] pass B" });
      const lineC = JSON.stringify({ line: "[INFO] pass C" });
      act(() => {
        mockEventSources[0].onmessage?.(new MessageEvent("message", { data: lineA }));
        mockEventSources[0].onmessage?.(new MessageEvent("message", { data: lineB }));
      });
      expect(onEntry).toHaveBeenCalledTimes(2);

      act(() => {
        mockEventSources[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        mockEventSources[1].onmessage?.(new MessageEvent("message", { data: lineA }));
        mockEventSources[1].onmessage?.(new MessageEvent("message", { data: lineB }));
        mockEventSources[1].onmessage?.(new MessageEvent("message", { data: lineC }));
      });
      expect(onEntry).toHaveBeenCalledTimes(3);
      expect(onEntry.mock.calls[2][0].text).toBe("[INFO] pass C");
    });

    it("dedupes reconnect replay when SSE lastEventId is present", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const payload = JSON.stringify({ line: "[INFO] Olive pass started" });
      act(() => {
        mockEventSources[0].onmessage?.(
          new MessageEvent("message", { data: payload, lastEventId: "evt-1" }),
        );
      });
      expect(onEntry).toHaveBeenCalledTimes(1);

      act(() => {
        mockEventSources[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        mockEventSources[1].onmessage?.(
          new MessageEvent("message", { data: payload, lastEventId: "evt-1" }),
        );
      });
      expect(onEntry).toHaveBeenCalledTimes(1);
    });

    it("ignores events with invalid kind field", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      const eventData = JSON.stringify({
        kind: "invalid_kind",
        text: "Should be ignored",
      });

      act(() => {
        es.onmessage?.(new MessageEvent("message", { data: eventData }));
      });

      expect(onEntry).not.toHaveBeenCalled();
    });

    it("ignores events missing required text field", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      const eventData = JSON.stringify({ kind: "reasoning" });

      act(() => {
        es.onmessage?.(new MessageEvent("message", { data: eventData }));
      });

      expect(onEntry).not.toHaveBeenCalled();
    });

    it("handles all valid entry kinds", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      const kinds = ["reasoning", "tool_call", "tool_result", "decision", "error"];

      act(() => {
        for (const kind of kinds) {
          es.onmessage?.(
            new MessageEvent("message", {
              data: JSON.stringify({ kind, text: `entry-${kind}` }),
            }),
          );
        }
      });

      expect(onEntry).toHaveBeenCalledTimes(5);
      for (let i = 0; i < kinds.length; i++) {
        expect(onEntry.mock.calls[i][0].kind).toBe(kinds[i]);
      }
    });

    it("generates unique IDs for each entry", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];

      act(() => {
        es.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ kind: "reasoning", text: "a" }),
          }),
        );
        es.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ kind: "decision", text: "b" }),
          }),
        );
      });

      expect(onEntry).toHaveBeenCalledTimes(2);
      const id1 = onEntry.mock.calls[0][0].id;
      const id2 = onEntry.mock.calls[1][0].id;
      expect(id1).not.toBe(id2);
    });
  });

  describe("reconnection with exponential backoff", () => {
    it("resets retry count on successful connection", () => {
      const onEntry = vi.fn();
      const onError = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry, onError }));

      const es = mockEventSources[0];

      // Simulate successful open
      act(() => {
        es.onopen?.();
      });

      // Now trigger an error and verify retry starts from 0
      act(() => {
        es.onerror?.();
      });

      // Should schedule a reconnect at 1s (first retry).
      // The implementation uses a 50ms grace period before scheduling the
      // backoff timer, so advance 50ms first, then the 1s backoff.
      expect(mockEventSources).toHaveLength(1); // Only the original
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockEventSources).toHaveLength(2); // Reconnected
    });

    it("reconnects with exponential backoff delays: 1s, 2s, 4s", () => {
      const onEntry = vi.fn();
      const onError = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry, onError }));

      // First connection fails
      act(() => {
        mockEventSources[0].onerror?.();
      });

      // After 50ms grace + 1s, first reconnect attempt
      expect(mockEventSources).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(mockEventSources).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockEventSources).toHaveLength(2);

      // Second connection fails
      act(() => {
        mockEventSources[1].onerror?.();
      });

      // After 50ms grace + 2s, second reconnect attempt
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(mockEventSources).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockEventSources).toHaveLength(3);

      // Third connection fails
      act(() => {
        mockEventSources[2].onerror?.();
      });

      // After 50ms grace + 4s, third reconnect attempt
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(mockEventSources).toHaveLength(3);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockEventSources).toHaveLength(4);
    });

    it("calls onError after 3 retries exhausted", () => {
      const onEntry = vi.fn();
      const onError = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry, onError }));

      // First connection fails immediately
      act(() => {
        mockEventSources[0].onerror?.();
      });

      // Retry 1 (50ms grace + delay: 1s)
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        mockEventSources[1].onerror?.();
      });

      // Retry 2 (50ms grace + delay: 2s)
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        mockEventSources[2].onerror?.();
      });

      // Retry 3 (50ms grace + delay: 4s)
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      act(() => {
        mockEventSources[3].onerror?.();
      });

      // Advance the 50ms grace period so proceedWithReconnect runs and
      // detects that retries are exhausted.
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // Now retries are exhausted — onError should be called
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        "Connection to agent stream failed after 3 retries",
      );
    });

    it("does not reconnect after retries exhausted", () => {
      const onEntry = vi.fn();
      const onError = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry, onError }));

      // Exhaust all retries
      act(() => {
        mockEventSources[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        mockEventSources[1].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        mockEventSources[2].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      act(() => {
        mockEventSources[3].onerror?.();
      });

      // Advance time further — no new connections should be created
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(mockEventSources).toHaveLength(4);
    });

    it("does not call onError when not provided", () => {
      const onEntry = vi.fn();
      // No onError provided
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      // Exhaust all retries — should not throw
      act(() => {
        mockEventSources[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        mockEventSources[1].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        mockEventSources[2].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      // Should not throw
      expect(() => {
        act(() => {
          mockEventSources[3].onerror?.();
        });
      }).not.toThrow();
    });

    it("closes EventSource on each failed attempt", () => {
      const onEntry = vi.fn();
      renderHook(() => useAgentStream({ enabled: true, jobId: "job-1", onEntry }));

      const es = mockEventSources[0];
      act(() => {
        es.onerror?.();
      });

      expect(es.close).toHaveBeenCalled();
    });

    it("cancels pending reconnect timeout when enabled becomes false", () => {
      const onEntry = vi.fn();
      const { rerender } = renderHook(
        ({ enabled }) => useAgentStream({ enabled, jobId: "job-1", onEntry }),
        { initialProps: { enabled: true } },
      );

      // Trigger error to start reconnect timer
      act(() => {
        mockEventSources[0].onerror?.();
      });

      // Disable before timeout fires
      rerender({ enabled: false });

      // Advance past the timeout period — no new connection should be created
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Only the original EventSource was created
      expect(mockEventSources).toHaveLength(1);
    });
  });
});
