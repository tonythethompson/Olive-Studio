/**
 * Unit tests for the Olive MCP tool client's circuit-breaker integration.
 * No real Python subprocess is ever spawned.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  childProcessVitestMockFactory,
  createChildProcessTestHandles,
} from "../../__tests__/childProcessTestMocks.ts";

const mocks = vi.hoisted(() => createChildProcessTestHandles());

vi.mock("child_process", childProcessVitestMockFactory(mocks));

import { callOliveMcpTools, callOliveMcpTool, MCP_UNAVAILABLE_ERROR } from "./client.ts";
import mcpBreaker, { resetMcpBreaker } from "./breaker.ts";

/** Makes the next execFile call resolve with the given stdout/stderr. */
function mockExecFileResolve(stdout: string, stderr = ""): void {
  mocks.execFileImpl = (...args: unknown[]) => {
    mocks.execFileCalls.push(args);
    return Promise.resolve({ stdout, stderr });
  };
}

/** Makes the next execFile call reject like a failed spawn. */
function mockExecFileReject(message: string): void {
  mocks.execFileImpl = (...args: unknown[]) => {
    mocks.execFileCalls.push(args);
    return Promise.reject(Object.assign(new Error(message), { code: "ENOENT" }));
  };
}

describe("callOliveMcpTools circuit-breaker integration", () => {
  beforeEach(() => {
    resetMcpBreaker();
    mocks.execFileImpl = null;
    mocks.execFileCalls.length = 0;
  });

  it("returns results for valid JSON output and records success", async () => {
    mockExecFileResolve('[{"tool":"x","result":{"ok":true}}]');

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ result: { ok: true } }]);
    expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
    expect(mocks.execFileCalls).toHaveLength(1);
  });

  it("returns unavailable errors and records a failure on spawn failure", async () => {
    mockExecFileReject("spawn python ENOENT");

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ error: "spawn python ENOENT", unavailable: true });
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
    expect(mocks.execFileCalls).toHaveLength(1);
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
    for (let i = 0; i < 3; i += 1) mcpBreaker.recordFailure(0);

    const out = await callOliveMcpTool("x", {});

    expect(out).toEqual({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mocks.execFileCalls).toHaveLength(0);
  });

  it("marks non-array JSON output as an unavailable infra failure", async () => {
    mockExecFileResolve('{"not":"an array"}');

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ error: "MCP batch returned non-array JSON", unavailable: true }]);
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
    expect(mocks.execFileCalls).toHaveLength(1);
  });

  it("closes the breaker after a successful half-open probe", async () => {
    vi.useFakeTimers();
    try {
      mockExecFileReject("spawn python ENOENT");
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      expect(mcpBreaker.status()).toMatchObject({ open: true, failures: 3 });

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

  it("ignores a stale subprocess success after the breaker opened", async () => {
    let resolveExec: ((value: { stdout: string; stderr: string }) => void) | undefined;
    mocks.execFileImpl = () =>
      new Promise<{ stdout: string; stderr: string }>((resolve) => {
        resolveExec = resolve;
      });

    const slow = callOliveMcpTools([{ toolName: "x", args: {} }]);
    mockExecFileReject("spawn python ENOENT");
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    expect(mcpBreaker.status().open).toBe(true);

    resolveExec!({ stdout: '[{"tool":"x","result":{"ok":true}}]', stderr: "" });
    await slow;

    expect(mcpBreaker.status().open).toBe(true);
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
    expect(mocks.execFileCalls).toHaveLength(3);
  });
});
