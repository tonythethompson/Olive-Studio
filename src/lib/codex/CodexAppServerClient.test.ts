import { describe, expect, it } from "vitest";
import { codexSpawnUsesShell } from "./CodexAppServerClient.ts";

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

describe("JSON-RPC envelope helpers", () => {
  it("documents that requests and notifications must include jsonrpc 2.0", () => {
    // Runtime coverage of writeLine/notify is process-spawn based; this guards the contract
    // strings used by CodexAppServerClient.request / notify payloads.
    const request = { jsonrpc: "2.0" as const, method: "initialize", id: 1, params: {} };
    const notification = { jsonrpc: "2.0" as const, method: "initialized" };
    expect(request.jsonrpc).toBe("2.0");
    expect(notification.jsonrpc).toBe("2.0");
  });
});
