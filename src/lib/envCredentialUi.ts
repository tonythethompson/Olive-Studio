/**
 * Helpers for Assistant Settings: map GET /api/ai/provider credential status
 * into UI labels and Save-gate decisions (never expose secret values).
 */

export type EnvCredentialStatus = {
  present: boolean;
  envVar: string | null;
  usable: boolean;
};

export type ProviderStatusSource = "env" | "runtime" | "saved" | "none";

export type ProviderStatus = {
  source: ProviderStatusSource;
  provider?: string;
  model?: string;
  baseUrl?: string | null;
  envCredentials?: Record<string, EnvCredentialStatus>;
};

/**
 * Looks up env credential status for a provider id (no secret values).
 */
export function providerEnvCredential(
  envCredentials: Record<string, EnvCredentialStatus> | undefined,
  providerId: string | undefined,
): EnvCredentialStatus | undefined {
  if (!envCredentials || !providerId) return undefined;
  return envCredentials[providerId];
}

/**
 * Whether Save may activate this provider without a pasted API key.
 * Local openai-compat / localhost empty-key paths are handled separately.
 */
export function canActivateWithEnvKey(
  envCredentials: Record<string, EnvCredentialStatus> | undefined,
  providerId: string | undefined,
): boolean {
  return Boolean(providerEnvCredential(envCredentials, providerId)?.usable);
}

/**
 * Human-readable Active Provider source line (never includes key material).
 */
export function activeProviderSourceLabel(status: ProviderStatus): string {
  const cred = providerEnvCredential(status.envCredentials, status.provider);
  const envName = cred?.envVar;

  switch (status.source) {
    case "env":
      return envName ? `env (${envName})` : "env";
    case "saved":
      return envName && cred?.usable ? `saved · env (${envName})` : "saved preference";
    case "runtime":
      return "session";
    case "none":
      return "";
    default: {
      const _exhaustive: never = status.source;
      return _exhaustive;
    }
  }
}

/** Clear removes runtime override / saved preference — not pure auto-detect. */
export function canClearActiveProvider(source: ProviderStatusSource): boolean {
  return source === "runtime" || source === "saved";
}
