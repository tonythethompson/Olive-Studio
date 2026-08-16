import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env + config BEFORE state/provider imports so nothing touches disk or
// machine-local credentials.
vi.mock("./env.ts", () => ({
  readEnvApiKey: vi.fn(),
  matchedEnvApiKeyName: vi.fn(),
}));

vi.mock("../../config.ts", () => ({
  readStudioConfig: vi.fn(() => ({})),
  writeStudioConfig: vi.fn(),
}));

// Cloudflare auth reads a local credential file and bypasses readEnvApiKey —
// stub it so machine-local credentials cannot leak into restore tests.
vi.mock("../../../lib/cloudflare/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/cloudflare/client.ts")>();
  return {
    ...actual,
    resolveCloudflareAuth: vi.fn(() => null),
  };
});

// Side-effect import: triggers all providers to register themselves.
import "./index.ts";

import { readEnvApiKey } from "./env.ts";
import { restoreProviderFromPreference, type AiPreference } from "./state.ts";

describe("restoreProviderFromPreference", () => {
  beforeEach(() => {
    vi.mocked(readEnvApiKey).mockReturnValue(undefined);
  });

  it("restores genai without any API key (local engine)", () => {
    const pref: AiPreference = { provider: "genai", model: "qwen2.5-coder-1.5b-instruct-onnx" };
    const cfg = restoreProviderFromPreference(pref);
    expect(cfg?.provider).toBe("genai");
    expect(cfg?.model).toBe("qwen2.5-coder-1.5b-instruct-onnx");
  });

  it("restores bedrock on the default AWS credential chain alone", () => {
    const pref: AiPreference = {
      provider: "bedrock",
      model: "anthropic.claude-3-5-haiku-20241022-v1:0",
      baseUrl: "us-west-2",
    };
    const cfg = restoreProviderFromPreference(pref);
    expect(cfg?.provider).toBe("bedrock");
    // The baseUrl field carries the AWS region for bedrock.
    expect(cfg?.baseUrl).toBe("us-west-2");
  });

  it("still rejects key-required providers without env credentials", () => {
    const pref: AiPreference = { provider: "gemini", model: "gemini-2.5-flash" };
    expect(restoreProviderFromPreference(pref)).toBeNull();
  });
});
