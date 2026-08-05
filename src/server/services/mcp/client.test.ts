/**
 * Unit tests for the Olive MCP tool client's circuit-breaker integration.
 *
 * child_process.execFile is mocked with a `promisify.custom` handler so
 * `execFileAsync` (util.promisify(execFile)) resolves the same
 * `{ stdout, stderr }` shape as real Node's execFile promisification.
 * No real Python subprocess is ever spawned.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  calls: [] as unknown[][],
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const customSymbol = Symbol.for("nodejs.util.promisify.custom");

  function mockExecFile(...execArgs: unknown[]): unknown {
    // Callback-style callers get an instant empty result.
    const lastArg = execArgs[execArgs.length - 1];
    if (typeof lastArg === "function") {
      lastArg(null, "", "");
      return undefined;
    }
    return (actual.execFile as unknown as (...a: unknown[]) => unknown)(...execArgs);
  }

  // util.promisify(execFile) prefers this when present (mirrors real Node's
  // execFile, which resolves { stdout, stderr }). Tests stub execFileImpl to
  // resolve that exact shape.
  (mockExecFile as unknown as Record<symbol, unknown>)[customSymbol] = (...args: unknown[]) => {
    if (mocks.execFileImpl) return mocks.execFileImpl(...args);
    return Promise.resolve({ stdout: "", stderr: "" });
  };

  return {
    ...actual,
    execFile: mockExecFile as unknown as typeof actual.execFile,
  };
});

import { callOliveMcpTools, callOliveMcpTool, MCP_UNAVAILABLE_ERROR } from "./client.ts";
import mcpBreaker, { resetMcpBreaker } from "./breaker.ts";

/** Makes the next execFile call resolve with the given stdout/stderr. */
function mockExecFileResolve(stdout: string, stderr = ""): void {
  mocks.execFileImpl = (...args: unknown[]) => {
    mocks.calls.push(args);
    return Promise.resolve({ stdout, stderr });
  };
}

/** Makes the next execFile call reject like a failed spawn. */
function mockExecFileReject(message: string): void {
  mocks.execFileImpl = (...args: unknown[]) => {
    mocks.calls.push(args);
    return Promise.reject(Object.assign(new Error(message), { code: "ENOENT" }));
  };
}

describe("callOliveMcpTools circuit-breaker integration", () => {
  beforeEach(() => {
    resetMcpBreaker();
    mocks.execFileImpl = null;
    mocks.calls.length = 0;
  });

  it("returns results for valid JSON output and records success", async () => {
    mockExecFileResolve('[{"tool":"x","result":{"ok":true}}]');

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ result: { ok: true } }]);
    expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
    expect(mocks.calls).toHaveLength(1);
  });

  it("returns unavailable errors and records a failure on spawn failure", async () => {
    mockExecFileReject("spawn python ENOENT");

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ error: "spawn python ENOENT", unavailable: true });
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
    expect(mocks.calls).toHaveLength(1);
  });

  it("returns unavailable errors and records a failure on non-JSON output", async () => {
    mockExecFileResolve("not json");

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ error: expect.any(String), unavailable: true });
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
  });

  it("does not trip the breaker on row-level tool errors", async () => {
    mockExecFileResolve('[{"tool":"x","error":"bad tool"}]');

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ error: "bad tool" }]);
    expect(out[0]).not.toHaveProperty("unavailable");
    expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("single-tool calls inherit the unavailable short-circuit", async () => {
    for (let i = 0; i < 3; i += 1) mcpBreaker.recordFailure();

    const out = await callOliveMcpTool("x", {});

    expect(out).toEqual({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mocks.calls).toHaveLength(0);
  });

  it("marks non-array JSON output as an unavailable infra failure", async () => {
    mockExecFileResolve('{"not":"an array"}');

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ error: "MCP batch returned non-array JSON", unavailable: true }]);
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
    expect(mocks.calls).toHaveLength(1);
  });

  it("closes the breaker after a successful half-open probe", async () => {
    vi.useFakeTimers();
    try {
      mockExecFileReject("spawn python ENOENT");
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      expect(mcpBreaker.status()).toMatchObject({ open: true, failures: 3 });

      // Advance past the cooldown — the breaker is half-open and admits a probe.
      vi.advanceTimersByTime(30_000);
      expect(mcpBreaker.status().open).toBe(false);

      mockExecFileResolve('[{"tool":"x","result":{"ok":true}}]');
      const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

      expect(out).toEqual([{ result: { ok: true } }]);
      expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not inflate the failures counter while the breaker is open", async () => {
    mockExecFileReject("spawn python ENOENT");
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    expect(mcpBreaker.status().open).toBe(true);

    const failuresBefore = mcpBreaker.status().failures;
    const out = await callOliveMcpTool("x", {});

    expect(out).toEqual({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mcpBreaker.status().failures).toBe(failuresBefore);
    expect(mocks.calls).toHaveLength(3);
  });
});
