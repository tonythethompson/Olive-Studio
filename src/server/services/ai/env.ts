/** Server-only environment credential helpers. */

function isPlaceholderEnvValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith("my_") ||
    normalized.includes("your_") ||
    normalized.includes("xxx") ||
    normalized === "changeme" ||
    normalized === "replace_me" ||
    normalized.endsWith("_here") ||
    normalized === "sk-..." ||
    normalized === "insert_key_here"
  );
}

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
