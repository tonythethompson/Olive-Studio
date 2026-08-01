import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, codexSpawnUsesShell } from "./CodexAppServerClient.ts";

describe("codexSpawnUsesShell", () => {
  it("uses shell for bare codex on Windows", () => {
    expect(codexSpawnUsesShell("codex", "win32")).toBe(true);
    expect(codexSpawnUsesShell("codex.cmd", "win32")).toBe(true);
  });

  it("skips shell for a direct .exe path on Windows", () => {
    expect(codexSpawnUsesShell("C:\\\\Tools\\\\codex.exe", "win32")).toBe(false);
  });

  it("never uses shell on non-Windows", () => {
    expect(codexSpawnUsesShell("codex", "linux")).toBe(false);
    expect(codexSpawnUsesShell("codex", "darwin")).toBe(false);
  });
});

describe("CodexAppServerClient JSON-RPC envelope", () => {
  it("request and notify serialize jsonrpc 2.0 over mocked stdin", async () => {
    const written: string[] = [];
    const client = new CodexAppServerClient("codex");
    const internals = client as unknown as {
      child: {
        stdin: {
          writable: boolean;
          write: (chunk: string, cb?: (err?: Error | null) => void) => boolean;
        };
      } | null;
      started: boolean;
      request: (method: string, params?: unknown) => Promise<unknown>;
      notify: (method: string, params?: unknown) => Promise<void>;
      onLine: (line: string) => void;
      pending: Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
      >;
    };

    internals.started = true;
    internals.child = {
      stdin: {
        writable: true,
        write: (chunk, cb) => {
          written.push(String(chunk));
          queueMicrotask(() => cb?.(null));
          return true;
        },
      },
    };

    const requestPromise = internals.request("initialize", { capabilities: null });
    await vi.waitFor(() => {
      expect(written.some((line) => line.includes('"method":"initialize"'))).toBe(true);
    });
    const requestLine = written.find((line) => line.includes('"method":"initialize"'))!;
    const requestPayload = JSON.parse(requestLine.trim()) as {
      jsonrpc: string;
      id: number;
      method: string;
    };
    expect(requestPayload.jsonrpc).toBe("2.0");
    expect(requestPayload.method).toBe("initialize");

    internals.onLine(JSON.stringify({ jsonrpc: "2.0", id: requestPayload.id, result: { ok: true } }));
    await expect(requestPromise).resolves.toEqual({ ok: true });

    await internals.notify("initialized");
    const notifyLine = written.find((line) => line.includes('"method":"initialized"'))!;
    const notifyPayload = JSON.parse(notifyLine.trim()) as { jsonrpc: string; method: string };
    expect(notifyPayload.jsonrpc).toBe("2.0");
    expect(notifyPayload.method).toBe("initialized");
  });
});
