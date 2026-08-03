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

async function getSnapshot(opts?: {
  host?: string;
  headers?: Record<string, string>;
}): Promise<LocalResponse> {
  const url = new URL(`${baseUrl}/api/arena/assistant-cloud-snapshot`);
  const hostname = opts?.host ?? url.hostname;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
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
          if (provider === "openai-compat" && baseUrl) {
            // may still be eligible when model non-empty
            if (model.trim()) {
              // endpoint present
              if (body.eligible) {
                expect(body).toHaveProperty("apiKey");
              }
            }
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
        fc.constantFrom("x-forwarded-for", "x-real-ip", "forwarded"),
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
      { numRuns: 100 },
    );
  });

  it("Property 21b: OLIVE_ARENA_ALLOW_REMOTE permits non-loopback through the gate", async () => {
    // Feature: playground-tab, Property 21b
    process.env.OLIVE_ARENA_ALLOW_REMOTE = "true";
    getAiProvider.mockReturnValue({
      provider: "openai-compat",
      apiKey: "sk-ok",
      model: "gpt",
      baseUrl: "https://api.example.com/v1",
    });
    const res = await getSnapshot({
      headers: { "x-forwarded-for": "8.8.8.8" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; apiKey?: string };
    expect(body.eligible).toBe(true);
    expect(body.apiKey).toBe("sk-ok");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });
});
