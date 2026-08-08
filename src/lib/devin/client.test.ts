/**
 * Unit tests for the Devin subscription client.
 *
 * All file system and network operations are mocked — no real Cognition API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before any imports that use it
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock the cloud-direct modules (network layer)
vi.mock("./cloud-direct/chat.ts", () => ({
  streamChat: vi.fn(),
  clearSessionIds: vi.fn(),
}));

vi.mock("./cloud-direct/catalog.ts", () => ({
  getCachedCatalog: vi.fn(),
  clearCachedCatalog: vi.fn(),
}));

vi.mock("./cloud-direct/auth.ts", () => ({
  clearCachedUserJwt: vi.fn(),
}));

// Mock the register-user network call
vi.mock("./oauth/register-user.ts", () => ({
  registerUser: vi.fn(),
}));

import fs from "node:fs";
import {
  getDevinSignInUrl,
  getDevinAccountStatus,
  finishDevinLogin,
  logoutDevin,
  listDevinModels,
  devinChat,
  DEVIN_FALLBACK_MODELS,
} from "./client.ts";
import { streamChat } from "./cloud-direct/chat.ts";
import { getCachedCatalog } from "./cloud-direct/catalog.ts";
import { registerUser } from "./oauth/register-user.ts";

const MOCK_CREDS = {
  apiKey: "test-api-key-12345",
  name: "Test User",
  apiServerUrl: "https://server.codeium.com",
  issuedAt: "2026-07-01T00:00:00.000Z",
  oauthClientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
};

function mockCredsExist() {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(MOCK_CREDS));
}

function mockCredsAbsent() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── getDevinSignInUrl ──────────────────────────────────────────────────────

describe("getDevinSignInUrl", () => {
  it("returns a valid sign-in URL with OAuth params", () => {
    const url = getDevinSignInUrl();
    expect(url).toContain("https://windsurf.com/windsurf/signin");
    expect(url).toContain("response_type=token");
    expect(url).toContain("client_id=3GUryQ7ldAeKEuD2obYnppsnmj58eP5u");
    expect(url).toContain("redirect_uri=show-auth-token");
    expect(url).toContain("prompt=login");
    expect(url).toContain("state=");
  });
});

// ─── getDevinAccountStatus ──────────────────────────────────────────────────

describe("getDevinAccountStatus", () => {
  it("returns signedIn:false when no credentials file exists", () => {
    mockCredsAbsent();
    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(false);
    expect(status.name).toBeUndefined();
    expect(status.credPath).toContain("devin-credentials.json");
  });

  it("returns signedIn:true with account details when credentials exist", () => {
    mockCredsExist();
    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(true);
    expect(status.name).toBe("Test User");
    expect(status.apiServerUrl).toBe("https://server.codeium.com");
    expect(status.issuedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(status.credPath).toContain("devin-credentials.json");
  });

  it("returns signedIn:false when credential file is corrupt JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");
    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(false);
  });

  it("returns signedIn:false when credential file has no apiKey", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "User" }));
    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(false);
  });
});

// ─── finishDevinLogin / logoutDevin ─────────────────────────────────────────

describe("finishDevinLogin", () => {
  it("exchanges token, persists credentials, and returns account info", async () => {
    vi.mocked(registerUser).mockResolvedValue({
      apiKey: "new-key-xyz",
      name: "New User",
      apiServerUrl: "https://server.codeium.com",
      redirectUrl: "https://example.com/redirect",
    });

    const result = await finishDevinLogin("firebase-id-token-abc");
    expect(result.name).toBe("New User");
    expect(result.apiServerUrl).toBe("https://server.codeium.com");
    // Credentials should be persisted to disk
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("devin-credentials.json"),
      expect.stringContaining("new-key-xyz"),
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it("propagates network errors from registration", async () => {
    vi.mocked(registerUser).mockRejectedValue(new Error("Network timeout"));
    await expect(finishDevinLogin("some-token")).rejects.toThrow("Network timeout");
  });
});

describe("logoutDevin", () => {
  it("removes credential file when it exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    logoutDevin();
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("devin-credentials.json"));
  });

  it("does not throw when credential file is already absent", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => logoutDevin()).not.toThrow();
  });
});

// ─── Credential persistence round-trip ──────────────────────────────────────

describe("credential persistence round-trip", () => {
  it("login then status shows signed in", async () => {
    vi.mocked(registerUser).mockResolvedValue({
      apiKey: "round-trip-key",
      name: "Round Trip User",
      apiServerUrl: "https://server.codeium.com",
    });

    await finishDevinLogin("token");
    // After login, the writeFileSync was called. Now simulate reading that back.
    const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(writtenData);

    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(true);
    expect(status.name).toBe("Round Trip User");
  });

  it("logout then status shows signed out", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    logoutDevin();
    // After logout, simulate the file being gone
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const status = getDevinAccountStatus();
    expect(status.signedIn).toBe(false);
  });
});

// ─── listDevinModels ────────────────────────────────────────────────────────

describe("listDevinModels", () => {
  it("returns empty list with error when not signed in", async () => {
    mockCredsAbsent();
    const result = await listDevinModels();
    expect(result.models).toEqual([]);
    expect(result.source).toBe("fallback");
    expect(result.error).toContain("Sign in");
  });

  it("returns live models when catalog fetch succeeds", async () => {
    mockCredsExist();
    const catalogEntries = new Map([
      ["uid-1", { modelUid: "swe-1-7", label: "SWE-1.7", disabled: false }],
      ["uid-2", { modelUid: "claude-sonnet-4", label: "Claude Sonnet 4", disabled: false }],
    ]);
    vi.mocked(getCachedCatalog).mockResolvedValue({
      byUid: catalogEntries,
      fetchedAt: Date.now(),
    } as ReturnType<typeof getCachedCatalog> extends Promise<infer T> ? T : never);

    const result = await listDevinModels();
    expect(result.source).toBe("live");
    expect(result.models).toHaveLength(2);
    expect(result.models[0]?.id).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("returns error when catalog returns empty", async () => {
    mockCredsExist();
    vi.mocked(getCachedCatalog).mockResolvedValue({
      byUid: new Map(),
      fetchedAt: Date.now(),
    } as ReturnType<typeof getCachedCatalog> extends Promise<infer T> ? T : never);

    const result = await listDevinModels();
    expect(result.models).toEqual([]);
    expect(result.source).toBe("fallback");
    expect(result.error).toContain("empty");
  });

  it("returns error on network failure without throwing", async () => {
    mockCredsExist();
    vi.mocked(getCachedCatalog).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await listDevinModels();
    expect(result.models).toEqual([]);
    expect(result.source).toBe("fallback");
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("sorts models by name and caps at 80", async () => {
    mockCredsExist();
    const entries = new Map<string, { modelUid: string; label: string; disabled: boolean }>();
    for (let i = 0; i < 100; i++) {
      entries.set(`uid-${i}`, {
        modelUid: `model-${String(i).padStart(3, "0")}`,
        label: `Model ${String(i).padStart(3, "0")}`,
        disabled: false,
      });
    }
    vi.mocked(getCachedCatalog).mockResolvedValue({
      byUid: entries,
      fetchedAt: Date.now(),
    } as ReturnType<typeof getCachedCatalog> extends Promise<infer T> ? T : never);

    const result = await listDevinModels();
    expect(result.models.length).toBe(80);
    // Should be sorted alphabetically
    expect(result.models[0]?.name).toBe("Model 000");
  });
});

// ─── devinChat ──────────────────────────────────────────────────────────────

describe("devinChat", () => {
  it("throws when not signed in", async () => {
    mockCredsAbsent();
    await expect(
      devinChat({ model: "swe-1-7", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("Not signed in to Devin");
  });

  it("collects stream deltas into a single response string", async () => {
    mockCredsExist();
    // Mock streamChat as an async generator
    async function* fakeStream() {
      yield "Hello";
      yield " world";
      yield "!";
    }
    vi.mocked(streamChat).mockReturnValue(fakeStream() as AsyncGenerator<string>);

    const result = await devinChat({
      model: "swe-1-7",
      messages: [{ role: "user", content: "Say hello" }],
    });
    expect(result).toBe("Hello world!");
  });

  it("includes system prompt in the history", async () => {
    mockCredsExist();
    async function* fakeStream() {
      yield "response";
    }
    vi.mocked(streamChat).mockReturnValue(fakeStream() as AsyncGenerator<string>);

    await devinChat({
      model: "claude-sonnet-4",
      system: "You are a helpful assistant",
      messages: [{ role: "user", content: "test" }],
    });

    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        modelUid: "claude-sonnet-4",
        messages: expect.arrayContaining([
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: "test" },
        ]),
      }),
    );
  });

  it("throws on empty response from stream", async () => {
    mockCredsExist();
    async function* emptyStream() {
      // yields nothing
    }
    vi.mocked(streamChat).mockReturnValue(emptyStream() as AsyncGenerator<string>);

    await expect(
      devinChat({ model: "swe-1-7", messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("empty response");
  });

  it("throws on whitespace-only response", async () => {
    mockCredsExist();
    async function* whitespaceStream() {
      yield "   ";
      yield "\n";
    }
    vi.mocked(streamChat).mockReturnValue(whitespaceStream() as AsyncGenerator<string>);

    await expect(
      devinChat({ model: "swe-1-7", messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("empty response");
  });
});

// ─── DEVIN_FALLBACK_MODELS ──────────────────────────────────────────────────

describe("DEVIN_FALLBACK_MODELS", () => {
  it("exports a non-empty array of fallback models", () => {
    expect(DEVIN_FALLBACK_MODELS.length).toBeGreaterThan(0);
    for (const model of DEVIN_FALLBACK_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
    }
  });
});
