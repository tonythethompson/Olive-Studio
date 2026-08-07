import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock readEnvApiKey BEFORE any registry imports ──────────────────────────
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

// Side-effect import: triggers all providers to register themselves.
import "./index.ts";

import {
  registerProvider,
  getProvider,
  allProviders,
  registeredProviderNames,
  detectEnvProvider,
  callProvider,
  providerSupportsJsonResponse,
  type AiProviderPlugin,
} from "./registry.ts";
import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { readEnvApiKey } from "./env.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProvider(
  name: ProviderConfig["provider"],
  overrides?: Partial<AiProviderPlugin>,
): AiProviderPlugin {
  return {
    name,
    label: `Test ${name}`,
    defaultModel: "test-model",
    envVarNames: [`${name.toUpperCase()}_API_KEY`],
    buildConfig: (apiKey) => ({ provider: name, apiKey, model: "test-model" }),
    call: vi.fn().mockResolvedValue("response from " + name),
    ...overrides,
  };
}

function makeCfg(provider: ProviderConfig["provider"], overrides?: Partial<ProviderConfig>): ProviderConfig {
  return { provider, apiKey: "sk-test", model: "test-model", ...overrides };
}

// ── 1. Registration: all real providers ──────────────────────────────────────

describe("Provider registration", () => {
  const EXPECTED_PROVIDERS: Array<{
    name: ProviderConfig["provider"];
    label: string;
    defaultModel: string;
    hasEnvVars: boolean; // falsy = runtime-override-only
  }> = [
    { name: "gemini", label: "Google Gemini", defaultModel: "gemini-2.5-flash", hasEnvVars: true },
    { name: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", hasEnvVars: true },
    {
      name: "chatgpt-sub",
      label: "ChatGPT Plus/Pro Subscription",
      defaultModel: "gpt-4o-mini",
      hasEnvVars: false,
    },
    { name: "mistral", label: "Mistral AI", defaultModel: "mistral-large-latest", hasEnvVars: true },
    { name: "xai", label: "xAI Grok", defaultModel: "grok-3", hasEnvVars: true },
    { name: "openrouter", label: "OpenRouter", defaultModel: "openai/gpt-4o", hasEnvVars: true },
    { name: "groq", label: "Groq", defaultModel: "llama-4-scout-17b-16e-instruct", hasEnvVars: true },
    {
      name: "together",
      label: "Together AI",
      defaultModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      hasEnvVars: true,
    },
    { name: "kilocode", label: "Kilo Code", defaultModel: "anthropic/claude-sonnet-4", hasEnvVars: true },
    { name: "opencode", label: "OpenCode Zen", defaultModel: "kimi-k2.7-code", hasEnvVars: true },
    { name: "opencode-go", label: "OpenCode Go", defaultModel: "kimi-k2.7-code", hasEnvVars: true },
    {
      name: "fireworks",
      label: "Fireworks AI",
      defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      hasEnvVars: true,
    },
    { name: "nvidia", label: "NVIDIA NIM", defaultModel: "meta/llama-3.1-8b-instruct", hasEnvVars: true },
    { name: "huggingface", label: "Hugging Face", defaultModel: "moonshotai/Kimi-K2.5", hasEnvVars: true },
    { name: "copilot", label: "GitHub Copilot", defaultModel: "gpt-4o", hasEnvVars: true },
    { name: "openai-compat", label: "OpenAI-Compatible API", defaultModel: "gpt-4o-mini", hasEnvVars: true },
    { name: "devin", label: "Devin (Cognition AI)", defaultModel: "swe-1-6", hasEnvVars: false },
    { name: "codex", label: "OpenAI Codex CLI", defaultModel: "default", hasEnvVars: false },
    {
      name: "cloudflare",
      label: "Cloudflare Workers AI",
      defaultModel: "@cf/meta/llama-3.1-8b-instruct",
      hasEnvVars: true,
    },
    {
      name: "anthropic",
      label: "Anthropic Claude",
      defaultModel: "claude-haiku-4-5-20251001",
      hasEnvVars: true,
    },
  ];

  it("all expected providers are registered", () => {
    const names = registeredProviderNames();
    expect(names.size).toBeGreaterThanOrEqual(16);
    for (const { name } of EXPECTED_PROVIDERS) {
      expect(names.has(name), `missing: ${name}`).toBe(true);
    }
  });

  it("getProvider returns undefined for unknown names", () => {
    expect(getProvider("nonexistent" as ProviderConfig["provider"])).toBeUndefined();
  });

  for (const { name, label, defaultModel, hasEnvVars } of EXPECTED_PROVIDERS) {
    it(`${name} has correct metadata`, () => {
      const p = getProvider(name);
      expect(p, `provider ${name} should be registered`).toBeDefined();
      expect(p!.name).toBe(name);
      expect(p!.label).toBe(label);
      expect(p!.defaultModel).toBe(defaultModel);
      if (hasEnvVars) {
        expect(p!.envVarNames.length, `${name} should have env var names`).toBeGreaterThan(0);
      }
    });
  }

  it("allProviders() yields all registered providers", () => {
    const found = Array.from(allProviders());
    expect(found.length).toBeGreaterThanOrEqual(14);
    const names = found.map((p) => p.name);
    for (const { name } of EXPECTED_PROVIDERS) {
      expect(names).toContain(name);
    }
  });

  it("registerProvider rejects duplicate names", () => {
    // The real "gemini" is already registered. Registering again must throw.
    expect(() => registerProvider(makeProvider("gemini"))).toThrow(
      "Duplicate AI provider registration: gemini",
    );
  });
});

// ── 2. Detection order ──────────────────────────────────────────────────────

describe("detectEnvProvider — priority order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no API keys are set", () => {
    vi.mocked(readEnvApiKey).mockReturnValue(undefined);
    expect(detectEnvProvider()).toBeNull();
  });

  it("returns Gemini first (highest priority in import order)", () => {
    // Gemini is imported first in index.ts. Return a key for all providers
    // but Gemini should win because it's checked first.
    vi.mocked(readEnvApiKey).mockReturnValue("sk-fake");
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini");
  });

  it("skips providers with no env vars (devin, codex, chatgpt-sub)", () => {
    vi.mocked(readEnvApiKey).mockReturnValue("sk-fake");
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini");
    expect(result?.provider).not.toBe("devin");
    expect(result?.provider).not.toBe("codex");
    expect(result?.provider).not.toBe("chatgpt-sub");
  });

  it("respects registration priority: gemini > openai > mistral > xai", () => {
    const callOrder: string[] = [];
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      const first = keys[0];
      if (first) callOrder.push(first);
      return undefined;
    });

    detectEnvProvider();

    // Verify relative order rather than exact indices (resilient to reordering)
    const geminiIdx = callOrder.indexOf("GEMINI_API_KEY");
    const openaiIdx = callOrder.indexOf("OPENAI_API_KEY");
    const mistralIdx = callOrder.indexOf("MISTRAL_API_KEY");
    const xaiIdx = callOrder.indexOf("XAI_API_KEY");

    expect(geminiIdx).toBeGreaterThanOrEqual(0);
    expect(openaiIdx).toBeGreaterThan(geminiIdx);
    expect(mistralIdx).toBeGreaterThan(openaiIdx);
    expect(xaiIdx).toBeGreaterThan(mistralIdx);
  });

  it("detects OpenAI when Gemini key is not set but OpenAI is", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "OPENAI_API_KEY" ? "sk-openai" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("openai");
    expect(result?.model).toBe("gpt-4o-mini");
  });

  it("detects Anthropic when earlier providers have no keys", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "ANTHROPIC_API_KEY" ? "sk-ant" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("anthropic");
  });

  it("detects Mistral (checked after openai, before xai)", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "MISTRAL_API_KEY" ? "sk-mistral" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("mistral");
  });

  it("detects xAI Grok", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "XAI_API_KEY" ? "sk-xai" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("xai");
  });

  it("detects OpenRouter", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "OPENROUTER_API_KEY" ? "sk-or" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("openrouter");
  });

  it("detects Groq", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "GROQ_API_KEY" ? "sk-groq" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("groq");
  });

  it("detects Together AI", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "TOGETHER_API_KEY" ? "sk-tog" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("together");
  });

  it("detects Kilo Code", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "KILO_API_KEY" ? "sk-kilo" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("kilocode");
  });

  it("detects GitHub Copilot with GITHUB_COPILOT_TOKEN", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "GITHUB_COPILOT_TOKEN" ? "ghu_token" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("copilot");
  });

  it("detects OpenAI-compatible with OPENAI_COMPAT_API_KEY", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "OPENAI_COMPAT_API_KEY" ? "sk-compat" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("openai-compat");
  });

  it("detects Gemini via GOOGLE_API_KEY fallback", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys.includes("GOOGLE_API_KEY")) return "sk-google";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini");
  });

  it("detects Copilot via GITHUB_TOKEN fallback", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys.includes("GITHUB_TOKEN")) return "gh_token";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("copilot");
  });

  it("detects Kilo Code via KILOCODE_API_KEY fallback", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) => {
      if (keys.includes("KILOCODE_API_KEY")) return "sk-kc";
      return undefined;
    });
    const result = detectEnvProvider();
    expect(result?.provider).toBe("kilocode");
  });
});

