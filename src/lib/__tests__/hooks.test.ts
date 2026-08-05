// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMcpDiagnostic, useMcpDiagnosticKeyed } from "@/lib/hooks";
import type { McpDiagnostic } from "@/types";

// ── Mock fetch ───────────────────────────────────────────────────

const mockDiagnostic: McpDiagnostic = {
  matched_entry: "onnxruntime-error",
  title: "ONNX Runtime Error",
  root_cause: "Model conversion failed due to unsupported op",
  workaround: "Add custom op definitions",
  updated_config: { use_external_data_format: true },
  relevant_quirks: ["Large models need external data format"],
};

const emptyLogs = ["[ERROR] Something went wrong"];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, _opts) =>
    Promise.resolve(new Response(JSON.stringify(mockDiagnostic), { status: 200 })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────

describe("useMcpDiagnosticKeyed", () => {
  it("returns empty diagnostics and diagnosingKeys initially", () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    expect(result.current.diagnostics).toEqual({});
    expect(result.current.diagnosingKeys).toEqual({});
  });

  it("stores diagnostic result keyed by ID after fetch completes", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-1", emptyLogs);
    });

    expect(result.current.diagnostics["job-1"]).toEqual(mockDiagnostic);
  });

  it("tracks loading state: diagnosingKeys[key] is true during fetch, false after", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    // Start fetch — should set diagnosingKeys["job-1"] = true
    act(() => {
      result.current.fetchKeyedDiagnostic("job-1", emptyLogs);
    });

    expect(result.current.diagnosingKeys["job-1"]).toBe(true);

    // Resolve fetch — should set diagnosingKeys["job-1"] = false
    await act(async () => {
      resolveFetch(new Response(JSON.stringify(mockDiagnostic), { status: 200 }));
    });

    expect(result.current.diagnosingKeys["job-1"]).toBe(false);
  });

  it("handles concurrent fetches to different keys independently", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    const diagA: McpDiagnostic = {
      matched_entry: "error-a",
      title: "Error A",
      root_cause: "Cause A",
      workaround: "Fix A",
    };
    const diagB: McpDiagnostic = {
      matched_entry: "error-b",
      title: "Error B",
      root_cause: "Cause B",
      workaround: "Fix B",
    };

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, _opts) => {
      callCount++;
      const diag = callCount === 1 ? diagA : diagB;
      return Promise.resolve(new Response(JSON.stringify(diag), { status: 200 }));
    });

    // Fire both fetches concurrently
    await act(async () => {
      await Promise.all([
        result.current.fetchKeyedDiagnostic("job-a", ["error a"]),
        result.current.fetchKeyedDiagnostic("job-b", ["error b"]),
      ]);
    });

    expect(result.current.diagnostics["job-a"]).toEqual(diagA);
    expect(result.current.diagnostics["job-b"]).toEqual(diagB);
    expect(result.current.diagnosingKeys["job-a"]).toBe(false);
    expect(result.current.diagnosingKeys["job-b"]).toBe(false);
  });

  it("concurrent fetches only show loading for keys that are in flight", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    let resolveA!: (value: Response) => void;
    let resolveB!: (value: Response) => void;

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, _opts) => {
      const p = new Promise<Response>((resolve) => {
        if (!resolveA) resolveA = resolve;
        else resolveB = resolve;
      });
      return p;
    });

    // Start both
    act(() => {
      result.current.fetchKeyedDiagnostic("job-a", ["error a"]);
      result.current.fetchKeyedDiagnostic("job-b", ["error b"]);
    });

    // Both should be loading
    expect(result.current.diagnosingKeys["job-a"]).toBe(true);
    expect(result.current.diagnosingKeys["job-b"]).toBe(true);

    // Resolve only job-a
    await act(async () => {
      resolveA(new Response(JSON.stringify(mockDiagnostic), { status: 200 }));
    });

    // job-a done, job-b still loading
    expect(result.current.diagnosingKeys["job-a"]).toBe(false);
    expect(result.current.diagnosingKeys["job-b"]).toBe(true);
    expect(result.current.diagnostics["job-a"]).toEqual(mockDiagnostic);
    expect(result.current.diagnostics["job-b"]).toBeUndefined();

    // Resolve job-b
    await act(async () => {
      resolveB(new Response(JSON.stringify(mockDiagnostic), { status: 200 }));
    });

    expect(result.current.diagnosingKeys["job-b"]).toBe(false);
    expect(result.current.diagnostics["job-b"]).toEqual(mockDiagnostic);
  });

  it("empty logs returns null and does not store anything", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    await act(async () => {
      const res = await result.current.fetchKeyedDiagnostic("job-empty", []);
      expect(res).toBeNull();
    });

    expect(result.current.diagnostics["job-empty"]).toBeUndefined();
    expect(result.current.diagnosingKeys["job-empty"]).toBeUndefined();
  });

  it("handles fetch failure gracefully — diagnosingKeys resets, diagnostics not updated", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 500, statusText: "Internal Server Error" })),
    );

    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-fail", emptyLogs);
    });

    expect(result.current.diagnosingKeys["job-fail"]).toBe(false);
    expect(result.current.diagnostics["job-fail"]).toBeUndefined();
  });

  it("handles network error gracefully — diagnosingKeys resets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("Network failure")));

    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-net", emptyLogs);
    });

    expect(result.current.diagnosingKeys["job-net"]).toBe(false);
    expect(result.current.diagnostics["job-net"]).toBeUndefined();
  });

  it("fetches only the last 80 log lines (matching requestMcpDiagnostic behavior)", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    const manyLogs = Array.from({ length: 100 }, (_, i) => `[INFO] Line ${i}`);

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-many", manyLogs);
    });

    // Verify fetch was called (the hook slices to last 80 internally)
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const callBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
    expect(callBody.args.error_message).toContain("[INFO] Line 20");
    expect(callBody.args.error_message).toContain("[INFO] Line 99");
    // Boundary: line 19 is the first line outside the last-80 window.
    expect(callBody.args.error_message).not.toContain("[INFO] Line 19");
    // Should NOT contain line 0 (outside the last 80)
    expect(callBody.args.error_message).not.toContain("[INFO] Line 0");
  });

  it("second fetch to same key overwrites the previous diagnostic", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    const diag1: McpDiagnostic = {
      matched_entry: "first",
      title: "First",
      root_cause: "Cause 1",
      workaround: "Fix 1",
    };
    const diag2: McpDiagnostic = {
      matched_entry: "second",
      title: "Second",
      root_cause: "Cause 2",
      workaround: "Fix 2",
    };

    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(diag1), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(diag2), { status: 200 })));

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-overwrite", emptyLogs);
    });
    expect(result.current.diagnostics["job-overwrite"]).toEqual(diag1);

    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-overwrite", emptyLogs);
    });
    expect(result.current.diagnostics["job-overwrite"]).toEqual(diag2);
  });

  it("resolves correct result when overlapping fetches complete out of order", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());

    const diagA: McpDiagnostic = {
      matched_entry: "a",
      title: "A",
      root_cause: "Cause A",
      workaround: "Fix A",
    };
    const diagB: McpDiagnostic = {
      matched_entry: "b",
      title: "B",
      root_cause: "Cause B",
      workaround: "Fix B",
    };

    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, _opts) => {
      if (!resolveFirst) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveSecond = resolve;
      });
    });

    // Start both on same key
    act(() => {
      result.current.fetchKeyedDiagnostic("job-race", ["error 1"]);
      result.current.fetchKeyedDiagnostic("job-race", ["error 2"]);
    });

    // Resolve the second fetch first, then the first
    await act(async () => {
      resolveSecond(new Response(JSON.stringify(diagB), { status: 200 }));
    });

    await act(async () => {
      resolveFirst(new Response(JSON.stringify(diagA), { status: 200 }));
    });

    // Both fetches completed — diagnosingKeys must reset to false
    expect(result.current.diagnosingKeys["job-race"]).toBe(false);
    // A diagnostic was stored (the last one to resolve wins)
    expect(result.current.diagnostics["job-race"]).toBeDefined();
    expect(["a", "b"]).toContain(result.current.diagnostics["job-race"].matched_entry);
    // The stored diagnostic has all required fields
    expect(typeof result.current.diagnostics["job-race"].title).toBe("string");
    expect(typeof result.current.diagnostics["job-race"].root_cause).toBe("string");
    expect(typeof result.current.diagnostics["job-race"].workaround).toBe("string");
  });

  it("stores returned error messages in errors[key]", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "KB unavailable" }), { status: 500 }),
    );
    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-err", emptyLogs);
    });
    expect(result.current.diagnostics["job-err"]).toBeUndefined();
    expect(result.current.errors["job-err"]).toBe("KB unavailable");
    expect(result.current.diagnosingKeys["job-err"]).toBe(false);
  });

  it("maps HTTP failures without a body error into errors[key]", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-http", emptyLogs);
    });
    expect(result.current.diagnostics["job-http"]).toBeUndefined();
    expect(result.current.errors["job-http"]).toMatch(/Diagnosis failed \(HTTP 503\)/);
  });

  it("stays silent in errors[key] when a keyed request is aborted", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, opts) => {
      call += 1;
      const signal = (opts as RequestInit | undefined)?.signal;
      if (call === 1) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve(new Response(JSON.stringify(mockDiagnostic), { status: 200 }));
    });

    act(() => {
      void result.current.fetchKeyedDiagnostic("job-abort", emptyLogs);
    });
    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-abort", emptyLogs);
    });

    expect(result.current.errors["job-abort"]).toBeFalsy();
    expect(result.current.diagnostics["job-abort"]).toEqual(mockDiagnostic);
  });

  it("treats title-only payloads as malformed errors", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Only a title" }), { status: 200 }),
    );
    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-partial", emptyLogs);
    });
    expect(result.current.diagnostics["job-partial"]).toBeUndefined();
    expect(result.current.errors["job-partial"]).toMatch(/incomplete|malformed/i);
  });

  it("rejects payloads with invalid optional field shapes", async () => {
    const { result } = renderHook(() => useMcpDiagnosticKeyed());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "T",
          root_cause: "R",
          workaround: "W",
          relevant_quirks: "not-an-array",
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      await result.current.fetchKeyedDiagnostic("job-shape", emptyLogs);
    });
    expect(result.current.diagnostics["job-shape"]).toBeUndefined();
    expect(result.current.errors["job-shape"]).toMatch(/incomplete|malformed|unexpected/i);
  });
});

