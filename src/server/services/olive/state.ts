import type { OliveJob } from "../../types.ts";
import { appConfig } from "../../config.ts";

/** Central job registry — all active Olive jobs. */
export const jobRegistry = new Map<string, OliveJob>();

/** Runtime HF token (backed by appConfig so callers share one source of truth). */
export function getRuntimeHfToken(): string | null {
  return appConfig.hfToken;
}

export function setRuntimeHfToken(token: string | null): void {
  appConfig.hfToken = token;
}
