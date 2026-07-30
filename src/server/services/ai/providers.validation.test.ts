/**
 * Validation behavior for empty provider responses and openai-compat base URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../shared/http.ts", () => ({
  fetchWithTimeout: vi.fn(),
  DEFAULT_FETCH_TIMEOUT_MS: 120_000,
}));

// Side-effect import registers real providers before we call them.
import "./index.ts";
import { callProvider } from "./registry.ts";
import { callOpenAICompat } from "./openai.ts";
import { fetchWithTimeout } from "../shared/http.ts";
import type { ProviderConfig } from "../../types.ts";

const mockedFetch = vi.mocked(fetchWithTimeout);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI provider empty-response validation", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("callOpenAICompat throws when content is empty or whitespace", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "   " } }] }));
    await expect(
      callOpenAICompat({ provider: "openai", apiKey: "k", model: "gpt-4o-mini" }, "sys", [], false),
    ).rejects.toThrow("openai returned an empty response.");
  });

  it("rejects openai-compat without an explicit baseUrl", async () => {
    await expect(
      callOpenAICompat({ provider: "openai-compat", apiKey: "k", model: "gpt-4o-mini" }, "sys", [], false),
    ).rejects.toThrow("openai-compat provider requires an explicit baseUrl.");
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("resolves registered OpenAI default base and unregistered fallback", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

    await callOpenAICompat({ provider: "openai", apiKey: "k", model: "gpt-4o-mini" }, "sys", [], false);
    expect(String(mockedFetch.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    // Cast: simulate a provider id that is not registered so defaultBaseUrl is missing.
    const unregistered = {
      provider: "not-a-real-provider",
      apiKey: "k",
      model: "m",
    } as unknown as ProviderConfig;
    await callOpenAICompat(unregistered, "sys", [], false);
    expect(String(mockedFetch.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("Anthropic throws on empty or whitespace text", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ content: [{ text: "\n" }] }));
    await expect(
      callProvider({ provider: "anthropic", apiKey: "k", model: "claude" }, "sys", [], false),
    ).rejects.toThrow("Anthropic returned an empty response.");
  });

  it("Gemini throws on empty or whitespace text", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: "" }] } }] }));
    await expect(
      callProvider({ provider: "gemini", apiKey: "k", model: "gemini-2.5-flash" }, "sys", [], false),
    ).rejects.toThrow("Gemini returned an empty response.");
  });

  it("Gemini sends API key via header, not URL query", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }),
    );
    await callProvider(
      { provider: "gemini", apiKey: "secret-key", model: "gemini-2.5-flash" },
      "sys",
      [],
      false,
    );

    const [url, init] = mockedFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(String(url)).not.toContain("secret-key");
    expect(String(url)).not.toContain("key=");
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "secret-key",
    });
  });
});
