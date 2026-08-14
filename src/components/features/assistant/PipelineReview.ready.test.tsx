import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PipelineReview } from "./PipelineReview";

const refresh = vi.fn();
const reset = vi.fn();
const schedulePostPatchRefresh = vi.fn();

vi.mock("./usePipelineReview", () => ({
  usePipelineReview: () => ({
    findings: [],
    score: 0,
    level: "",
    summary: "",
    isStale: false,
    isLoading: false,
    error: "",
    completedAt: 0,
    refresh,
    reset,
    schedulePostPatchRefresh,
  }),
}));

vi.mock("./FindingCard", () => ({
  FindingCard: () => null,
}));

vi.mock("./StalenessIndicator", () => ({
  StalenessIndicator: () => null,
}));

type PendingKick = { kind: "refresh"; resetFirst?: boolean } | { kind: "reset" };

/**
 * Mirrors AssistantSidebar's pending-kick queue: if the child has not wired
 * reviewRefreshRef yet, queue the request and flush on onReviewApiReady.
 */
function ParentWithQueuedKick({ delayChild = false }: { delayChild?: boolean }) {
  const reviewRefreshRef = useRef<((options?: { resetFirst?: boolean }) => void) | null>(null);
  const reviewResetRef = useRef<(() => void) | null>(null);
  const pendingReviewKickRef = useRef<PendingKick | null>(null);
  const [childMounted, setChildMounted] = useState(!delayChild);

  const requestReviewRefresh = useCallback((options?: { resetFirst?: boolean }) => {
    if (options?.resetFirst) {
      reviewResetRef.current?.();
    }
    if (reviewRefreshRef.current) {
      reviewRefreshRef.current(options);
      pendingReviewKickRef.current = null;
      return;
    }
    pendingReviewKickRef.current = { kind: "refresh", resetFirst: options?.resetFirst };
  }, []);

  const flushPendingReviewKick = useCallback(() => {
    const pending = pendingReviewKickRef.current;
    if (!pending) return;
    pendingReviewKickRef.current = null;
    if (pending.kind === "reset") {
      reviewResetRef.current?.();
      return;
    }
    if (pending.resetFirst) {
      reviewResetRef.current?.();
    }
    reviewRefreshRef.current?.(pending.resetFirst ? { resetFirst: true } : undefined);
  }, []);

  useEffect(() => {
    // Parent kick on mount (same timing as isOpen/providerSource effect).
    requestReviewRefresh();
    if (delayChild) {
      // Mount child after the parent kick so the ref was null when queued.
      queueMicrotask(() => {
        setChildMounted(true);
      });
    }
  }, [requestReviewRefresh, delayChild]);

  if (!childMounted) {
    return <div data-testid="waiting-for-child" />;
  }

  return (
    <PipelineReview
      reviewRefreshRef={reviewRefreshRef}
      reviewResetRef={reviewResetRef}
      onReviewApiReady={flushPendingReviewKick}
    />
  );
}

describe("PipelineReview review API readiness", () => {
  beforeEach(() => {
    refresh.mockClear();
    reset.mockClear();
    schedulePostPatchRefresh.mockClear();
  });

  it("lets parent useEffect invoke refresh after layout wiring", async () => {
    const order: string[] = [];
    const reviewRefreshRef = {
      current: null as ((options?: { resetFirst?: boolean }) => void) | null,
    };

    function Parent() {
      useEffect(() => {
        order.push("parent-effect");
        reviewRefreshRef.current?.();
      }, []);

      return (
        <PipelineReview
          reviewRefreshRef={reviewRefreshRef}
          onReviewApiReady={() => {
            order.push("api-ready");
          }}
        />
      );
    }

    await act(async () => {
      render(<Parent />);
    });

    expect(order[0]).toBe("api-ready");
    expect(order.indexOf("api-ready")).toBeLessThan(order.indexOf("parent-effect"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped initial refresh once the child publishes its API", async () => {
    await act(async () => {
      render(<ParentWithQueuedKick delayChild />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalled();
  });
});
