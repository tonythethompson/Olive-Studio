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
});
