/** Extract JSON from LLM responses that may include markdown fences or preamble text. */
export function parseJsonFromAiResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const attempts = [candidate, extractBalancedJson(candidate), softRepairJson(candidate)].filter(
    (s): s is string => Boolean(s && s.trim()),
  );

  let lastErr: Error | undefined;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const repaired = softRepairJson(attempt);
      if (repaired && repaired !== attempt) {
        try {
          return JSON.parse(repaired);
        } catch (err2) {
          lastErr = err2 instanceof Error ? err2 : new Error(String(err2));
        }
      }
    }
  }

  const detail = lastErr?.message ? ` (${lastErr.message})` : "";
  throw new Error(
    `AI response was not valid JSON${detail}. Try Analyze again, or switch to a stronger model in Settings.`,
  );
}

/** First balanced `{…}` or `[…]` slice, respecting simple string escapes. */
function extractBalancedJson(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
    open = "{";
    close = "}";
  } else if (startArr >= 0) {
    start = startArr;
    open = "[";
    close = "]";
  } else {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * Light repairs for common LLM JSON mistakes (trailing commas, missing commas
 * between objects/arrays). Not a full JSON5 parser.
 */
export function softRepairJson(text: string): string {
  let s = text.trim();
  // Strip // and /* */ comments outside strings (best-effort, line-oriented).
  s = s.replace(/^\s*\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, "$1");
  // Missing commas between } {, ] [, } [, ] {
  s = s.replace(/\}\s*\{/g, "},{");
  s = s.replace(/\]\s*\[/g, "],[");
  s = s.replace(/\}\s*\[/g, "},[");
  s = s.replace(/\]\s*\{/g, "],{");
  // Missing commas between "…" and "…" when they look like adjacent string values
  // (array elements or object values). Avoid touching inside already-valid JSON
  // by only fixing newline/whitespace separated pairs without a comma.
  s = s.replace(/"\s*\n\s*"/g, '",\n"');
  return s;
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

/** Which env var name supplied a non-placeholder key (never returns the secret). */
export function matchedEnvApiKeyName(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) {
      return name;
    }
  }
  return undefined;
}
