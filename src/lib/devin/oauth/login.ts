/**
 * Browser-based Devin subscription sign-in (Auth0 / Firebase token paste).
 *
 * Flow:
 *  1. Open sign-in URL (user signs in with their Devin account).
 *  2. Sign-in page shows an auth token (show-auth-token redirect).
 *  3. User pastes token into Olive Studio.
 *  4. We exchange it via RegisterUser for a long-lived API key.
 *
 * Adapted from pi-devin-auth (MIT).
 */

import * as crypto from "node:crypto";
import { registerUser } from "./register-user.ts";
import { DEFAULT_REGION, type OAuthLoginResult, type DevinRegion } from "./types.ts";

export function buildDevinSignInUrl(region: DevinRegion = DEFAULT_REGION): string {
  const params = new URLSearchParams({
    response_type: "token",
    client_id: region.oauthClientId,
    redirect_uri: "show-auth-token",
    state: crypto.randomUUID(),
    prompt: "login",
  });
  return `${region.website}/windsurf/signin?${params.toString()}`;
}

/**
 * Complete login after the user pastes the token shown on the sign-in page.
 * That pasted value is the Firebase ID token from the OAuth fragment.
 */
export async function completeDevinLogin(
  firebaseIdToken: string,
  region: DevinRegion = DEFAULT_REGION,
): Promise<OAuthLoginResult> {
  const token = firebaseIdToken.trim();
  if (!token) {
    throw new Error("Empty auth token. Paste the token shown after signing in.");
  }
  return registerUser(token, region);
}
