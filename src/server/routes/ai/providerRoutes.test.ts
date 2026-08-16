import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";

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
    localPath: "",
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
  let runtime: { provider: string; apiKey: string; model: string; baseUrl?: string } | null =
    null;
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

import { mountProviderRoutes } from "./providerRoutes.ts";
import { downloadModel } from "../../services/genai/modelDownload.ts";

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
      body: JSON.stringify({ provider: "gemini", model: "gemini-2.5-flash" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("genai engine endpoints", () => {
  it("reports engine and model status", async () => {
    const res = await fetch(`${baseUrl}/api/ai/genai/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ venvReady: true, model: { ready: true } });
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
  });
});
