/** Extract JSON from LLM responses that may include markdown fences or preamble text. */
export function parseJsonFromAiResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

export function isPlaceholderEnvValue(value: string): boolean {
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
    if (value && !isPlaceholderEnvValue(value)) {
      return value;
    }
  }
  return undefined;
}
