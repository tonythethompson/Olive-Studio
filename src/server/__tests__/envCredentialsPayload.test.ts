/**
 * Tests for the envCredentialsPayload composition logic used in GET /api/ai/provider.
 *
 * Since `envCredentialsPayload()` is a private function in providerRoutes.ts,
 * we replicate its logic here: reading env vars → computing Cloudflare status →
 * passing through `listEnvCredentialStatus()`. This validates both the
 * composition and the underlying `listEnvCredentialStatus` extraFields spreading.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock env module BEFORE any registry imports ─────────────────────────────
vi.mock("../services/ai/env.ts", () => ({
  readEnvApiKey: vi.fn(),
  matchedEnvApiKeyName: vi.fn(),
}));

// ── Mock Cloudflare client ──────────────────────────────────────────────────
vi.mock("../../lib/cloudflare/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/cloudflare/client.ts")>();
  return {
    ...actual,
    resolveCloudflareAuth: vi.fn(() => null),
  };
});

// Side-effect import: triggers all providers to register themselves.
import "../services/ai/index.ts";

import { listEnvCredentialStatus } from "../services/ai/registry.ts";
import { readEnvApiKey, matchedEnvApiKeyName } from "../services/ai/env.ts";
import { resolveCloudflareAuth } from "../../lib/cloudflare/client.ts";
import { isValidCloudflareAccountId } from "../../lib/cloudflare/credentials.ts";

const mockedReadEnvApiKey = vi.mocked(readEnvApiKey);
const mockedMatchedEnvApiKeyName = vi.mocked(matchedEnvApiKeyName);
const mockedResolveCloudflareAuth = vi.mocked(resolveCloudflareAuth);

// ── Replicate envCredentialsPayload() logic (mirrors providerRoutes.ts) ─────
function envCredentialsPayload() {
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfAuth = mockedResolveCloudflareAuth();
  const cloudflareUsable =
    Boolean(cfAuth) ||
    (Boolean(mockedReadEnvApiKey("CLOUDFLARE_API_TOKEN")) && isValidCloudflareAccountId(cfAccount));

  const cfAccountIdPresent = cfAccount.length > 0 || Boolean(cfAuth?.accountId);
  const cfAccountIdValid = isValidCloudflareAccountId(cfAccount) || Boolean(cfAuth?.accountId);

  return listEnvCredentialStatus(
    { cloudflare: cloudflareUsable },
    { cloudflare: { cloudflareAccountId: { present: cfAccountIdPresent, valid: cfAccountIdValid } } },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Saved env vars to restore after each test. */
