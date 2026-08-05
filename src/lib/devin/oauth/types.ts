/**
 * Shared types for Devin subscription OAuth + credentials.
 *
 * Devin is a multi-model subscription for Assistant audit/chat via Cognition's
 * chat backend (historical hostnames may still say windsurf/codeium).
 */

export interface OAuthLoginResult {
  /** Opaque API key used as Metadata.api_key in every chat RPC. */
  apiKey: string;
  /** Human-readable account name. */
  name: string;
  /**
   * Cloud API server (often https://server.codeium.com).
   * Driven by the user's tenant.
   */
  apiServerUrl: string;
  /** Optional cleanup redirect URL from RegisterUser. */
  redirectUrl?: string;
}

export interface PersistedDevinCredentials extends OAuthLoginResult {
  /** ISO timestamp when credentials were stored. */
  issuedAt: string;
  oauthClientId: string;
}

export interface DevinRegion {
  website: string;
  registerApiServerUrl: string;
  oauthClientId: string;
}

/**
 * Default tenant configuration for browser sign-in + RegisterUser.
 * Hostnames are infrastructure endpoints; product branding is Devin.
 */
export const DEFAULT_REGION: DevinRegion = {
  website: "https://windsurf.com",
  registerApiServerUrl: "https://register.windsurf.com",
  // Public Auth0 client id used by the official client sign-in SPA
  oauthClientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
};
