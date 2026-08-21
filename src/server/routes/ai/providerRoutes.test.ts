import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";

import { mountProviderRoutes } from "./providerRoutes.ts";
import { downloadModel, getModelStatus } from "../../services/genai/modelDownload.ts";
import { isGenaiVenvReady, ensureGenaiVenv } from "../../services/genai/venv.ts";

// Deterministic GenAI service stubs: never touch the real venv, disk cache,
// or network during route tests.
vi.mock("../../services/genai/venv.ts", () => ({
  isGenaiVenvReady: vi.fn(() => true),
  ensureGenaiVenv: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../services/genai/modelDownload.ts", () => ({
  DEFAULT_GENAI_MODEL: "qwen2.5-coder-1.5b-instruct-onnx",
  getModelStatus: vi.fn(() => ({
    ready: true,
    localPath: "C:\\Users\\tester\\.olive-studio\\models\\genai\\qwen2.5-coder-1.5b-instruct-onnx",
    filesPresent: 6,
    filesRequired: 6,
    localSizeBytes: 0,
  })),
  // If the loopback gate ever fails to block, this surfaces as a test error.
  downloadModel: vi.fn(async () => {
    throw new Error("downloadModel must not run in this test");
  }),
}));

// In-memory provider state so activation tests never write the studio config.
const state = vi.hoisted(() => {
  let runtime: { provider: string; apiKey: string; model: string; baseUrl?: string } | null = null;
  return {
    get: () => runtime,
    set: (cfg: typeof runtime) => {
      runtime = cfg;
    },
  };
});

vi.mock("../../services/ai/state.ts", () => ({
  getRuntimeAiProvider: () => state.get(),
  setRuntimeAiProvider: (cfg: unknown) => state.set(cfg as never),
  readAiPreference: () => null,
  restoreProviderFromPreference: () => null,
}));

// Machine-local env keys must not leak into activation expectations.
vi.mock("../../services/ai/env.ts", () => ({
  readEnvApiKey: vi.fn(() => undefined),
  matchedEnvApiKeyName: vi.fn(() => undefined),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  const router = express.Router();
  mountProviderRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  vi.mocked(isGenaiVenvReady).mockReturnValue(true);
  vi.mocked(getModelStatus).mockReturnValue({
    ready: true,
    localPath: "C:\\Users\\tester\\.olive-studio\\models\\genai\\qwen2.5-coder-1.5b-instruct-onnx",
    filesPresent: 6,
    filesRequired: 6,
    localSizeBytes: 0,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/ai/provider keyless activation", () => {
  it("activates genai without an API key", async () => {
    const res = await fetch(`${baseUrl}/api/ai/provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "genai", model: "qwen2.5-coder-1.5b-instruct-onnx" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "genai" });
    expect(state.get()?.provider).toBe("genai");
  });

  it("still rejects key-required providers without credentials", async () => {
    const res = await fetch(`${baseUrl}/api/ai/provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini", model: "gemini-3.7-flash" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects genai activation before the engine is installed", async () => {
    vi.mocked(isGenaiVenvReady).mockReturnValue(false);
    const res = await fetch(`${baseUrl}/api/ai/provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "genai", model: "qwen2.5-coder-1.5b-instruct-onnx" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Install the GenAI engine") });
  });

  it("rejects genai activation before the model is downloaded", async () => {
    vi.mocked(getModelStatus).mockReturnValue({
      ready: false,
      localPath: "C:\\Users\\tester\\.olive-studio\\models\\genai\\qwen2.5-coder-1.5b-instruct-onnx",
      filesPresent: 2,
      filesRequired: 6,
      localSizeBytes: 0,
    });
    const res = await fetch(`${baseUrl}/api/ai/provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "genai", model: "qwen2.5-coder-1.5b-instruct-onnx" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Download the GenAI model") });
  });
});

describe("POST /api/ai/models keyless catalog", () => {
  it("returns the region-scoped Bedrock fallback for keyless requests", async () => {
    const res = await fetch(`${baseUrl}/api/ai/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "bedrock", baseUrl: "us-west-2" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; source: string; error: string };
    expect(body.models).toEqual([]);
    expect(body.source).toBe("fallback");
    expect(body.error).toContain("region-scoped");
  });

  it("returns the GenAI fallback for keyless requests instead of an API-key error", async () => {
    const res = await fetch(`${baseUrl}/api/ai/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "genai" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; source: string; error: string };
    expect(body.models).toEqual([]);
    expect(body.source).toBe("fallback");
    expect(body.error).toContain("locally downloaded model");
  });

  it("still returns the API-key fallback for key-required providers", async () => {
    const res = await fetch(`${baseUrl}/api/ai/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; source: string; error: string };
    expect(body.models).toEqual([]);
    expect(body.source).toBe("fallback");
    expect(body.error).toContain("No API key available");
  });
});

describe("genai engine endpoints", () => {
  it("reports engine and model status without leaking the local path", async () => {
    const res = await fetch(`${baseUrl}/api/ai/genai/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { venvReady: boolean; model: Record<string, unknown> };
    expect(body).toMatchObject({ venvReady: true, model: { ready: true } });
    expect(body.model.localPath).toBeUndefined();
  });

  it("blocks downloads that arrive via a reverse proxy hop", async () => {
    const res = await fetch(`${baseUrl}/api/ai/genai/download`, {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(403);
    expect(downloadModel).not.toHaveBeenCalled();
  });

  it("blocks engine setup that arrives via a reverse proxy hop", async () => {
    const res = await fetch(`${baseUrl}/api/ai/genai/setup`, {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(403);
    expect(ensureGenaiVenv).not.toHaveBeenCalled();
  });
});