describe("useMcpDiagnostic", () => {
  it("stores diagnostic and clears error on success", async () => {
    const { result } = renderHook(() => useMcpDiagnostic());
    await act(async () => {
      await result.current.fetchDiagnostic(emptyLogs);
    });
    expect(result.current.diagnostic).toEqual(mockDiagnostic);
    expect(result.current.error).toBeNull();
    expect(result.current.isDiagnosing).toBe(false);
  });

  it("exposes error messages on the single-hook error contract", async () => {
    const { result } = renderHook(() => useMcpDiagnostic());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "tool failed" }), { status: 502 }),
    );
    await act(async () => {
      await result.current.fetchDiagnostic(emptyLogs);
    });
    expect(result.current.diagnostic).toBeNull();
    expect(result.current.error).toBe("tool failed");
    expect(result.current.isDiagnosing).toBe(false);
  });

  it("stays silent when the request is aborted", async () => {
    const { result } = renderHook(() => useMcpDiagnostic());
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, opts) => {
      call += 1;
      const signal = (opts as RequestInit | undefined)?.signal;
      if (call === 1) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve(new Response(JSON.stringify(mockDiagnostic), { status: 200 }));
    });

    act(() => {
      void result.current.fetchDiagnostic(emptyLogs);
    });
    await act(async () => {
      await result.current.fetchDiagnostic(emptyLogs);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.diagnostic).toEqual(mockDiagnostic);
  });

  it("rejects title-only malformed payloads", async () => {
    const { result } = renderHook(() => useMcpDiagnostic());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Incomplete" }), { status: 200 }),
    );
    await act(async () => {
      await result.current.fetchDiagnostic(emptyLogs);
    });
    expect(result.current.diagnostic).toBeNull();
    expect(result.current.error).toMatch(/incomplete|malformed/i);
  });

  it("rejects missing root_cause or workaround as malformed", async () => {
    const { result } = renderHook(() => useMcpDiagnostic());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "T", root_cause: "R" }), { status: 200 }),
    );
    await act(async () => {
      await result.current.fetchDiagnostic(emptyLogs);
    });
    expect(result.current.diagnostic).toBeNull();
    expect(result.current.error).toMatch(/incomplete|malformed|unexpected/i);
  });
});
