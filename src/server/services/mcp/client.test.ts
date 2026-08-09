/**
 * Unit tests for the persistent MCP client's circuit-breaker integration.
 * No real Python subprocess is ever spawned — @modelcontextprotocol/client
 * is mocked to simulate transport/protocol behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock setup (hoisted before all imports) ───────────────────────────

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => {
  return {
    Client: class MockClient {
      connect = mocks.connect;
      callTool = mocks.callTool;
      close = mocks.close;
    },
  };
});

vi.mock("@modelcontextprotocol/client/stdio", () => {
  return {
    StdioClientTransport: class MockTransport {
      stderr = null;
      onclose: (() => void) | undefined = undefined;
      onerror: ((error: Error) => void) | undefined = undefined;
    },
  };
});

// Mock paths to avoid real filesystem checks
vi.mock("./paths.ts", () => ({
  getMcpPython: () => "python",
  buildPythonEnv: () => ({ PATH: "/usr/bin", PYTHONPATH: "/fake" }),
  mcpServerDir: () => "/fake/olive-mcp-server",
}));

// Must import AFTER mocks are set up
import {
  callOliveMcpTools,
  callOliveMcpTool,
  MCP_UNAVAILABLE_ERROR,
  resetPersistentClient,
} from "./persistentClient.ts";
import mcpBreaker, { resetMcpBreaker } from "./breaker.ts";

/** Trip the breaker with 3 consecutive failures. */
function tripMcpBreaker(): void {
  for (let i = 0; i < 3; i += 1) {
    const admission = mcpBreaker.beforeCall();
    if (!admission) return;
    mcpBreaker.recordFailure(admission.epoch);
  }
}

describe("persistentClient circuit-breaker integration", () => {
  beforeEach(() => {
    resetMcpBreaker();
    resetPersistentClient();
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.callTool.mockReset();
    mocks.close.mockReset().mockResolvedValue(undefined);
  });

  it("returns results for successful tool calls and records success", async () => {
    mocks.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"ok":true}' }],
      isError: false,
    });

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ result: { ok: true } }]);
    expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("returns error on tool-level failure (isError: true) without tripping breaker", async () => {
    mocks.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "bad tool name" }],
      isError: true,
    });

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ error: "bad tool name" }]);
    expect(out[0]).not.toHaveProperty("unavailable");
    expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("records failure and returns unavailable on connection failure", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("spawn python ENOENT"));

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
  });

  it("records failure on transport error during callTool", async () => {
    mocks.callTool.mockRejectedValueOnce(new Error("Transport closed"));

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ unavailable: true });
    expect(mcpBreaker.status()).toMatchObject({ open: false, failures: 1 });
  });

  it("short-circuits when the breaker is open", async () => {
    tripMcpBreaker();

    const out = await callOliveMcpTool("x", {});

    expect(out).toEqual({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("handles batch calls sequentially — stops on infra error", async () => {
    mocks.callTool
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"first":true}' }],
        isError: false,
      })
      .mockRejectedValueOnce(new Error("Connection closed"));

    const out = await callOliveMcpTools([
      { toolName: "a", args: {} },
      { toolName: "b", args: {} },
      { toolName: "c", args: {} },
    ]);

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ result: { first: true } });
    expect(out[1]).toMatchObject({ unavailable: true });
    expect(out[2]).toMatchObject({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
  });

  it("reuses the connection for subsequent calls", async () => {
    mocks.callTool.mockResolvedValue({
      content: [{ type: "text", text: '{"ok":true}' }],
      isError: false,
    });

    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "y", args: {} }]);

    // connect() called only once (second call reuses existing connection)
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.callTool).toHaveBeenCalledTimes(2);
  });

  it("does not trip the breaker while it is already open", async () => {
    mocks.connect.mockRejectedValue(new Error("spawn python ENOENT"));

    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    await callOliveMcpTools([{ toolName: "x", args: {} }]);
    expect(mcpBreaker.status().open).toBe(true);

    const failuresBefore = mcpBreaker.status().failures;
    const out = await callOliveMcpTool("x", {});

    expect(out).toEqual({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
    expect(mcpBreaker.status().failures).toBe(failuresBefore);
  });

  it("recovers after breaker cooldown with a successful probe", async () => {
    vi.useFakeTimers();
    try {
      mocks.connect.mockRejectedValue(new Error("spawn python ENOENT"));
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      await callOliveMcpTools([{ toolName: "x", args: {} }]);
      expect(mcpBreaker.status().open).toBe(true);

      // Advance past cooldown
      vi.advanceTimersByTime(30_000);
      expect(mcpBreaker.status().open).toBe(false);

      // Recovery probe succeeds
      mocks.connect.mockResolvedValue(undefined);
      mocks.callTool.mockResolvedValueOnce({
        content: [{ type: "text", text: '{"recovered":true}' }],
        isError: false,
      });

      const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

      expect(out).toEqual([{ result: { recovered: true } }]);
      expect(mcpBreaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns empty array for empty requests", async () => {
    const out = await callOliveMcpTools([]);
    expect(out).toEqual([]);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("handles non-JSON text content as raw string result", async () => {
    mocks.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "just a plain string" }],
      isError: false,
    });

    const out = await callOliveMcpTools([{ toolName: "x", args: {} }]);

    expect(out).toEqual([{ result: "just a plain string" }]);
  });
});
