/**
 * Unit + PBT coverage for Arena Assistant snapshot helpers (Req 18 / Properties 21, 22).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  isArenaOpenAiCompatProvider,
  resolveArenaSnapshotEndpointUrl,
  buildAssistantCloudSnapshot,
  toCloudSlotPatch,
  type AssistantCloudSnapshotEligible,
} from "@/lib/arenaAssistantSnapshot";

describe("isArenaOpenAiCompatProvider", () => {
  it("rejects native non-compat providers", () => {
    for (const provider of ["gemini", "anthropic", "devin", "codex", "copilot"]) {
      expect(isArenaOpenAiCompatProvider({ provider, baseUrl: "https://api.example.com/v1" })).toBe(
        false,
      );
    }
  });

  it("accepts openai with default public host", () => {
    expect(isArenaOpenAiCompatProvider({ provider: "openai" })).toBe(true);
  });

  it("requires baseUrl for openai-compat", () => {
    expect(isArenaOpenAiCompatProvider({ provider: "openai-compat" })).toBe(false);
    expect(
      isArenaOpenAiCompatProvider({
        provider: "openai-compat",
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe(true);
  });

  it("rejects private/loopback hosts without loopback override", () => {
    const prev = process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
    delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
    try {
      expect(
        isArenaOpenAiCompatProvider({
          provider: "openai-compat",
          baseUrl: "http://127.0.0.1:11434/v1",
        }),
      ).toBe(false);
      expect(
        isArenaOpenAiCompatProvider({
          provider: "openai-compat",
          baseUrl: "https://192.168.1.10/v1",
        }),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
      else process.env.OLIVE_ALLOW_LOOPBACK_HTTP = prev;
    }
  });

  it("allows loopback http when OLIVE_ALLOW_LOOPBACK_HTTP=true", () => {
    const prev = process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
    process.env.OLIVE_ALLOW_LOOPBACK_HTTP = "true";
    try {
      expect(
        isArenaOpenAiCompatProvider({
          provider: "openai-compat",
          baseUrl: "http://127.0.0.1:11434/v1",
        }),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
      else process.env.OLIVE_ALLOW_LOOPBACK_HTTP = prev;
    }
  });
});

describe("buildAssistantCloudSnapshot", () => {
  it("returns ineligible without credential fields when no provider", () => {
    const snap = buildAssistantCloudSnapshot(null);
    expect(snap).toEqual({ eligible: false, reason: expect.any(String) });
    expect(snap).not.toHaveProperty("apiKey");
    expect(snap).not.toHaveProperty("endpointUrl");
    expect(snap).not.toHaveProperty("modelId");
  });

  it("returns eligible snapshot for openai-compat public host", () => {
    const snap = buildAssistantCloudSnapshot({
      provider: "openai-compat",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
      label: "Custom",
    });
    expect(snap).toEqual({
      eligible: true,
      endpointUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "gpt-test",
      providerLabel: "Custom",
    });
  });

  it("Property 21: eligibility matches OpenAI-compat + outbound policy", () => {
    // Feature: playground-tab, Property 21
    const nonCompat = fc.constantFrom("gemini", "anthropic", "devin", "codex", "copilot");
    const publicHttps = fc
      .tuple(
        fc.domain(),
        fc.option(fc.webPath(), { nil: undefined }),
      )
      .map(([host, path]) => `https://${host}${path ?? "/v1"}`);

    fc.assert(
      fc.property(
        fc.record({
          provider: fc.constantFrom(
            "openai",
            "openai-compat",
            "mistral",
            "gemini",
            "anthropic",
            "devin",
            "codex",
            "copilot",
          ),
          baseUrl: fc.option(publicHttps, { nil: null }),
          apiKey: fc.string({ maxLength: 32 }),
          model: fc.string({ minLength: 1, maxLength: 32 }),
        }),
        (desc) => {
          const snap = buildAssistantCloudSnapshot(desc);
          if (snap.eligible) {
            expect(isArenaOpenAiCompatProvider(desc)).toBe(true);
            expect(snap.endpointUrl.length).toBeGreaterThan(0);
            expect(snap.modelId.length).toBeGreaterThan(0);
            expect(snap).toHaveProperty("apiKey");
          } else {
            expect(snap).not.toHaveProperty("apiKey");
            expect(snap).not.toHaveProperty("endpointUrl");
            expect(snap).not.toHaveProperty("modelId");
            expect(typeof snap.reason).toBe("string");
            expect(snap.reason.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );

    // Non-compat always ineligible failure shape
    fc.assert(
      fc.property(nonCompat, fc.webUrl(), (provider, baseUrl) => {
        const snap = buildAssistantCloudSnapshot({
          provider,
          baseUrl,
          apiKey: "x",
          model: "m",
        });
        expect(snap.eligible).toBe(false);
        if (!snap.eligible) {
          expect(Object.keys(snap).sort()).toEqual(["eligible", "reason"]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("toCloudSlotPatch", () => {
  it("Property 22: convenience fill writes the same cloud ArenaSlotConfig shape", () => {
    // Feature: playground-tab, Property 22
    fc.assert(
      fc.property(
        fc.record({
          endpointUrl: fc.webUrl(),
          apiKey: fc.string({ maxLength: 64 }),
          modelId: fc.string({ minLength: 1, maxLength: 64 }),
          providerLabel: fc.string({ minLength: 1, maxLength: 32 }),
        }),
        (fields) => {
          const snapshot: AssistantCloudSnapshotEligible = {
            eligible: true,
            ...fields,
          };
          const patch = toCloudSlotPatch(snapshot);
          expect(patch).toEqual({
            type: "cloud",
            endpointUrl: fields.endpointUrl,
            apiKey: fields.apiKey,
            modelId: fields.modelId,
          });
          // No extra discriminant
          expect(Object.keys(patch).sort()).toEqual(["apiKey", "endpointUrl", "modelId", "type"]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("resolveArenaSnapshotEndpointUrl", () => {
  const envKeys = ["OLIVE_ALLOW_LOOPBACK_HTTP"] as const;
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("strips trailing slashes", () => {
    expect(
      resolveArenaSnapshotEndpointUrl({
        provider: "openai-compat",
        baseUrl: "https://api.example.com/v1///",
      }),
    ).toBe("https://api.example.com/v1");
  });

  it("rejects IPv6 link-local, ULA, loopback, and IPv4-mapped private literals", () => {
    const blocked = [
      "http://[fe80::1]/v1",
      "https://[fd12:3456:789a::1]/v1",
      "https://[::1]/v1",
      "https://[::ffff:10.0.0.1]/v1",
      "https://[::ffff:192.168.1.1]/v1",
    ];
    for (const baseUrl of blocked) {
      expect(
        resolveArenaSnapshotEndpointUrl({ provider: "openai-compat", baseUrl }),
      ).toBeNull();
    }
  });

  it("allows loopback http IPv6 when OLIVE_ALLOW_LOOPBACK_HTTP=true", () => {
    process.env.OLIVE_ALLOW_LOOPBACK_HTTP = "true";
    expect(
      resolveArenaSnapshotEndpointUrl(
        { provider: "openai-compat", baseUrl: "http://[::1]/v1" },
        { allowLoopbackHttp: true },
      ),
    ).toBe("http://[::1]/v1");
  });
});
