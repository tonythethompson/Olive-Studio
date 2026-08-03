/**
 * Route-level coverage for Arena cloud-inference proxy.
 * pinnedFetch is mocked so no outbound network is required.
 * Rate limiting is bypassed here; limiter behavior is covered elsewhere.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { Server } from "node:http";
import {
  ARENA_CLOUD_TIMEOUT_MAX_MS,
  ARENA_CLOUD_TIMEOUT_MIN_MS,
  ARENA_CLOUD_TIMEOUT_MS,
  ARENA_PROMPT_MAX_CHARS,
} from "../../lib/arenaConstants.ts";

vi.mock("../middleware/localOnly.ts", () => ({
  arenaLocalOnly: (_req: unknown, _res: unknown, next: () => void) => next(),
  isLoopbackRemoteAddress: () => true,
  hasProxyForwardingHeaders: () => false,
}));

vi.mock("../middleware/rateLimit.ts", () => ({
  arenaProxyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/arena/ssrfGuard.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/arena/ssrfGuard.ts")>();
  return {
    ...actual,
    pinnedFetch: vi.fn(),
  };
});

import { pinnedFetch, SsrfPolicyError } from "../services/arena/ssrfGuard.ts";
import { mountArenaRoutes } from "./arena.ts";

const mockedPinnedFetch = vi.mocked(pinnedFetch);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountArenaRoutes(router);
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
  mockedPinnedFetch.mockReset();
});

type LocalResponse = {
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/** Local HTTP helper — avoids process-global `fetch` for this suite. */
async function postCloudInference(body: unknown): Promise<LocalResponse> {
  const payload = JSON.stringify(body);
  const url = new URL(`${baseUrl}/api/arena/cloud-inference`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("POST /api/arena/cloud-inference", () => {
  it("requires endpointUrl and prompt", async () => {
    const missingEndpoint = await postCloudInference({ prompt: "hi" });
    expect(missingEndpoint.status).toBe(400);
    expect(await missingEndpoint.json()).toMatchObject({ error: "endpointUrl is required" });

    const missingPrompt = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
    });
    expect(missingPrompt.status).toBe(400);
    expect(await missingPrompt.json()).toMatchObject({ error: "prompt is required" });
  });

  it("rejects oversized prompts before calling upstream", async () => {
    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "x".repeat(ARENA_PROMPT_MAX_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: `prompt must be at most ${ARENA_PROMPT_MAX_CHARS} characters`,
    });
    expect(mockedPinnedFetch).not.toHaveBeenCalled();
  });

  it("rejects non-string apiKey and modelId", async () => {
    const badKey = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hi",
      apiKey: 123,
    });
    expect(badKey.status).toBe(400);
    expect(await badKey.json()).toMatchObject({ error: "apiKey must be a string" });

    const badModel = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hi",
      modelId: { id: "x" },
    });
    expect(badModel.status).toBe(400);
    expect(await badModel.json()).toMatchObject({ error: "modelId must be a string" });
  });

  it("normalizes path to /chat/completions", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1/",
      prompt: "hello",
      apiKey: "sk-test",
      modelId: "gpt-test",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ output: "ok" });

    expect(mockedPinnedFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockedPinnedFetch.mock.calls[0]![0] as URL;
    expect(calledUrl.pathname).toBe("/v1/chat/completions");
    expect(calledUrl.origin).toBe("https://api.example.com");
  });

  it("does not double-append /chat/completions", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    await postCloudInference({
      endpointUrl: "https://api.example.com/v1/chat/completions",
      prompt: "hello",
    });

    const calledUrl = mockedPinnedFetch.mock.calls[0]![0] as URL;
    expect(calledUrl.pathname).toBe("/v1/chat/completions");
  });

  it("maps AbortError to 504", async () => {
    mockedPinnedFetch.mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    );

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/timed out/i);
    expect(body.error).toContain(String(ARENA_CLOUD_TIMEOUT_MS));
  });

  it("clamps timeoutMs for absent, invalid, zero, and out-of-range values", async () => {
    mockedPinnedFetch.mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    );

    const cases: Array<{ timeoutMs: unknown; expectedMs: number }> = [
      { timeoutMs: undefined, expectedMs: ARENA_CLOUD_TIMEOUT_MS },
      { timeoutMs: "not-a-number", expectedMs: ARENA_CLOUD_TIMEOUT_MS },
      { timeoutMs: 0, expectedMs: ARENA_CLOUD_TIMEOUT_MIN_MS },
      { timeoutMs: ARENA_CLOUD_TIMEOUT_MAX_MS + 50_000, expectedMs: ARENA_CLOUD_TIMEOUT_MAX_MS },
      { timeoutMs: 15_000, expectedMs: 15_000 },
      // In-range values between former bucket edges must be preserved exactly
      { timeoutMs: 1_001, expectedMs: 1_001 },
      { timeoutMs: 7_500, expectedMs: 7_500 },
      { timeoutMs: 45_000, expectedMs: 45_000 },
      { timeoutMs: ARENA_CLOUD_TIMEOUT_MIN_MS, expectedMs: ARENA_CLOUD_TIMEOUT_MIN_MS },
      { timeoutMs: ARENA_CLOUD_TIMEOUT_MAX_MS, expectedMs: ARENA_CLOUD_TIMEOUT_MAX_MS },
    ];

    for (const { timeoutMs, expectedMs } of cases) {
      mockedPinnedFetch.mockClear();
      mockedPinnedFetch.mockRejectedValue(
        Object.assign(new Error("Aborted"), { name: "AbortError" }),
      );
      const res = await postCloudInference({
        endpointUrl: "https://api.example.com/v1",
        prompt: "hello",
        timeoutMs,
      });
      expect(res.status).toBe(504);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(String(expectedMs));
    }
  });

  it("maps SsrfPolicyError to 400", async () => {
    mockedPinnedFetch.mockRejectedValue(new SsrfPolicyError("Private endpoints are not supported"));

    const res = await postCloudInference({
      endpointUrl: "https://127.0.0.1/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Private endpoints are not supported",
    });
  });

  it("does not treat plain Error message text as policy", async () => {
    mockedPinnedFetch.mockRejectedValue(new Error("HTTPS handshake failed: not allowed by peer"));

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "HTTPS handshake failed: not allowed by peer",
    });
  });

  it("maps generic failures to 502", async () => {
    mockedPinnedFetch.mockRejectedValue(new Error("ECONNRESET"));

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "ECONNRESET" });
  });

  it("maps AbortError during upstream error-body text() to 504 (not empty 502 detail)", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 502,
      ok: false,
      text: async () => {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      },
      json: async () => ({}),
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
      timeoutMs: ARENA_CLOUD_TIMEOUT_MS,
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/timed out/i);
    expect(body.error).toContain(String(ARENA_CLOUD_TIMEOUT_MS));
  });

  it("maps AbortError during upstream.json() body read to 504", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      },
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/timed out/i);
  });

  it("returns controlled 502 when upstream error body exceeds size limit (not upstream status)", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => {
        throw new Error("Upstream response exceeded maximum allowed size");
      },
      json: async () => ({}),
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "Upstream response exceeded maximum allowed size",
    });
  });

  it("returns controlled 502 when successful upstream body exceeds size limit", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "",
      json: async () => {
        throw new Error("Upstream response exceeded maximum allowed size");
      },
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "Upstream response exceeded maximum allowed size",
    });
  });

  it("preserves upstream status for ordinary non-2xx bodies within the size limit", async () => {
    mockedPinnedFetch.mockResolvedValue({
      status: 429,
      ok: false,
      text: async () => "rate limited",
      json: async () => ({}),
    });

    const res = await postCloudInference({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: "Upstream error 429",
      detail: "rate limited",
    });
  });

  it("does not write a JSON error body when the client disconnects during upstream body read", async () => {
    let releaseBody: ((err: Error) => void) | undefined;
    let markJsonPending!: () => void;
    const jsonPending = new Promise<void>((resolve) => {
      markJsonPending = resolve;
    });

    mockedPinnedFetch.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => "",
      json: () => {
        markJsonPending();
        return new Promise<never>((_resolve, reject) => {
          releaseBody = reject;
        });
      },
    });

    const payload = JSON.stringify({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    const url = new URL(`${baseUrl}/api/arena/cloud-inference`);

    let responseChunks = "";
    let sawHttpResponse = false;

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          sawHttpResponse = true;
          res.on("data", (chunk: Buffer | string) => {
            responseChunks += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          });
        },
      );
      req.on("error", () => {
        // Expected when we destroy mid-flight.
      });
      req.write(payload);
      req.end();

      void jsonPending
        .then(async () => {
          if (!releaseBody) {
            throw new Error("upstream.json never started");
          }
          req.destroy();
          // Simulate abort that follows client-gone → AbortController.abort().
          releaseBody(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          // Yield so the route catch/finally can run without a fixed sleep.
          await new Promise<void>((r) => setImmediate(r));
          await new Promise<void>((r) => setImmediate(r));
        })
        .then(() => resolve())
        .catch(reject);
    });

    expect(mockedPinnedFetch).toHaveBeenCalled();
    // Disconnect handling must not serialize a gateway/timeout JSON body after close.
    expect(responseChunks).not.toMatch(/"error"\s*:/);
    if (sawHttpResponse && responseChunks.length > 0) {
      expect(() => JSON.parse(responseChunks)).not.toThrow();
      expect(JSON.parse(responseChunks)).not.toHaveProperty("error");
    }
  });
});
