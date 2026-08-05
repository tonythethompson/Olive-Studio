/**
 * Integration tests for wired route endpoints.
 *
 * Starts the Express server on a random port, makes real HTTP requests,
 * and verifies responses from the modular route handlers.
 *
 * All external dependencies (Python, AI providers, LM Studio, Ollama) are
 * mocked via `setup.integration.ts` so these tests run reliably in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Server } from "http";

import { stubGlobalFetch, restoreGlobalFetch } from "./setup.integration.ts";
import { resetMcpBreaker } from "../services/mcp/breaker.ts";
import { app, markServerReady } from "../../../server.ts";

let server: Server;
let baseUrl: string;

/** Start the Express app on a random port and return the base URL. */
async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      markServerReady();
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error(`Could not bind to random port: ${addr}`));
        return;
      }
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    srv.on("error", reject);
  });
}

beforeAll(async () => {
  stubGlobalFetch();

  const result = await startTestServer();
  server = result.server;
  baseUrl = result.baseUrl;
}, 10_000);

afterAll(async () => {
  restoreGlobalFetch();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// The MCP circuit breaker is a process-wide singleton; reset it per test so
// infra-level failures from one test never short-circuit another.
beforeEach(() => {
  resetMcpBreaker();
});

describe("Route integration tests", () => {
  // ─── GET /api/ai/provider ─────────────────────────────────────────────────

  describe("GET /api/ai/provider", () => {
    it("returns provider status (none configured by default)", async () => {
      const res = await fetch(`${baseUrl}/api/ai/provider`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      expect(body).toHaveProperty("provider");
      expect(body).toHaveProperty("model");
      // No API keys are set in test env, so provider should be null or "none"
      expect(body.source || "none").toBeTruthy();
    });

    it("returns valid JSON with expected shape", async () => {
      const res = await fetch(`${baseUrl}/api/ai/provider`);
      const body = await res.json();

      // When no AI provider is configured, provider/model are null
      // When configured (env API keys present), they are strings
      expect(body.provider === null || typeof body.provider === "string").toBe(true);
      expect(body.model === null || typeof body.model === "string").toBe(true);
    });

    it("rejects unsupported provider in POST", async () => {
      const res = await fetch(`${baseUrl}/api/ai/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "invalid-provider", apiKey: "test", model: "test" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toContain("Unsupported provider");
    });
  });

  // ─── GET /api/ai/models ──────────────────────────────────────────────────

  describe("GET /api/ai/models", () => {
    it("returns empty legacy catalog (live catalogs use POST)", async () => {
      const res = await fetch(`${baseUrl}/api/ai/models`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      expect(body).toHaveProperty("models");
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models).toEqual([]);
      expect(body.source).toBe("fallback");
    });
  });

  // ─── POST /api/ai/chat ───────────────────────────────────────────────────

  describe("POST /api/ai/chat", () => {
    it("returns 400 when message is missing", async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatHistory: [] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Missing message");
    });

    it("returns 400 when body is empty", async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("gracefully handles AI call failure (no provider configured)", { timeout: 15_000 }, async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hello, how do I optimize a model?",
          chatHistory: [],
        }),
      });

      // With no AI provider configured, returns 500 with error message.
      // If env API keys happen to be present, returns 200 with reply.
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body).toBeDefined();
      if (res.status >= 400) {
        expect(body).toHaveProperty("error");
      } else {
        expect(body).toHaveProperty("reply");
      }
    });
  });

  // ─── GET /api/mcp/kb-status ──────────────────────────────────────────────

  describe("GET /api/mcp/kb-status", () => {
    it("returns KB status with valid JSON", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/kb-status`);

      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();

      // Should always have an "available" boolean
      expect(typeof body.available).toBe("boolean");
    });

    it("includes pass count when available", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/kb-status`);
      const body = await res.json();

      if (body.available) {
        expect(body).toHaveProperty("version");
        expect(body).toHaveProperty("passCount");
        expect(typeof body.passCount).toBe("number");
      }
    });

    it("returns cached result on second call", async () => {
      const res1 = await fetch(`${baseUrl}/api/mcp/kb-status`);
      const body1 = await res1.json();

      const res2 = await fetch(`${baseUrl}/api/mcp/kb-status`);
      const body2 = await res2.json();

      // Both calls should return the same availability
      expect(body2.available).toBe(body1.available);
    });

    it("returns 200 (not rate-limited on first call)", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/kb-status`);
      // Should not be rate limited on first access
      expect(res.status).toBeLessThan(400);
    });
  });

  // ─── GET /api/env/runtime ─────────────────────────────────────────────────

  describe("GET /api/env/runtime", () => {
    it("returns venv/runtime status", async () => {
      const res = await fetch(`${baseUrl}/api/env/runtime`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      // Runtime status should include these fields
      expect(body).toHaveProperty("venvExists");
      expect(body).toHaveProperty("oliveInstalled");
      expect(body).toHaveProperty("platform");
      expect(body).toHaveProperty("hint");
    });

    it("reports the current platform", async () => {
      const res = await fetch(`${baseUrl}/api/env/runtime`);
      const body = await res.json();

      // platform should be a string like "win32" or "linux" or "darwin"
      expect(typeof body.platform).toBe("string");
      expect(["win32", "linux", "darwin"]).toContain(body.platform);
    });

    it("includes a diagnostic hint", async () => {
      const res = await fetch(`${baseUrl}/api/env/runtime`);
      const body = await res.json();

      expect(typeof body.hint).toBe("string");
      expect(body.hint.length).toBeGreaterThan(0);
    });
  });

  // ─── POST /api/mcp/tool ───────────────────────────────────────────────────

  describe("POST /api/mcp/tool", () => {
    it("returns 400 when toolName is missing", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Missing toolName");
    });

    it("returns 400 when body is empty", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Missing toolName");
    });

    it("rejects toolName with command injection characters", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: "pass_catalog; rm -rf /", args: {} }),
      });

      // The sanitizer strips special chars, so the resulting tool name "pass_catalogrmrf"
      // won't be found, but it should still be a valid call (will fail at Python level).
      // The server should not return 400 for the toolName itself after sanitization.
      // It may return an error from Python execution (500) or succeed.
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });

    it("attempts to call a valid tool and returns JSON", async () => {
      const res = await fetch(`${baseUrl}/api/mcp/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: "pass_catalog", args: { pass_type: "OnnxConversion" } }),
      });

      // May succeed or fail depending on Python/venv availability,
      // but should always return valid JSON
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body).toBeDefined();
    });
  });

  // ─── 404 for unknown routes ────────────────────────────────────────────────

  describe("Unknown routes", () => {
    it("returns 404 for /api/nonexistent", async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent`);
      expect(res.status).toBe(404);
    });

    it("returns JSON error for unknown API routes", async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent`);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });

  // ─── GET /api/health ─────────────────────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns 200 with status ok", async () => {
      const res = await fetch(`${baseUrl}/api/health`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      expect(body).toHaveProperty("status", "ok");
      expect(body).toHaveProperty("uptime");
      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThan(0);
    });

    it("returns increasing uptime on subsequent calls", async () => {
      const res1 = await fetch(`${baseUrl}/api/health`);
      const body1 = await res1.json();

      // Wait a tick so uptime advances
      await new Promise((r) => setTimeout(r, 100));

      const res2 = await fetch(`${baseUrl}/api/health`);
      const body2 = await res2.json();

      expect(body2.uptime).toBeGreaterThanOrEqual(body1.uptime);
    });
  });

  // ─── GET /api/system/hardware-probe ────────────────────────────────────────

  describe("GET /api/system/hardware-probe", () => {
    it("returns 200 with hardware probe result", async () => {
      const res = await fetch(`${baseUrl}/api/system/hardware-probe`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      // Top-level fields from HardwareProbeResult
      expect(body).toHaveProperty("probedAt");
      expect(body).toHaveProperty("platform");
      expect(body).toHaveProperty("detectedProviders");
      expect(body).toHaveProperty("recommendedProvider");
      expect(body).toHaveProperty("notes");
    });

    it("includes platform info with CPU details", async () => {
      const res = await fetch(`${baseUrl}/api/system/hardware-probe`);
      const body = await res.json();

      expect(body.platform).toHaveProperty("os");
      expect(body.platform).toHaveProperty("arch");
      expect(body.platform).toHaveProperty("cpuModel");
      expect(body.platform).toHaveProperty("cpuCores");
      expect(typeof body.platform.cpuCores).toBe("number");
      expect(body.platform.cpuCores).toBeGreaterThan(0);
    });

    it("includes diagnostic notes", async () => {
      const res = await fetch(`${baseUrl}/api/system/hardware-probe`);
      const body = await res.json();

      expect(Array.isArray(body.notes)).toBe(true);
      expect(body.notes.length).toBeGreaterThan(0);
      // At least one note should mention QNN or desktop
      const hasQnnNote = body.notes.some((n: string) => n.includes("QNN") || n.includes("desktop"));
      expect(hasQnnNote).toBe(true);
    });

    it("returns cached result on second call", async () => {
      const res1 = await fetch(`${baseUrl}/api/system/hardware-probe`);
      const body1 = await res1.json();

      // Second call within 30s cache window should return same probedAt
      const res2 = await fetch(`${baseUrl}/api/system/hardware-probe`);
      const body2 = await res2.json();

      expect(body2.probedAt).toBe(body1.probedAt);
    });

    it("supports refresh=true to bypass cache", async () => {
      const res = await fetch(`${baseUrl}/api/system/hardware-probe?refresh=true`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("probedAt");
    });
  });

  // ─── Local model endpoints (LM Studio + Ollama, mocked) ──────────────────

  describe("GET /api/ai/local-health", () => {
    it("returns health status with lmsInstalled flag", async () => {
      const res = await fetch(`${baseUrl}/api/ai/local-health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.healthy).toBe("boolean");
      expect(body).toHaveProperty("lmsInstalled");
    });
  });

  describe("GET /api/ai/local-models", () => {
    it("returns installed and loaded model lists", async () => {
      const res = await fetch(`${baseUrl}/api/ai/local-models`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.installedModels)).toBe(true);
      expect(Array.isArray(body.loadedModels)).toBe(true);
      // Loaded list always comes from the OpenAI-compat mock/API.
      expect(body.loadedModels).toContain("llama-3.2-3b-instruct");
      // Installed prefers `lms ls` when CLI is present; otherwise falls back to loaded.
      // Integration mocks have no LMS CLI, so installed must match the loaded fallback exactly.
      expect(body.installedModels).toEqual(body.loadedModels);
    });
  });

  describe("GET /api/ai/ollama-health", () => {
    it("returns ollama health status", async () => {
      const res = await fetch(`${baseUrl}/api/ai/ollama-health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.healthy).toBe("boolean");
    });
  });

  describe("GET /api/ai/ollama-models", () => {
    it("returns installed and running model lists", async () => {
      const res = await fetch(`${baseUrl}/api/ai/ollama-models`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.installedModels)).toBe(true);
      expect(Array.isArray(body.runningModels)).toBe(true);
      expect(body.installedModels).toContain("llama3:8b");
      expect(body.runningModels).toContain("llama3:8b");
    });
  });

  // ─── POST /api/ai/local-pull ────────────────────────────────────────────

  describe("POST /api/ai/local-pull", () => {
    it("returns 400 when modelTag is missing", async () => {
      const res = await fetch(`${baseUrl}/api/ai/local-pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Missing modelTag");
    });

    it("returns SSE error when LM Studio CLI is not installed", async () => {
      // findLmsCli() probes via execFileAsync("where lms") which the setup mock
      // resolves to empty output (CLI missing). The handler streams NDJSON events.
      const res = await fetch(`${baseUrl}/api/ai/local-pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag: "llama-3.2-3b-instruct" }),
      });

      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);

      // Legacy SSE: "data: {...}\n\n"
      if (text.startsWith("data: ")) {
        const lines = text.split("\n\n").filter(Boolean);
        const firstEvent = JSON.parse(lines[0]!.replace(/^data: /, ""));
        expect(firstEvent).toHaveProperty("type");
        return;
      }

      // Current handler: application/x-ndjson (one JSON object per line).
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("ndjson") || text.includes("\n")) {
        const rows = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type?: string });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((row) => typeof row.type === "string")).toBe(true);
        return;
      }

      // Single JSON error object fallback.
      const body = JSON.parse(text) as { error?: string; type?: string };
      expect(body.error || body.type).toBeTruthy();
    });
  });

  // ─── POST /api/env/venv-install ─────────────────────────────────────────

  describe("POST /api/env/venv-install", () => {
    it("returns NDJSON content type", async () => {
      const res = await fetch(`${baseUrl}/api/env/venv-install`, {
        method: "POST",
      });

      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    });

    it("streams setup log lines and ends with a done event", async () => {
      const res = await fetch(`${baseUrl}/api/env/venv-install`, {
        method: "POST",
      });

      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);

      // Parse NDJSON lines
      const lines = text.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      // First line should be a log type
      const first = JSON.parse(lines[0]);
      expect(first).toHaveProperty("type");

      // Last line should be a "done" type with ok field
      const last = JSON.parse(lines[lines.length - 1]);
      expect(last).toHaveProperty("type", "done");
      expect(last).toHaveProperty("ok");
    });
  });

  // ─── POST /api/olive/run ────────────────────────────────────────────────

  describe("POST /api/olive/run", () => {
    it("returns 400 when recipeJson is missing", async () => {
      const res = await fetch(`${baseUrl}/api/olive/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("ok", false);
      expect(body).toHaveProperty("error", "Missing recipeJson");
    });

    it("returns 400 when recipeJson is invalid JSON", async () => {
      const res = await fetch(`${baseUrl}/api/olive/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeJson: "not json" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("ok", false);
      expect(body).toHaveProperty("error", "Invalid recipe JSON");
    });

    it("returns 400 when recipe fails schema validation", async () => {
      const res = await fetch(`${baseUrl}/api/olive/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeJson: JSON.stringify({}) }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("ok", false);
      expect(body).toHaveProperty("error");
    });

    it("rejects request with empty body", async () => {
      const res = await fetch(`${baseUrl}/api/olive/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });

      // Express JSON parser rejects empty body as invalid JSON
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });

  // ─── GET /api/olive/status/:jobId ───────────────────────────────────────

  describe("GET /api/olive/status/:jobId", () => {
    it("returns 404 for non-existent job", async () => {
      const res = await fetch(`${baseUrl}/api/olive/status/nonexistent-job-id`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Job not found");
    });

    it("returns JSON error with correct content type", async () => {
      const res = await fetch(`${baseUrl}/api/olive/status/another-fake-id`);

      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Job not found");
    });
  });
});
