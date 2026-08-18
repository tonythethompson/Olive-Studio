import { describe, it, expect } from "vitest";
import { PROVIDER_OPTIONS, normalizeUiProviderId } from "@/components/features/assistant/aiProviderCatalog";
import { CLOUDFLARE_FALLBACK_MODELS } from "@/lib/cloudflare/client";
import { DEVIN_FALLBACK_MODELS } from "@/lib/devin/client";

describe("aiProviderCatalog / server model contract", () => {
  it("keeps Cloudflare UI models identical to the server-owned fallback catalog", () => {
    const cloudflare = PROVIDER_OPTIONS.find((p) => p.id === "cloudflare");
    expect(cloudflare?.models).toEqual(CLOUDFLARE_FALLBACK_MODELS.map((m) => m.id));
  });

  it("keeps Devin UI models identical to the server-owned fallback catalog", () => {
    const devin = PROVIDER_OPTIONS.find((p) => p.id === "devin");
    expect(devin?.models).toEqual(DEVIN_FALLBACK_MODELS.map((m) => m.id));
  });

  it("keeps dynamically-supplied OpenCode model lists non-empty (no static server allowlist)", () => {
    const opencode = PROVIDER_OPTIONS.find((p) => p.id === "opencode");
    const opencodeGo = PROVIDER_OPTIONS.find((p) => p.id === "opencode-go");
    expect(opencode?.models.length).toBeGreaterThan(0);
    expect(opencodeGo?.models.length).toBeGreaterThan(0);
  });

  it("normalizes the legacy chatgpt-sub alias and rejects unknown ids", () => {
    expect(normalizeUiProviderId("chatgpt-sub")).toBe("openai");
    expect(normalizeUiProviderId("openai")).toBe("openai");
    expect(normalizeUiProviderId("not-a-provider")).toBeNull();
  });
});