// ── 3. callProvider dispatch ────────────────────────────────────────────────

describe("callProvider — dispatch", () => {
  const testName = "test-dispatch" as ProviderConfig["provider"];
  const testPlugin = makeProvider(testName, {
    defaultModel: "dispatch-model",
    envVarNames: [],
    call: vi.fn().mockResolvedValue("dispatched!"),
  });

  beforeAll(() => {
    // Safe: "test-dispatch" is not a real provider.
    registerProvider(testPlugin);
  });

  it("calls the correct provider handler", async () => {
    const cfg = makeCfg(testName);
    const messages: AIChatMessage[] = [{ role: "user", content: "hello" }];

    const result = await callProvider(cfg, "system prompt", messages, false);

    expect(result).toBe("dispatched!");
    expect(testPlugin.call).toHaveBeenCalledTimes(1);
    expect(testPlugin.call).toHaveBeenCalledWith(cfg, "system prompt", messages, false);
  });

  it("passes wantJson flag to the handler", async () => {
    const cfg = makeCfg(testName);
    await callProvider(cfg, "sys", [], true);
    expect(testPlugin.call).toHaveBeenCalledWith(cfg, "sys", [], true);
  });

  it("throws for unknown providers", async () => {
    const cfg = makeCfg("nonexistent" as ProviderConfig["provider"]);
    await expect(callProvider(cfg, "sys", [], false)).rejects.toThrow("Unknown AI provider: nonexistent");
  });

  it("lists registered providers in the error message", async () => {
    const cfg = makeCfg("nonexistent" as ProviderConfig["provider"]);
    await expect(callProvider(cfg, "sys", [], false)).rejects.toThrow(/Registered: .*gemini.*openai/s);
  });
});

