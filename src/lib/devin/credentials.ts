/**
 * Persist Devin subscription credentials under project `.olive-studio/`.
 */

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_REGION, type PersistedDevinCredentials } from "./oauth/types.ts";
import { clearCachedUserJwt } from "./cloud-direct/auth.ts";
import { clearSessionIds } from "./cloud-direct/chat.ts";
import { clearCachedCatalog } from "./cloud-direct/catalog.ts";

const CRED_PATH = path.join(process.cwd(), ".olive-studio", "devin-credentials.json");

export function loadDevinCredentials(): PersistedDevinCredentials | null {
  try {
    if (!fs.existsSync(CRED_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CRED_PATH, "utf-8")) as PersistedDevinCredentials;
    if (!raw?.apiKey) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveDevinCredentials(result: {
  apiKey: string;
  name: string;
  apiServerUrl: string;
  redirectUrl?: string;
}): PersistedDevinCredentials {
  const dir = path.dirname(CRED_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const payload: PersistedDevinCredentials = {
    ...result,
    issuedAt: new Date().toISOString(),
    oauthClientId: DEFAULT_REGION.oauthClientId,
  };
  fs.writeFileSync(CRED_PATH, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  clearCachedUserJwt();
  clearSessionIds();
  clearCachedCatalog();
  return payload;
}

export function clearDevinCredentials(): void {
  try {
    if (fs.existsSync(CRED_PATH)) fs.unlinkSync(CRED_PATH);
  } catch {
    /* ignore */
  }
  clearCachedUserJwt();
  clearSessionIds();
  clearCachedCatalog();
}

export function getDevinCredPath(): string {
  return CRED_PATH;
}
