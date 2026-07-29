import type { OliveJob } from "../../types.ts";

/** Central job registry — all active Olive jobs. */
export const jobRegistry = new Map<string, OliveJob>();

/** In-memory HF token (never written to disk or logged). */
let runtimeHfToken: string | null = null;

export function getRuntimeHfToken(): string | null {
  return runtimeHfToken;
}

export function setRuntimeHfToken(token: string | null): void {
  runtimeHfToken = token;
}
