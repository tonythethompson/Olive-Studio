import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock readEnvApiKey
vi.mock("./env.ts", () => ({
  readEnvApiKey: vi.fn(),
  matchedEnvApiKeyName: vi.fn(),
}));

// Cloudflare auth reads a local credential file and bypasses readEnvApiKey —
// stub it so machine-local credentials cannot leak into provider detection tests.
vi.mock("../../../lib/cloudflare/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/cloudflare/client.ts")>();
  return {
    ...actual,
    resolveCloudflareAuth: vi.fn(() => null),
  };
});

import { readEnvApiKey } from "./env.ts";
import { detectEnvProvider, ALLOWED_AI_PROVIDERS } from "./detect.ts";

describe("detectEnvProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readEnvApiKey).mockReturnValue(undefined);
  });

  it("returns null when no API keys are set", () => {
    expect(detectEnvProvider()).toBeNull();
  });

  it("detects Gemini provider when GEMINI_API_KEY is set", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys[0] === "GEMINI_API_KEY") return "test-key";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini");
  });

  it("detects OpenAI provider when OPENAI_API_KEY is set", () => {
    // Gemini must fail first, then OpenAI succeeds
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys[0] === "OPENAI_API_KEY") return "test-key";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("openai");
  });

  it("detects Anthropic provider when ANTHROPIC_API_KEY is set", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys[0] === "ANTHROPIC_API_KEY") return "test-key";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("anthropic");
  });

  it("has all expected provider identifiers", () => {
    expect(ALLOWED_AI_PROVIDERS.has("gemini")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("openai")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("anthropic")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("devin")).toBe(true);
    expect(ALLOWED_AI_PROVIDERS.has("codex")).toBe(true);
  });
});
