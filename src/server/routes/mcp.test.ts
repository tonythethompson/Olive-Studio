/**
 * Route-level coverage for the MCP KB endpoints: the failure taxonomy
 * (missing / unreadable / invalid JSON / schema-invalid), sanitized client
 * error messages, caching of a successful status, and the non-2xx sync failure.
 * Also covers the tool proxy: the open-breaker 503 short-circuit and a
 * successful proxied call that spawns (mocked) Python.
 *
 * `fs.readFileSync` is stubbed per-test so no real KB file is required.
 *
 * `child_process` is mocked via `src/server/__tests__/childProcessTestMocks.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import fs from "fs";

import { mountMcpRoutes } from "./mcp.ts";
import { setKbStatusCache } from "../services/mcp/state.ts";
import mcpBreaker, { resetMcpBreaker } from "../services/mcp/breaker.ts";

const mcpToolMocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  spawnImpl: null as null | ((...args: unknown[]) => unknown),
  execFileCalls: [] as unknown[][],
}));

vi.mock("child_process", async (importOriginal) => {
  const { childProcessVitestMockFactory } = await import("../__tests__/childProcessTestMocks.ts");
  return childProcessVitestMockFactory(mcpToolMocks, { trackExecFileCalls: true })(importOriginal);
});

function tripMcpBreaker(): void {
  for (let i = 0; i < 3; i += 1) {
    const admission = mcpBreaker.beforeCall();
    if (admission) mcpBreaker.recordFailure(admission.epoch);
  }
}

const VALID_KB = JSON.stringify({
  version: "2.0",
  last_updated: "2026-01-01",
  passes: [
    {
      name: "OnnxConversion",
      type: "onnx",
      input_formats: ["pytorch"],
      output_formats: ["onnx"],
      required_params: [],
      optional_params: { opset: { type: "int", default: 17 } },
    },
  ],
});

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountMcpRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  setKbStatusCache(null);
  resetMcpBreaker();
  mcpToolMocks.execFileImpl = null;
  mcpToolMocks.execFileCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/mcp/kb-status", () => {
  it("returns available:true for a valid KB and caches the result", async () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

    const res1 = await fetch(`${baseUrl}/api/mcp/kb-status`);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).toMatchObject({ available: true, version: "2.0", passCount: 1 });
    const kbReads = () =>
      spy.mock.calls.filter((call) => String(call[0]).replace(/\\/g, "/").includes("passes.json")).length;
    expect(kbReads()).toBe(1);

    // Second call is served from cache — no additional KB file read.
    const res2 = await fetch(`${baseUrl}/api/mcp/kb-status`);
    expect((await res2.json()).available).toBe(true);
    expect(kbReads()).toBe(1);
  });

  it("reports a missing KB with a sanitized message", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw fsError("ENOENT");
    });

    const res = await fetch(`${baseUrl}/api/mcp/kb-status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ available: false, reason: "missing" });
    expect(body.error).toBe("Knowledge base has not been generated yet.");
    // Raw fs error / path detail must not leak to the client.
    expect(body.error).not.toContain("ENOENT");
  });

  it("reports an unreadable KB (permission error)", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw fsError("EACCES");
    });

    const body = await (await fetch(`${baseUrl}/api/mcp/kb-status`)).json();
    expect(body).toMatchObject({ available: false, reason: "unreadable" });
    expect(body.error).toBe("Knowledge base could not be read.");
    expect(body.error).not.toContain("EACCES");
  });

  it("reports malformed JSON as invalid", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("{ not json ");

    const body = await (await fetch(`${baseUrl}/api/mcp/kb-status`)).json();
    expect(body).toMatchObject({ available: false, reason: "invalid" });
    expect(body.error).toBe("Knowledge base file is malformed.");
  });

  it("reports schema-invalid content (bad pass entry) as invalid", async () => {
    // Valid JSON, but a pass entry violates the schema (non-string array field).
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ version: "1", passes: [{ name: "P", input_formats: [1, 2, 3] }] }),
    );

    const body = await (await fetch(`${baseUrl}/api/mcp/kb-status`)).json();
    expect(body).toMatchObject({ available: false, reason: "invalid" });
  });
});

describe("POST /api/mcp/sync-kb", () => {
  // NOTE: kbSyncRateLimit allows only 2 requests/min — keep to exactly two here.
  it("returns ok:true on a successful sync", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

    const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, available: true, passCount: 1 });
  });

  it("returns a non-2xx status with ok:false when the KB can't be read", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw fsError("ENOENT");
    });

    const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, reason: "missing" });
    expect(body.error).toBe("Knowledge base has not been generated yet.");
  });
});

describe("POST /api/mcp/tool", () => {
  it("short-circuits with 503 when the breaker is open", async () => {
    tripMcpBreaker();

    const res = await fetch(`${baseUrl}/api/mcp/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "x", args: {} }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ available: false, error: expect.any(String) });
    // The short-circuit must not spawn a Python subprocess.
    expect(mcpToolMocks.execFileCalls).toHaveLength(0);
  });

  it("returns 200 with the tool result when the closed breaker proxies valid JSON", async () => {
    mcpToolMocks.execFileImpl = () =>
      Promise.resolve({ stdout: '[{"tool":"x","result":{"ok":true}}]', stderr: "" });

    const res = await fetch(`${baseUrl}/api/mcp/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "x", args: {} }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Clients expect the tool payload at the top level, not wrapped in `result`.
    expect(body).toEqual({ ok: true });
    // The client's promisified execFile (custom-symbol handler) was actually
    // invoked and settled — exercising the path that used to hang forever.
    expect(mcpToolMocks.execFileCalls).toHaveLength(1);
  });
});
