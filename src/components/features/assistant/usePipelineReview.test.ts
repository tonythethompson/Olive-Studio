import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePipelineReview } from "./usePipelineReview";

vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineStore: (selector: (s: { state: Record<string, unknown> }) => unknown) =>
    selector({ state: { ihvProvider: "cuda", passes: [] } }),
}));

vi.mock("@/lib/workspaceFingerprint", () => ({
  computeFingerprint: vi.fn().mockResolvedValue("fp-123"),
}));

describe("usePipelineReview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resets review data when reset() is called", async () => {
    let resolveAnalyze: (res: Response) => void;
    const analyzePromise = new Promise<Response>((resolve) => {
      resolveAnalyze = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => analyzePromise);

    const { result } = renderHook(() => usePipelineReview());

    // Trigger initial refresh
    act(() => {
      result.current.refresh();
    });

    expect(result.current.isLoading).toBe(true);

    // Complete the first review
    await act(async () => {
      resolveAnalyze(
        new Response(
          JSON.stringify({
            score: 90,
            level: "Optimized",
            summary: "Great pipeline",
            findings: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    expect(result.current.score).toBe(90);
    expect(result.current.completedAt).toBeGreaterThan(0);

    // Call reset()
    act(() => {
      result.current.reset();
    });

    expect(result.current.score).toBe(0);
    expect(result.current.level).toBe("");
    expect(result.current.summary).toBe("");
    expect(result.current.findings).toEqual([]);
    expect(result.current.completedAt).toBe(0);
  });

  it("clears review data when refresh({ resetFirst: true }) is called", async () => {
    let resolveFirst: (res: Response) => void;
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => firstPromise);

    const { result } = renderHook(() => usePipelineReview());

    // Trigger initial refresh
    act(() => {
      result.current.refresh();
    });

    // Complete first review
    await act(async () => {
      resolveFirst(
        new Response(
          JSON.stringify({
            score: 85,
            level: "Optimized",
            summary: "First provider review",
            findings: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    expect(result.current.score).toBe(85);

    // Mock second analyze fetch that stays pending or fails
    let rejectSecond: (err: Error) => void;
    const secondPromise = new Promise<Response>((_, reject) => {
      rejectSecond = reject;
    });
    fetchSpy.mockImplementation(() => secondPromise);

    // Refresh with resetFirst option
    act(() => {
      result.current.refresh({ resetFirst: true });
    });

    // Score and summary should be cleared immediately while loading
    expect(result.current.score).toBe(0);
    expect(result.current.summary).toBe("");
    expect(result.current.completedAt).toBe(0);
    expect(result.current.isLoading).toBe(true);

    // Reject second fetch
    await act(async () => {
      rejectSecond(new Error("Provider API key invalid"));
    });

    // Score remains 0, error is set, previous review data is NOT presented as current
    expect(result.current.score).toBe(0);
    expect(result.current.completedAt).toBe(0);
    expect(result.current.error).toBe("Provider API key invalid");
  });
});
