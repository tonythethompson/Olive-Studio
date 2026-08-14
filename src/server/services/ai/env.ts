/** Server-only environment credential helpers. */

import { isPlaceholderEnvValue } from "../../../lib/aiResponse.ts";

export function readEnvApiKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) return value;
  }
  return undefined;
}

export function matchedEnvApiKeyName(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) return name;
  }
  return undefined;
}
