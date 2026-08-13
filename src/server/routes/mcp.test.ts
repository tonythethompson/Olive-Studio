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

const mcpToolMocks = vi.hoisted(() => ({
  execFileImpl: null as null | ((...args: unknown[]) => unknown),
  spawnImpl: null as null | ((...args: unknown[]) => unknown),
  execFileCalls: [] as unknown[][],
  callOliveMcpToolImpl: null as null | ((name: string, args: Record<string, unknown>) => Promise<unknown>),
  reconnectMcpClientImpl: null as null | (() => Promise<void>),
  reconnectCalls: 0,
}));

vi.mock("child_process", async (importOriginal) => {
  const { childProcessVitestMockFactory } = await import("../__tests__/childProcessTestMocks.ts");
  return childProcessVitestMockFactory(mcpToolMocks, { trackExecFileCalls: true })(importOriginal);
});

// Mock the persistent client so the route test doesn't spawn a real Python process.
vi.mock("../services/mcp/persistentClient.ts", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    callOliveMcpTool: async (name: string, args: Record<string, unknown> = {}) => {
      if (mcpToolMocks.callOliveMcpToolImpl) {
        return mcpToolMocks.callOliveMcpToolImpl(name, args);
      }
      // No mock set — return unavailable (mimics breaker-open behavior)
      // rather than spawning a real Python process
      return { error: "MCP mock not configured", unavailable: true };
    },
    reconnectMcpClient: async () => {
      mcpToolMocks.reconnectCalls += 1;
      if (mcpToolMocks.reconnectMcpClientImpl) {
        return mcpToolMocks.reconnectMcpClientImpl();
      }
    },
    shutdownMcpClient: async () => { },
    resetPersistentClient: () => { },
  };
});

import express from "express";
import type { Server } from "http";
import fs from "fs";

import { mountMcpRoutes } from "./mcp.ts";
import { setKbStatusCache } from "../services/mcp/state.ts";
import mcpBreaker, { resetMcpBreaker } from "../services/mcp/breaker.ts";
import { kbSyncRateLimit, mcpSettingsRateLimit } from "../middleware/rateLimit.ts";
import { writeStudioConfig } from "../config.ts";

function tripMcpBreaker(): void {
  for (let i = 0; i < 3; i += 1) {
    const admission = mcpBreaker.beforeCall();
    if (!admission) return;
    mcpBreaker.recordFailure(admission.epoch);
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

beforeEach(async () => {
  setKbStatusCache(null);
  resetMcpBreaker();
  mcpToolMocks.execFileImpl = null;
  mcpToolMocks.execFileCalls.length = 0;
  mcpToolMocks.callOliveMcpToolImpl = null;
  mcpToolMocks.reconnectMcpClientImpl = null;
  mcpToolMocks.reconnectCalls = 0;
  // Keep per-test sync requests from hitting the 2/min production rate limit.
  await kbSyncRateLimit.resetKey("127.0.0.1");
  await mcpSettingsRateLimit.resetKey("127.0.0.1");
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

  describe("SYNC_KB_TOKEN enforcement", () => {
    const previousToken = process.env.SYNC_KB_TOKEN;

    afterEach(() => {
      if (previousToken === undefined) {
        delete process.env.SYNC_KB_TOKEN;
      } else {
        process.env.SYNC_KB_TOKEN = previousToken;
      }
    });

    it("returns 401 when the token is required but missing", async () => {
      process.env.SYNC_KB_TOKEN = "test-secret";
      vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

      const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, { method: "POST" });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ ok: false, error: "Missing or invalid sync token" });
    });

    it("returns 401 for an invalid token", async () => {
      process.env.SYNC_KB_TOKEN = "test-secret";
      vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

      const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, {
        method: "POST",
        headers: { "x-sync-token": "wrong" },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ ok: false, error: "Missing or invalid sync token" });
    });

    it("allows sync when the token matches", async () => {
      process.env.SYNC_KB_TOKEN = "test-secret";
      vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

      const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, {
        method: "POST",
        headers: { "x-sync-token": "test-secret" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, available: true, passCount: 1 });
    });

    it("returns 403 from studioLocalOnly gate when x-forwarded-for is present", async () => {
      process.env.SYNC_KB_TOKEN = "test-secret";
      vi.spyOn(fs, "readFileSync").mockReturnValue(VALID_KB);

      const res = await fetch(`${baseUrl}/api/mcp/sync-kb`, {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.1", "x-sync-token": "test-secret" },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ error: "This endpoint is only available from loopback" });
      // Sync work must not be performed when the local-only gate rejects.
      expect(body).not.toMatchObject({ ok: true });
    });
  });
});

describe("POST /api/mcp/tool", () => {
  it("short-circuits with 503 when the breaker is open", async () => {
    tripMcpBreaker();

    const res = await fetch(`${baseUrl}/api/mcp/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "get_olive_passes", args: {} }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ available: false, error: expect.any(String) });
  });

  it("returns 400 for an unknown toolName", async () => {
    const res = await fetch(`${baseUrl}/api/mcp/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "not_a_real_tool", args: {} }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown toolName" });
  });

  it("returns 200 with the tool result when the closed breaker proxies valid JSON", async () => {
    mcpToolMocks.callOliveMcpToolImpl = async () => ({ result: { ok: true } });

    const res = await fetch(`${baseUrl}/api/mcp/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "get_olive_passes", args: {} }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Clients expect the tool payload at the top level, not wrapped in `result`.
    expect(body).toEqual({ ok: true });
  });
});

describe("POST /api/mcp/studio-recipe mcpAccess", () => {
  const previousOliveMcpAccess = process.env.OLIVE_MCP_ACCESS;

  afterEach(() => {
    if (previousOliveMcpAccess === undefined) {
      delete process.env.OLIVE_MCP_ACCESS;
    } else {
      process.env.OLIVE_MCP_ACCESS = previousOliveMcpAccess;
    }
  });

  it("returns 403 when master mcpAccess is disabled", async () => {
    process.env.OLIVE_MCP_ACCESS = "0";
    const res = await fetch(`${baseUrl}/api/mcp/studio-recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uiState: {
          modelSource: "huggingface",
          hfModelId: "meta-llama/Meta-Llama-3-8B",
          ihvProvider: "CPUExecutionProvider",
          passes: { conversion: true, conversionFormat: "onnx", quantization: false },
        },
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok?: boolean; error?: string; required?: { mcpAccess?: boolean } };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("mcp_access_disabled");
    expect(body.required).toEqual({ mcpAccess: true });
  });
});

describe("POST /api/mcp/settings", () => {
  it("serializes overlapping writes so the later patch cannot restore stale fields", async () => {
    writeStudioConfig({ mcpSettings: { retrievalMode: "auto", preloadEmbeddings: false } });

    let releaseFirst!: () => void;
    const firstReconnect = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let reconnects = 0;
    mcpToolMocks.reconnectMcpClientImpl = async () => {
      reconnects += 1;
      if (reconnects === 1) await firstReconnect;
    };

    const first = fetch(`${baseUrl}/api/mcp/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retrievalMode: "keyword" }),
    });
    await vi.waitFor(() => {
      expect(reconnects).toBe(1);
    });

    const second = fetch(`${baseUrl}/api/mcp/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preloadEmbeddings: true }),
    });

    releaseFirst();
    const [res1, res2] = await Promise.all([first, second]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      mcpSettings?: { retrievalMode?: string; preloadEmbeddings?: boolean };
    };
    expect(body2.mcpSettings).toEqual({ retrievalMode: "keyword", preloadEmbeddings: true });
  });
});
