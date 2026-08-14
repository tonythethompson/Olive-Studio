/**
 * Parse / normalize Assistant Audit JSON. Unlike chat (which can fall back to
 * free text), audit needs a score + suggestions shape — but we still degrade
 * gracefully when small models emit truncated or broken JSON.
 */

import { parseJsonFromAiResponse, scanJsonStringEnd, softRepairJson } from "./aiResponse.ts";

export type AuditSuggestion = {
  title: string;
  description: string;
  impact: "High" | "Medium" | "Low";
  type: "warning" | "success" | "suggestion" | "info";
  autofix: { pass: string; value: string };
};

export type AuditAnalysis = {
  score: number;
  level: "Optimized" | "Suboptimal" | "Critical";
  summary: string;
  suggestions: AuditSuggestion[];
};

/**
 * Determines whether a value is a non-null object with string keys.
 *
 * @param v - The value to check
 * @returns `true` if the value is a record, `false` otherwise.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalizes an input value to an integer score between 0 and 100.
 *
 * @param n - The value to convert into a score
 * @returns The rounded score clamped between 0 and 100, or `50` for invalid values
 */
function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Determines the audit level from a valid level value or a numeric score.
 *
 * @param raw - The candidate audit level
 * @param score - The score used to derive a level when `raw` is invalid
 * @returns The normalized audit level
 */
function normalizeLevel(raw: unknown, score: number): AuditAnalysis["level"] {
  if (raw === "Optimized" || raw === "Suboptimal" || raw === "Critical") return raw;
  if (score >= 80) return "Optimized";
  if (score >= 45) return "Suboptimal";
  return "Critical";
}

/**
 * Normalizes an audit suggestion's impact level.
 *
 * @param raw - The value to validate as an impact level
 * @returns The validated impact level, or `"Medium"` when the value is invalid
 */
function normalizeImpact(raw: unknown): AuditSuggestion["impact"] {
  if (raw === "High" || raw === "Medium" || raw === "Low") return raw;
  return "Medium";
}

/**
 * Normalizes a suggestion type to a supported value.
 *
 * @param raw - The value to normalize
 * @returns The input type when supported; otherwise, `"suggestion"`
 */
function normalizeType(raw: unknown): AuditSuggestion["type"] {
  if (raw === "warning" || raw === "success" || raw === "suggestion" || raw === "info") return raw;
  return "suggestion";
}

/**
 * Counts the non-empty whitespace-separated words in a string.
 *
 * @param s - The string to count
 * @returns The number of words in `s`
 */
function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Expands terse audit suggestion text into readable title and description copy.
 *
 * @param title - The original suggestion title
 * @param description - The original suggestion description
 * @param autofix - The autofix field and value used to provide additional context
 * @returns The expanded title and description, truncated to their maximum lengths
 */
export function expandTerseSuggestion(
  title: string,
  description: string,
  autofix: { pass: string; value: string },
): { title: string; description: string } {
  const titleWords = wordCount(title);
  const descWords = wordCount(description);
  const looksLikeFieldName = /^[a-z][a-zA-Z0-9_]*$/.test(title.trim());
  let nextTitle = title;
  let nextDesc = description;

  if (looksLikeFieldName || titleWords <= 2) {
    const valueBit = autofix.value ? ` to ${autofix.value}` : "";
    nextTitle = `Update ${autofix.pass}${valueBit}`;
  }

  if (descWords <= 4) {
    const detail = description && description !== title ? ` Current note: ${description}.` : "";
    nextDesc = `Consider setting ${autofix.pass}${
      autofix.value ? ` to ${autofix.value}` : ""
    } for a better Olive / ORT fit.${detail}`;
  }

  return { title: nextTitle.slice(0, 120), description: nextDesc.slice(0, 600) };
}

/**
 * Normalizes a raw audit suggestion into a structured suggestion.
 *
 * @param raw - The unvalidated suggestion data
 * @param index - The suggestion's position, used for fallback titles
 * @returns The normalized suggestion, or `null` when required autofix data is missing or the input is invalid
 */
