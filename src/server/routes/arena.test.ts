/**
 * Route-level coverage for Arena cloud-inference proxy.
 * pinnedFetch is mocked so no outbound network is required.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";

vi.mock("../services/arena/ssrfGuard.ts", () => ({
  pinnedFetch: vi.fn(),
}));

import { pinnedFetch } from "../services/arena/ssrfGuard.ts";
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

async function postCloudInference(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/arena/cloud-inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    const body = await res.json();
    expect(body.error).toMatch(/timed out/i);
  });

  it("maps policy/SSRF errors to 400", async () => {
    mockedPinnedFetch.mockRejectedValue(new Error("Private endpoints are not supported"));

    const res = await postCloudInference({
      endpointUrl: "https://127.0.0.1/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Private endpoints are not supported",
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