// ── 4. providerSupportsJsonResponse ────────────────────────────────────────

describe("providerSupportsJsonResponse", () => {
  it("returns true for OpenAI", () => {
    expect(providerSupportsJsonResponse(makeCfg("openai"))).toBe(true);
  });

  it("returns true for Mistral", () => {
    expect(providerSupportsJsonResponse(makeCfg("mistral"))).toBe(true);
  });

  it("returns true for xAI", () => {
    expect(providerSupportsJsonResponse(makeCfg("xai"))).toBe(true);
  });

  it("returns true for OpenRouter", () => {
    expect(providerSupportsJsonResponse(makeCfg("openrouter"))).toBe(true);
  });

  it("returns true for Groq", () => {
    expect(providerSupportsJsonResponse(makeCfg("groq"))).toBe(true);
  });

  it("returns true for Together", () => {
    expect(providerSupportsJsonResponse(makeCfg("together"))).toBe(true);
  });

  it("returns true for chatgpt-sub", () => {
    expect(providerSupportsJsonResponse(makeCfg("chatgpt-sub"))).toBe(true);
  });

  it("returns false for Gemini", () => {
    expect(providerSupportsJsonResponse(makeCfg("gemini"))).toBe(false);
  });

  it("returns false for Anthropic", () => {
    expect(providerSupportsJsonResponse(makeCfg("anthropic"))).toBe(false);
  });

  it("returns false for Copilot", () => {
    expect(providerSupportsJsonResponse(makeCfg("copilot"))).toBe(false);
  });

  it("returns false for unknown providers", () => {
    expect(providerSupportsJsonResponse(makeCfg("nonexistent" as ProviderConfig["provider"]))).toBe(false);
  });
});

// ── 5. Edge cases ───────────────────────────────────────────────────────────

describe("Edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envVarNames:[] providers (devin, codex, chatgpt-sub) are never auto-detected", () => {
    vi.mocked(readEnvApiKey).mockReturnValue("sk-any");
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini"); // first with real env vars
    expect(result?.provider).not.toBe("devin");
    expect(result?.provider).not.toBe("codex");
    expect(result?.provider).not.toBe("chatgpt-sub");
  });

  it("buildConfig returns correct model from plugin metadata", () => {
    vi.mocked(readEnvApiKey).mockReturnValue("sk-test");
    const result = detectEnvProvider();
    expect(result?.provider).toBe("gemini");
    expect(result?.model).toBe("gemini-2.5-flash");
    expect(result?.apiKey).toBe("sk-test");
  });

  it("providers with baseUrl include it in buildConfig", () => {
    vi.mocked(readEnvApiKey).mockImplementation((...keys: string[]) =>
      keys[0] === "OPENROUTER_API_KEY" ? "sk-or" : undefined,
    );
    const result = detectEnvProvider();
    expect(result?.provider).toBe("openrouter");
    expect(result?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });
});
