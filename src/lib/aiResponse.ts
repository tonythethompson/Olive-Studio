/**
 * Parses JSON content from an AI response that may include Markdown fences or surrounding text.
 *
 * @param text - The AI response containing JSON content
 * @returns The parsed JSON value
 * @throws Error if the response is empty or does not contain valid JSON
 */
/** Extract fenced code blocks from text, classifying by language tag. */
function extractFencedBlocks(
  text: string,
): { jsonBlocks: string[]; otherBlocks: string[] } {
  const jsonBlocks: string[] = [];
  const otherBlocks: string[] = [];
  const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = (match[1] ?? "").toLowerCase();
    const content = match[2]?.trim();
    if (!content) continue;
    if (lang === "json" || lang === "jsonc" || lang === "json5") {
      jsonBlocks.push(content);
    } else {
      otherBlocks.push(content);
    }
  }
  return { jsonBlocks, otherBlocks };
}

/** Build a prioritized, de-duplicated candidate list for JSON parsing. */
function buildCandidateList(
  trimmed: string,
  jsonBlocks: string[],
  otherBlocks: string[],
): string[] {
  // Prioritize candidates:
  // 1. Explicit ```json blocks
  // 2. Balanced JSON chunks from overall text
  // 3. Balanced JSON chunks from explicit json blocks
  // 4. Raw trimmed response
  // 5. Other untagged / non-JSON fenced code blocks (fallback)
  const rawCandidates = [
    ...jsonBlocks,
    ...collectBalancedJsonCandidates(trimmed),
    ...jsonBlocks.flatMap((b) => collectBalancedJsonCandidates(b)),
    trimmed,
    ...otherBlocks,
    ...otherBlocks.flatMap((b) => collectBalancedJsonCandidates(b)),
  ];

  // De-duplicate candidates while preserving priority order
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const c of rawCandidates) {
    const s = c.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      candidates.push(s);
    }
  }
  return candidates;
}

/** Attempt to parse a candidate string as JSON, with soft repair fallback. */
function tryParseJson(
  candidate: string,
): { value: unknown } | { error: Error } {
  try {
    return { value: JSON.parse(candidate) };
  } catch (err) {
    const repaired = softRepairJson(candidate);
    if (repaired && repaired !== candidate) {
      try {
        return { value: JSON.parse(repaired) };
      } catch (err2) {
        return { error: err2 instanceof Error ? err2 : new Error(String(err2)) };
      }
    }
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export function parseJsonFromAiResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  const { jsonBlocks: explicitJsonBlocks, otherBlocks: otherFencedBlocks } =
    extractFencedBlocks(trimmed);
  const candidates = buildCandidateList(
    trimmed,
    explicitJsonBlocks,
    otherFencedBlocks,
  );

  let lastErr: Error | undefined;
  for (const candidate of candidates) {
    const result = tryParseJson(candidate);
    if ("value" in result) return result.value;
    lastErr = result.error;
  }

  const detail = lastErr?.message ? ` (${lastErr.message})` : "";
  throw new Error(
    `AI response was not valid JSON${detail}. Try Analyze again, or switch to a stronger model in Settings.`,
  );
}

/**
 * Skips over a JSON string body starting at the character right after the
 * opening quote, handling backslash escapes.
 *
 * @param text - The text containing the JSON string
 * @param from - Index of the first character inside the string (after the opening quote)
 * @returns The index of the closing quote, or `-1` when the string is unterminated
 */
export function scanJsonStringEnd(text: string, from: number): number {
  let escape = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
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
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      const end = scanJsonStringEnd(text, i + 1);
      if (end < 0) break;
      i = end;
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

/** Collect top-level balanced JSON roots only (skip nested braces; cap attempts). */
function collectBalancedJsonCandidates(text: string, maxCandidates = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let from = 0;
  while (from < text.length && out.length < maxCandidates) {
    const slice = extractBalancedJson(text, from);
    if (!slice) break;
    if (!seen.has(slice)) {
      seen.add(slice);
      out.push(slice);
    }
    const startObj = text.indexOf("{", from);
    const startArr = text.indexOf("[", from);
    let start = -1;
    if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj;
    else if (startArr >= 0) start = startArr;
    if (start < 0) break;
    from = start + Math.max(slice.length, 1);
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
  s = s.replace(/}\s*{/g, "},{");
  s = s.replace(/]\s*\[/g, "],[");
  s = s.replace(/}\s*\[/g, "},[");
  s = s.replace(/]\s*{/g, "],{");
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
    const value = import.meta.env[name]?.trim();
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
    const value = import.meta.env[name]?.trim();
    if (value && !isPlaceholderEnvValue(value)) {
      return name;
    }
  }
  return undefined;
}
