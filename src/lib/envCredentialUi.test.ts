import { describe, expect, it } from "vitest";
import {
  activeProviderSourceLabel,
  canActivateWithEnvKey,
  canClearActiveProvider,
  hydratedSettingsBaseUrl,
  providerEnvCredential,
  type ProviderStatus,
} from "./envCredentialUi";

describe("envCredentialUi", () => {
  const envCredentials = {
    opencode: { present: true, envVar: "OPENCODE_API_KEY", usable: true },
    cloudflare: { present: true, envVar: "CLOUDFLARE_API_TOKEN", usable: false },
    anthropic: { present: false, envVar: null, usable: false },
  };

  it("providerEnvCredential looks up by id", () => {
    expect(providerEnvCredential(envCredentials, "opencode")?.envVar).toBe("OPENCODE_API_KEY");
    expect(providerEnvCredential(envCredentials, "missing")).toBeUndefined();
    expect(providerEnvCredential(undefined, "opencode")).toBeUndefined();
  });

  it("canActivateWithEnvKey requires usable", () => {
    expect(canActivateWithEnvKey(envCredentials, "opencode")).toBe(true);
    expect(canActivateWithEnvKey(envCredentials, "cloudflare")).toBe(false);
    expect(canActivateWithEnvKey(envCredentials, "anthropic")).toBe(false);
  });

  it("activeProviderSourceLabel never invents secrets", () => {
    const base: ProviderStatus = {
      source: "env",
      provider: "opencode",
      model: "kimi-k2.7-code",
      envCredentials,
    };
    expect(activeProviderSourceLabel(base)).toBe("env (OPENCODE_API_KEY)");
    expect(activeProviderSourceLabel({ ...base, source: "saved" })).toBe(
      "saved · env (OPENCODE_API_KEY)",
    );
    expect(activeProviderSourceLabel({ ...base, source: "runtime" })).toBe("session");
    expect(activeProviderSourceLabel({ source: "none" })).toBe("");
    expect(
      activeProviderSourceLabel({
        source: "saved",
        provider: "anthropic",
        envCredentials,
      }),
    ).toBe("saved preference");
  });

  it("canClearActiveProvider matches runtime/saved only", () => {
    expect(canClearActiveProvider("runtime")).toBe(true);
    expect(canClearActiveProvider("saved")).toBe(true);
    expect(canClearActiveProvider("env")).toBe(false);
    expect(canClearActiveProvider("none")).toBe(false);
  });

  it("hydratedSettingsBaseUrl retains trimmed URLs and clears null/empty", () => {
    expect(hydratedSettingsBaseUrl(" http://127.0.0.1:1234/v1 ")).toBe("http://127.0.0.1:1234/v1");
    // Regression: a later hydrate with null must clear a previously non-empty URL.
    let base = hydratedSettingsBaseUrl("http://127.0.0.1:1234/v1");
    expect(base).toBe("http://127.0.0.1:1234/v1");
    base = hydratedSettingsBaseUrl(null);
    expect(base).toBe("");
    expect(hydratedSettingsBaseUrl(undefined)).toBe("");
    expect(hydratedSettingsBaseUrl("")).toBe("");
    expect(hydratedSettingsBaseUrl("   ")).toBe("");
  });
});
