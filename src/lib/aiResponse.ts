/**
 * Parses JSON content from an AI response that may include Markdown fences or surrounding text.
 *
 * @param text - The AI response containing JSON content
 * @returns The parsed JSON value
 * @throws Error if the response is empty or does not contain valid JSON
 */
export function parseJsonFromAiResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const balancedCandidates = collectBalancedJsonCandidates(candidate);
  const attempts = [candidate, ...balancedCandidates, softRepairJson(candidate)].filter((s): s is string =>
    Boolean(s && s.trim()),
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

/**
 * Extracts the first balanced JSON object or array from the text.
 *
 * @param text - The text to search
 * @param startAt - The position at which to begin searching
 * @returns The balanced JSON slice, the remaining text when the slice is unclosed, or `null` if no object or array begins at or after `startAt`
 */
function extractBalancedJson(text: string, startAt = 0): string | null {
  const startObj = text.indexOf("{", startAt);
  const startArr = text.indexOf("[", startAt);
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

/** Collect balanced JSON slices from each `{` / `[` root (prose may precede valid JSON). */
function collectBalancedJsonCandidates(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const slice = extractBalancedJson(text, i);
    if (!slice || seen.has(slice)) continue;
    seen.add(slice);
    out.push(slice);
  }
  return out;
}

/**
 * Applies best-effort repairs for common formatting errors in JSON-like text.
 *
 * @param text - The JSON-like text to repair
 * @returns The repaired text
 */
export function softRepairJson(text: string): string {
  let s = text.trim();
  // Strip // and /* */ comments with a regex (best-effort; not string-aware, so
  // comment-like text inside JSON string values can be altered).
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

/**
 * Determines whether an environment value is empty or appears to be a placeholder.
 *
 * @param value - The environment value to inspect
 * @returns `true` if the value is empty or matches a recognized placeholder pattern, `false` otherwise
 */
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

/**
 * Finds the first configured environment variable containing a usable API key.
 *
 * @param names - Environment variable names to check in priority order
 * @returns The first trimmed, non-placeholder API key, or `undefined` if none is usable
 */
export function readEnvApiKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Identifies the first environment variable containing a usable API key.
 *
 * @param names - Environment variable names to check in priority order
 * @returns The name of the first environment variable with a non-placeholder value, or `undefined` if none qualifies
 */
export function matchedEnvApiKeyName(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) {
      return name;
    }
  }
  return undefined;
}
