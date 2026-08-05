/**
 * Persist Cloudflare Workers AI credentials under project `.olive-studio/`.
 * Tokens come from Wrangler OAuth (`wrangler login`) or a dashboard API token.
 */

import fs from "node:fs";
import path from "node:path";

export type CloudflareCredentials = {
  apiToken: string;
  accountId: string;
  accountName?: string;
  email?: string;
  authType?: "oauth" | "api_token" | "api_key" | "env" | "manual";
  issuedAt: string;
};

const CRED_PATH = path.join(process.cwd(), ".olive-studio", "cloudflare-credentials.json");

const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/i;

/**
 * Determines whether a value is a valid Cloudflare account ID.
 *
 * @param accountId - The account ID to validate
 * @returns `true` if the trimmed account ID contains 32 hexadecimal characters, `false` otherwise.
 */
export function isValidCloudflareAccountId(accountId: string): boolean {
  return ACCOUNT_ID_RE.test(accountId.trim());
}

/**
 * Builds the Cloudflare Workers AI API base URL for an account.
 *
 * @param accountId - The 32-character hexadecimal Cloudflare account ID
 * @returns The Cloudflare Workers AI API base URL
 * @throws If `accountId` is not a valid 32-character hexadecimal account ID
 */
export function cloudflareAiBaseUrl(accountId: string): string {
  const id = accountId.trim();
  if (!isValidCloudflareAccountId(id)) {
    throw new Error("Invalid Cloudflare account ID (expected 32 hex characters).");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`;
}

/**
 * Loads and validates stored Cloudflare credentials.
 *
 * @returns The stored credentials, or `null` if the credentials file is missing, malformed, incomplete, or invalid.
 */
export function loadCloudflareCredentials(): CloudflareCredentials | null {
  try {
    if (!fs.existsSync(CRED_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CRED_PATH, "utf-8")) as CloudflareCredentials;
    if (!raw?.apiToken?.trim() || !raw?.accountId?.trim()) return null;
    if (!isValidCloudflareAccountId(raw.accountId)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Persists Cloudflare credentials for later use.
 *
 * @param input - Credential values to save, with an optional issuance timestamp
 * @returns The normalized credentials written to storage
 * @throws If the API token is empty or the account ID is invalid
 */
export function saveCloudflareCredentials(
  input: Omit<CloudflareCredentials, "issuedAt"> & { issuedAt?: string },
): CloudflareCredentials {
  if (!input.apiToken.trim()) throw new Error("Missing Cloudflare API token.");
  if (!isValidCloudflareAccountId(input.accountId)) {
    throw new Error("Invalid Cloudflare account ID (expected 32 hex characters).");
  }
  const dir = path.dirname(CRED_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const payload: CloudflareCredentials = {
    apiToken: input.apiToken.trim(),
    accountId: input.accountId.trim(),
    ...(input.accountName ? { accountName: input.accountName } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.authType ? { authType: input.authType } : {}),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(CRED_PATH, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(CRED_PATH, 0o600);
  } catch {
    /* ignore on platforms without chmod support */
  }
  return payload;
}

/**
 * Removes the stored Cloudflare credentials file when present.
 */
export function clearCloudflareCredentials(): void {
  try {
    if (fs.existsSync(CRED_PATH)) fs.unlinkSync(CRED_PATH);
  } catch {
    /* ignore */
  }
}

/**
 * Gets the path to the stored Cloudflare credentials file.
 *
 * @returns The credentials file path
 */
export function getCloudflareCredPath(): string {
  return CRED_PATH;
}
