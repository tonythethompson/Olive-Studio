// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoClearError } from "@/lib/hooks";

describe("useAutoClearError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string initially", () => {
    const { result } = renderHook(() => useAutoClearError(4000));
    expect(result.current[0]).toBe("");
  });

  it("sets error message immediately", () => {
    const { result } = renderHook(() => useAutoClearError(4000));
    const [, setError] = result.current;

    act(() => {
      setError("Something failed");
    });

    expect(result.current[0]).toBe("Something failed");
  });

  it("auto-clears error after timeout", () => {
    const { result } = renderHook(() => useAutoClearError(4000));
    const [, setError] = result.current;

    act(() => {
      setError("Temporary error");
    });
    expect(result.current[0]).toBe("Temporary error");

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current[0]).toBe("");
  });

  it("uses 4000ms default timeout when no arg is passed", () => {
    const { result } = renderHook(() => useAutoClearError());
    const [, setError] = result.current;

    act(() => {
      setError("Default timeout");
    });

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(result.current[0]).toBe("Default timeout");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe("");
  });

  it("respects custom timeout", () => {
    const { result } = renderHook(() => useAutoClearError(2000));
    const [, setError] = result.current;

    act(() => {
      setError("Quick error");
    });

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current[0]).toBe("Quick error");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe("");
  });

  it("setError with empty string clears immediately without scheduling a timer", () => {
    const { result } = renderHook(() => useAutoClearError(4000));
    const [, setError] = result.current;

    act(() => {
      setError("Some error");
    });
    expect(result.current[0]).toBe("Some error");

    act(() => {
      setError("");
    });
    expect(result.current[0]).toBe("");

    // Advancing far past timeout should not change anything
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current[0]).toBe("");
  });

  it("rapid setError calls reset the timer — only the last error auto-clears", () => {
    const { result } = renderHook(() => useAutoClearError(4000));
    const [, setError] = result.current;

    // First error at t=0
    act(() => {
      setError("First error");
    });
    expect(result.current[0]).toBe("First error");

    // Advance 3000ms
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current[0]).toBe("First error");

    // Second error at t=3000 — resets the 4s timer
    act(() => {
      setError("Second error");
    });
    expect(result.current[0]).toBe("Second error");

    // 3999ms later — still showing second error (3999/4000 since last call)
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(result.current[0]).toBe("Second error");

    // 1ms more — clears (4000ms since second call)
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe("");
  });

  it("clears pending timer on unmount without throwing", () => {
    const { result, unmount } = renderHook(() => useAutoClearError(4000));
    const [, setError] = result.current;

    act(() => {
      setError("Will outlive component");
    });

    unmount();

    // Advancing timers after unmount should not throw
    act(() => {
      vi.advanceTimersByTime(10000);
    });
  });
});
