/**
 * Server route tests for GET /api/arena/assistant-cloud-snapshot (Req 18 / Properties 21, 21b).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http, { type Server } from "node:http";
import fc from "fast-check";

const getAiProvider = vi.fn();
const getProvider = vi.fn();

vi.mock("../middleware/rateLimit.ts", () => ({
  arenaProxyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/ai/index.ts", () => ({
  getAiProvider: () => getAiProvider(),
  getProvider: (name: string) => getProvider(name),
}));

// Keep real localOnly for Property 21b access-boundary checks.
import { mountArenaRoutes } from "./arena.ts";

let server: Server;
let baseUrl: string;
let prevAllowRemote: string | undefined;

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
  prevAllowRemote = process.env.OLIVE_ARENA_ALLOW_REMOTE;
  delete process.env.OLIVE_ARENA_ALLOW_REMOTE;
  getAiProvider.mockReset();
  getProvider.mockReset();
  getProvider.mockReturnValue({ label: "Test Provider", defaultBaseUrl: undefined });
});

afterEach(() => {
  if (prevAllowRemote === undefined) delete process.env.OLIVE_ARENA_ALLOW_REMOTE;
  else process.env.OLIVE_ARENA_ALLOW_REMOTE = prevAllowRemote;
});

type LocalResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/** Loopback-only harness: server binds 127.0.0.1, so remoteAddress is always loopback.
 *  Non-loopback `req.socket.remoteAddress` is covered by unit tests in localOnly.test.ts;
 *  reverse-proxy hops are exercised here via PROXY_FORWARDING_HEADERS. */
async function getSnapshot(opts?: {
  headers?: Record<string, string>;
}): Promise<LocalResponse> {
  const url = new URL(`${baseUrl}/api/arena/assistant-cloud-snapshot`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: opts?.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = () => Promise.resolve(buf.toString("utf8"));
          const json = async () => JSON.parse(buf.toString("utf8") || "null");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json, text });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function assertNoCredentials(body: unknown): void {
  if (body && typeof body === "object") {
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("endpointUrl");
    expect(body).not.toHaveProperty("modelId");
  }
}

describe("GET /api/arena/assistant-cloud-snapshot", () => {
  it("returns eligible snapshot with Cache-Control no-store for openai-compat", async () => {
    getAiProvider.mockReturnValue({
      provider: "openai-compat",
      apiKey: "sk-live",
      model: "gpt-test",
      baseUrl: "https://api.example.com/v1",
    });
    getProvider.mockReturnValue({ label: "Custom OpenAI", defaultBaseUrl: undefined });

    const res = await getSnapshot();
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["cache-control"]).toMatch(/private/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      eligible: true,
      endpointUrl: "https://api.example.com/v1",
      apiKey: "sk-live",
      modelId: "gpt-test",
      providerLabel: "Custom OpenAI",
    });
  });

  it("returns ineligible shape without credentials for gemini", async () => {
    getAiProvider.mockReturnValue({
      provider: "gemini",
      apiKey: "secret",
      model: "gemini-pro",
    });
    const res = await getSnapshot();
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const body = await res.json();
    expect(body).toMatchObject({ eligible: false });
    assertNoCredentials(body);
  });

  it("returns ineligible when no provider configured", async () => {
    getAiProvider.mockReturnValue(null);
    const res = await getSnapshot();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ eligible: false });
    assertNoCredentials(body);
  });

  it("Property 21: route eligibility matches OpenAI-compat gate", async () => {
    // Feature: playground-tab, Property 21
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("openai-compat", "gemini", "anthropic", "openai"),
        fc.option(fc.constant("https://api.example.com/v1"), { nil: null }),
        fc.string({ minLength: 1, maxLength: 16 }),
        async (provider, baseUrl, model) => {
          getAiProvider.mockReturnValue({
            provider,
            apiKey: "k",
            model,
            baseUrl: provider === "openai" ? baseUrl : baseUrl ?? "https://api.example.com/v1",
          });
          const res = await getSnapshot();
          expect(res.status).toBe(200);
          const body = (await res.json()) as { eligible: boolean };
          if (provider === "gemini" || provider === "anthropic") {
            expect(body.eligible).toBe(false);
            assertNoCredentials(body);
          }
          // Known-eligible inputs: openai-compat + public HTTPS base + non-empty model.
          // Assert unconditionally so a regression that marks all compat snapshots
          // ineligible fails loudly (do not nest under body.eligible).
          if (provider === "openai-compat" && baseUrl && model.trim()) {
            expect(body.eligible).toBe(true);
            expect(body).toMatchObject({
              apiKey: "k",
              endpointUrl: "https://api.example.com/v1",
              modelId: model,
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 21b: non-loopback without override is 403 without credentials", async () => {
    // Feature: playground-tab, Property 21b
    // Simulate reverse-proxy hop: loopback remoteAddress + forwarding headers → 403.
    getAiProvider.mockReturnValue({
      provider: "openai-compat",
      apiKey: "sk-should-not-leak",
      model: "gpt",
      baseUrl: "https://api.example.com/v1",
    });

    await fc.assert(
      fc.asyncProperty(
        // All PROXY_FORWARDING_HEADERS from localOnly.ts (incl. x-forwarded-host).
        fc.constantFrom("x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"),
        fc.ipV4(),
        async (header, ip) => {
          const res = await getSnapshot({
            headers: { [header]: ip },
          });
          expect(res.status).toBe(403);
          expect(res.headers["cache-control"]).toMatch(/no-store/);
          const text = await res.text();
          let body: unknown = null;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          assertNoCredentials(body);
          expect(text).not.toContain("sk-should-not-leak");
        },
      ),
      // Network-bound property: header names × any IPv4; ~20 runs cover the set.
      { numRuns: 20 },
    );
  });

  it("Property 21b: credential snapshot stays loopback-only even when OLIVE_ARENA_ALLOW_REMOTE=true", async () => {
    // Feature: playground-tab, Property 21b — never return Assistant API keys to non-loopback.
    process.env.OLIVE_ARENA_ALLOW_REMOTE = "true";
    getAiProvider.mockReturnValue({
      provider: "openai-compat",
      apiKey: "sk-should-not-leak",
      model: "gpt",
      baseUrl: "https://api.example.com/v1",
    });
    const res = await getSnapshot({
      headers: { "x-forwarded-for": "8.8.8.8" },
    });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("sk-should-not-leak");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });
});
