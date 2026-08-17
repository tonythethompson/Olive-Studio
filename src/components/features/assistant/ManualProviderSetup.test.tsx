import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManualProviderSetup } from "./ManualProviderSetup";

// Mock sub-components to avoid deep import chains in jsdom
vi.mock("./CodexAccountPanel", () => ({ CodexAccountPanel: () => null }));
vi.mock("./DevinAccountPanel", () => ({ DevinAccountPanel: () => null }));
vi.mock("./GenaiEnginePanel", () => ({ GenaiEnginePanel: () => null }));
vi.mock("./ModelCombobox", () => ({ ModelCombobox: () => null }));

/**
 * Creates a minimal mock `AiProviderSettings` object suitable for rendering
 * ManualProviderSetup. Override individual fields per test case.
 */
function createMockProviders(overrides: Record<string, unknown> = {}) {
  return {
    settingsProvider: "cloudflare",
    settingsModel: "@cf/meta/llama-3.1-8b-instruct",
    settingsApiKey: "",
    settingsBaseUrl: "",
    settingsCloudflareAccountId: "",
    customModel: "",
    isSavingProvider: false,
    isCompatMode: false,
    providerOption: {
      id: "cloudflare",
      name: "Cloudflare Workers AI",
      category: "subscription",
      keyEnvVar: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
      models: ["@cf/meta/llama-3.1-8b-instruct"],
      docsUrl: "developers.cloudflare.com/workers-ai",
    },
    providerStatus: { source: "none", envCredentials: {} },
    providerSaveError: "",
    displayedModels: [{ id: "@cf/meta/llama-3.1-8b-instruct", label: "@cf/meta/llama-3.1-8b-instruct" }],
    modelsLoading: false,
    modelsSource: null,
    modelsHint: null,
    selectProvider: vi.fn(),
    setSettingsModel: vi.fn(),
    setSettingsApiKey: vi.fn(),
    setSettingsBaseUrl: vi.fn(),
    setSettingsCloudflareAccountId: vi.fn(),
    setCustomModel: vi.fn(),
    saveProvider: vi.fn(),
    refreshModels: vi.fn(),
    refreshModelsForTypedApiKey: vi.fn(),
    refreshModelsForTypedBaseUrl: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ManualProviderSetup — Cloudflare badge rendering", () => {
  it("shows green badges on both fields when envUsable is true and fields are empty", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "env",
        envCredentials: {
          cloudflare: {
            present: true,
            envVar: "CLOUDFLARE_API_TOKEN",
            usable: true,
            cloudflareAccountId: { present: true, valid: true },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // API Key field green badge
    const apiKeyBadges = screen.getAllByText("Env available: CLOUDFLARE_API_TOKEN");
    expect(apiKeyBadges.length).toBeGreaterThanOrEqual(1);

    // Account ID field green badge
    const accountIdBadges = screen.getAllByText("Env available: CLOUDFLARE_ACCOUNT_ID");
    expect(accountIdBadges.length).toBeGreaterThanOrEqual(1);

    // Account ID placeholder should say "Leave blank..."
    const accountIdInput = screen.getByLabelText(/Cloudflare Account ID/i);
    expect(accountIdInput.getAttribute("placeholder")).toBe("Leave blank to use CLOUDFLARE_ACCOUNT_ID");
  });

  it("shows amber badge on API Key with 'CLOUDFLARE_ACCOUNT_ID missing or invalid' when token present but account ID missing", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "none",
        envCredentials: {
          cloudflare: {
            present: true,
            envVar: "CLOUDFLARE_API_TOKEN",
            usable: false,
            cloudflareAccountId: { present: false, valid: false },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // Amber badge explains what's missing
    expect(
      screen.getByText(/Found CLOUDFLARE_API_TOKEN \(incomplete/)
    ).toBeDefined();
    expect(
      screen.getByText(/CLOUDFLARE_ACCOUNT_ID missing or invalid/)
    ).toBeDefined();
  });

  it("shows amber badge on Account ID field when account ID present but invalid format", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "none",
        envCredentials: {
          cloudflare: {
            present: true,
            envVar: "CLOUDFLARE_API_TOKEN",
            usable: false,
            cloudflareAccountId: { present: true, valid: false },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // Amber badge for invalid format on Account ID
    expect(
      screen.getByText(/Found CLOUDFLARE_ACCOUNT_ID \(invalid format\)/)
    ).toBeDefined();
  });

  it("suppresses amber invalid-format Account ID badge when user types a manual Account ID", () => {
    const providers = createMockProviders({
      settingsCloudflareAccountId: "manual-account-id-123",
      providerStatus: {
        source: "none",
        envCredentials: {
          cloudflare: {
            present: true,
            envVar: "CLOUDFLARE_API_TOKEN",
            usable: false,
            cloudflareAccountId: { present: true, valid: false },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // User override suppresses the invalid-format warning on the Account ID field
    expect(screen.queryByText(/Found CLOUDFLARE_ACCOUNT_ID \(invalid format\)/)).toBeNull();

    // Placeholder stays on the manual default when a value is typed
    const accountIdInput = screen.getByLabelText(/Cloudflare Account ID/i);
    expect(accountIdInput.getAttribute("placeholder")).toBe("32-char hex CLOUDFLARE_ACCOUNT_ID");
  });

  it("shows green badge on Account ID when it is valid in env but token is missing", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "none",
        envCredentials: {
          cloudflare: {
            present: false,
            envVar: null,
            usable: false,
            cloudflareAccountId: { present: true, valid: true },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // Account ID shows green badge even when overall not usable
    const accountIdBadges = screen.getAllByText("Env available: CLOUDFLARE_ACCOUNT_ID");
    expect(accountIdBadges.length).toBeGreaterThanOrEqual(1);

    // API Key should NOT show a green badge (no envVar present)
    expect(screen.queryByText("Env available: CLOUDFLARE_API_TOKEN")).toBeNull();
  });

  it("shows no cloudflareAccountId badges for non-Cloudflare provider", () => {
    const providers = createMockProviders({
      settingsProvider: "openai",
      providerOption: {
        id: "openai",
        name: "OpenAI",
        category: "direct",
        keyEnvVar: "OPENAI_API_KEY",
        models: ["gpt-4o"],
        docsUrl: "platform.openai.com/api-keys",
      },
      providerStatus: {
        source: "none",
        envCredentials: {
          openai: {
            present: true,
            envVar: "OPENAI_API_KEY",
            usable: true,
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // No Cloudflare-specific badge text should appear
    expect(screen.queryByText(/CLOUDFLARE_ACCOUNT_ID/)).toBeNull();
    // No Account ID field at all (only rendered for cloudflare)
    expect(screen.queryByLabelText(/Cloudflare Account ID/i)).toBeNull();
  });

  it("shows no env badges when no env vars are set at all", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "none",
        envCredentials: {
          cloudflare: {
            present: false,
            envVar: null,
            usable: false,
            cloudflareAccountId: { present: false, valid: false },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // No green or amber badges
    expect(screen.queryByText(/Env available/)).toBeNull();
    expect(screen.queryByText(/incomplete/)).toBeNull();
    expect(screen.queryByText(/invalid format/)).toBeNull();

    // Account ID placeholder is the default
    const accountIdInput = screen.getByLabelText(/Cloudflare Account ID/i);
    expect(accountIdInput.getAttribute("placeholder")).toBe("32-char hex CLOUDFLARE_ACCOUNT_ID");
  });

  it("hides green Account ID badge when user types into the field (override suppression)", () => {
    const providers = createMockProviders({
      settingsCloudflareAccountId: "abcdef0123456789abcdef0123456789",
      providerStatus: {
        source: "env",
        envCredentials: {
          cloudflare: {
            present: true,
            envVar: "CLOUDFLARE_API_TOKEN",
            usable: true,
            cloudflareAccountId: { present: true, valid: true },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // Green badge on Account ID should NOT appear when user has typed a value
    expect(screen.queryByText("Env available: CLOUDFLARE_ACCOUNT_ID")).toBeNull();
    // Placeholder should switch to "Leave blank..." since env is usable and field clearing would activate it
    const accountIdInput = screen.getByLabelText(/Cloudflare Account ID/i);
    expect(accountIdInput.getAttribute("placeholder")).toBe("32-char hex CLOUDFLARE_ACCOUNT_ID");
  });

  it("shows 'Leave blank' placeholder under Wrangler file auth (usable but no envVar)", () => {
    const providers = createMockProviders({
      providerStatus: {
        source: "env",
        envCredentials: {
          cloudflare: {
            present: false,
            envVar: null,
            usable: true,
            cloudflareAccountId: { present: true, valid: true },
          },
        },
      },
    });

    render(<ManualProviderSetup providers={providers} />);

    // envCred.usable is true (Wrangler auth), so placeholder should say "Leave blank..."
    const accountIdInput = screen.getByLabelText(/Cloudflare Account ID/i);
    expect(accountIdInput.getAttribute("placeholder")).toBe("Leave blank to use CLOUDFLARE_ACCOUNT_ID");
  });
});