let savedEnv: Record<string, string | undefined>;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("envCredentialsPayload — Cloudflare env var combinations", () => {
  beforeEach(() => {
    savedEnv = {
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    };
    // Default: no env vars, no mocked env key reads, no Wrangler auth
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    mockedReadEnvApiKey.mockReturnValue(undefined);
    mockedMatchedEnvApiKeyName.mockReturnValue(undefined);
    mockedResolveCloudflareAuth.mockReturnValue(null);
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      setEnv(key, value);
    }
    vi.restoreAllMocks();
  });

  it("both env vars set and valid → usable: true, cloudflareAccountId: { present: true, valid: true }", () => {
    const validAccountId = "abcdef0123456789abcdef0123456789";
    process.env.CLOUDFLARE_ACCOUNT_ID = validAccountId;

    // readEnvApiKey("CLOUDFLARE_API_TOKEN") returns a token
    mockedReadEnvApiKey.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "cf-token-value";
      return undefined;
    });
    // matchedEnvApiKeyName returns the env var name for cloudflare
    mockedMatchedEnvApiKeyName.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "CLOUDFLARE_API_TOKEN";
      return undefined;
    });

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    expect(cf!.usable).toBe(true);
    expect(cf!.present).toBe(true);
    expect(cf!.envVar).toBe("CLOUDFLARE_API_TOKEN");
    expect(cf!.cloudflareAccountId).toEqual({ present: true, valid: true });
  });

  it("token set, account ID missing → usable: false, present: true, cloudflareAccountId: { present: false, valid: false }", () => {
    // No CLOUDFLARE_ACCOUNT_ID env var
    mockedReadEnvApiKey.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "cf-token-value";
      return undefined;
    });
    mockedMatchedEnvApiKeyName.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "CLOUDFLARE_API_TOKEN";
      return undefined;
    });

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    expect(cf!.usable).toBe(false);
    expect(cf!.present).toBe(true);
    expect(cf!.envVar).toBe("CLOUDFLARE_API_TOKEN");
    expect(cf!.cloudflareAccountId).toEqual({ present: false, valid: false });
  });

  it("token set, account ID present but invalid (not 32 hex) → usable: false, present: true, cloudflareAccountId: { present: true, valid: false }", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "not-valid-hex";

    mockedReadEnvApiKey.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "cf-token-value";
      return undefined;
    });
    mockedMatchedEnvApiKeyName.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "CLOUDFLARE_API_TOKEN";
      return undefined;
    });

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    expect(cf!.usable).toBe(false);
    expect(cf!.present).toBe(true);
    expect(cf!.cloudflareAccountId).toEqual({ present: true, valid: false });
  });

  it("neither env var set → usable: false, present: false, cloudflareAccountId: { present: false, valid: false }", () => {
    // Defaults: no env vars, readEnvApiKey returns undefined, matchedEnvApiKeyName returns undefined

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    expect(cf!.usable).toBe(false);
    expect(cf!.present).toBe(false);
    expect(cf!.envVar).toBeNull();
    expect(cf!.cloudflareAccountId).toEqual({ present: false, valid: false });
  });

  it("resolveCloudflareAuth() returns auth object (Wrangler flow) → usable: true, cloudflareAccountId: { present: true, valid: true }", () => {
    mockedResolveCloudflareAuth.mockReturnValue({
      apiToken: "wrangler-token",
      accountId: "abcdef0123456789abcdef0123456789",
      source: "file" as const,
    });
    // matchedEnvApiKeyName may or may not find the env var; Wrangler auth path doesn't need it.
    // The token might not be in process.env but resolved from credentials file.
    mockedMatchedEnvApiKeyName.mockReturnValue(undefined);

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    expect(cf!.usable).toBe(true);
    expect(cf!.cloudflareAccountId).toEqual({ present: true, valid: true });
  });

  it("CLOUDFLARE_ACCOUNT_ID is whitespace only → treated as not present", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "   ";

    mockedReadEnvApiKey.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "cf-token-value";
      return undefined;
    });
    mockedMatchedEnvApiKeyName.mockImplementation((...names: string[]) => {
      if (names.includes("CLOUDFLARE_API_TOKEN")) return "CLOUDFLARE_API_TOKEN";
      return undefined;
    });

    const result = envCredentialsPayload();
    const cf = result["cloudflare"];

    expect(cf).toBeDefined();
    // Whitespace-only trims to "" so both present and valid should be false
    expect(cf!.cloudflareAccountId).toEqual({ present: false, valid: false });
    // Without a valid account ID, the composite is not usable
    expect(cf!.usable).toBe(false);
  });

  it("non-Cloudflare providers do not include cloudflareAccountId field", () => {
    const result = envCredentialsPayload();

    // Check a few known providers
    for (const [name, status] of Object.entries(result)) {
      if (name !== "cloudflare") {
        expect(status.cloudflareAccountId).toBeUndefined();
      }
    }
  });
});

describe("listEnvCredentialStatus — extraFields spreading", () => {
  beforeEach(() => {
    mockedMatchedEnvApiKeyName.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extraFields are only applied to the specified provider", () => {
    const result = listEnvCredentialStatus(undefined, {
      cloudflare: { cloudflareAccountId: { present: true, valid: true } },
    });

    // Cloudflare gets the extra field
    expect(result["cloudflare"]?.cloudflareAccountId).toEqual({ present: true, valid: true });

    // Other providers do not get it
    if (result["openai"]) {
      expect(result["openai"].cloudflareAccountId).toBeUndefined();
    }
    if (result["gemini"]) {
      expect(result["gemini"].cloudflareAccountId).toBeUndefined();
    }
  });

  it("every provider always has present, envVar, and usable fields", () => {
    const result = listEnvCredentialStatus(
      { cloudflare: true },
      { cloudflare: { cloudflareAccountId: { present: true, valid: false } } },
    );

    for (const [, status] of Object.entries(result)) {
      expect(status).toHaveProperty("present");
      expect(status).toHaveProperty("envVar");
      expect(status).toHaveProperty("usable");
    }
  });

  it("when no extraFields provided, no extra properties appear", () => {
    const result = listEnvCredentialStatus();

    for (const [, status] of Object.entries(result)) {
      expect(status.cloudflareAccountId).toBeUndefined();
    }
  });
});