function normalizeSuggestion(raw: unknown, index: number): AuditSuggestion | null {
  if (!isRecord(raw)) return null;
  const rawTitle =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim().slice(0, 120)
      : `Suggestion ${index + 1}`;
  const rawDescription =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 600)
      : rawTitle;
  const autofixRaw = isRecord(raw.autofix) ? raw.autofix : {};
  const pass =
    typeof autofixRaw.pass === "string" && autofixRaw.pass.trim() ? autofixRaw.pass.trim().slice(0, 64) : "";
  const value =
    typeof autofixRaw.value === "string" || typeof autofixRaw.value === "number"
      ? String(autofixRaw.value).slice(0, 128)
      : "";
  if (!pass || !value) return null;
  const expanded = expandTerseSuggestion(rawTitle, rawDescription, { pass, value });
  return {
    title: expanded.title,
    description: expanded.description,
    impact: normalizeImpact(raw.impact),
    type: normalizeType(raw.type),
    autofix: { pass, value },
  };
}

/**
 * Normalizes parsed audit data into a structured analysis result.
 *
 * @param parsed - The value to validate and normalize as audit analysis data
 * @returns A normalized audit analysis, or `null` when the input is not an object
 */
export function normalizeAuditAnalysis(parsed: unknown): AuditAnalysis | null {
  if (!isRecord(parsed)) return null;
  const hasScore =
    "score" in parsed && (typeof parsed.score === "number" || typeof parsed.score === "string");
  const hasLevel =
    parsed.level === "Optimized" || parsed.level === "Suboptimal" || parsed.level === "Critical";
  const hasSummary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0;
  const hasSuggestions = Array.isArray(parsed.suggestions);
  // Reject arbitrary JSON that merely parses (e.g. wrangler whoami) as an audit.
  if (!hasScore && !hasLevel && !hasSummary && !hasSuggestions) return null;

  const score = clampScore(parsed.score);
  const summary = hasSummary
    ? (parsed.summary as string).trim().slice(0, 1200)
    : "Pipeline analysis complete.";
  const suggestionsRaw = hasSuggestions ? (parsed.suggestions as unknown[]) : [];
  const suggestions: AuditSuggestion[] = [];
  for (let i = 0; i < suggestionsRaw.length && suggestions.length < 3; i++) {
    const row = normalizeSuggestion(suggestionsRaw[i], i);
    if (row) suggestions.push(row);
  }
  return {
    score,
    level: normalizeLevel(parsed.level, score),
    summary,
    suggestions,
  };
}

/**
 * Close truncated LLM JSON: finish an open string, then close open braces/brackets.
 * Helps when the model hits max tokens mid-object (Unterminated string…).
 */
export function closeTruncatedJson(text: string): string {
  let s = softRepairJson(text.trim());
  let unterminatedString = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') {
      const end = scanJsonStringEnd(s, i + 1);
      if (end < 0) {
        unterminatedString = true;
        break;
      }
      i = end;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  if (unterminatedString) s += '"';
  // Drop a dangling trailing comma before we close.
  s = s.replace(/,\s*$/, "");
  while (stack.length > 0) s += stack.pop();
  return softRepairJson(s);
}

/**
 * Creates a default suboptimal audit analysis from unstructured model output.
 *
 * @param rawText - The model response to include in the audit summary
 * @returns An audit analysis with a score of 50, no suggestions, and a fallback summary
 */
function fallbackFromText(rawText: string): AuditAnalysis & { structured: false } {
  const trimmed = rawText.trim().replace(/\s+/g, " ").slice(0, 800);
  return {
    score: 50,
    level: "Suboptimal",
    summary: trimmed
      ? `Partial audit (model returned unstructured text): ${trimmed}`
      : "Could not parse a structured audit. Try Analyze again or pick a larger model in Settings.",
    suggestions: [],
    structured: false,
  };
}

/** Chat-style graceful parse for Audit: never throws for malformed model JSON. */
export function parseAuditAnalysisReply(rawText: string): AuditAnalysis & { structured: boolean } {
  // closeTruncatedJson once up front; do not re-close an already-repaired attempt.
  const attempts = [rawText, closeTruncatedJson(rawText)];
  for (const attempt of attempts) {
    try {
      const parsed = parseJsonFromAiResponse(attempt);
      const normalized = normalizeAuditAnalysis(parsed);
      if (normalized) return { ...normalized, structured: true };
    } catch {
      /* try next */
    }
    try {
      const normalized = normalizeAuditAnalysis(JSON.parse(attempt));
      if (normalized) return { ...normalized, structured: true };
    } catch {
      /* try next */
    }
  }
  return fallbackFromText(rawText);
}
