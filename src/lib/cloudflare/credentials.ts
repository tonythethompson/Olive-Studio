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

export function isValidCloudflareAccountId(accountId: string): boolean {
  return ACCOUNT_ID_RE.test(accountId.trim());
}

export function cloudflareAiBaseUrl(accountId: string): string {
  const id = accountId.trim();
  if (!isValidCloudflareAccountId(id)) {
    throw new Error("Invalid Cloudflare account ID (expected 32 hex characters).");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`;
}

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
  return payload;
}

export function clearCloudflareCredentials(): void {
  try {
    if (fs.existsSync(CRED_PATH)) fs.unlinkSync(CRED_PATH);
  } catch {
    /* ignore */
  }
}

export function getCloudflareCredPath(): string {
  return CRED_PATH;
}
