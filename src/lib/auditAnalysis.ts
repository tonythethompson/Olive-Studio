/**
 * Parse / normalize Assistant Audit JSON. Unlike chat (which can fall back to
 * free text), audit needs a score + suggestions shape — but we still degrade
 * gracefully when small models emit truncated or broken JSON.
 */

import { parseJsonFromAiResponse, softRepairJson } from "./aiResponse.ts";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeLevel(raw: unknown, score: number): AuditAnalysis["level"] {
  if (raw === "Optimized" || raw === "Suboptimal" || raw === "Critical") return raw;
  if (score >= 80) return "Optimized";
  if (score >= 45) return "Suboptimal";
  return "Critical";
}

function normalizeImpact(raw: unknown): AuditSuggestion["impact"] {
  if (raw === "High" || raw === "Medium" || raw === "Low") return raw;
  return "Medium";
}

function normalizeType(raw: unknown): AuditSuggestion["type"] {
  if (raw === "warning" || raw === "success" || raw === "suggestion" || raw === "info") return raw;
  return "suggestion";
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Expand telegram-style titles/descriptions into readable copy when the model is too terse. */
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

export function normalizeAuditAnalysis(parsed: unknown): AuditAnalysis | null {
  if (!isRecord(parsed)) return null;
  const score = clampScore(parsed.score);
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 1200)
      : "Pipeline analysis complete.";
  const suggestionsRaw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
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
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
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
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  if (inString) s += '"';
  // Drop a dangling trailing comma before we close.
  s = s.replace(/,\s*$/, "");
  while (stack.length > 0) s += stack.pop();
  return softRepairJson(s);
}

function fallbackFromText(rawText: string): AuditAnalysis {
  const trimmed = rawText.trim().replace(/\s+/g, " ").slice(0, 800);
  return {
    score: 50,
    level: "Suboptimal",
    summary: trimmed
      ? `Partial audit (model returned unstructured text): ${trimmed}`
      : "Could not parse a structured audit. Try Analyze again or pick a larger model in Settings.",
    suggestions: [],
  };
}

/** Chat-style graceful parse for Audit: never throws for malformed model JSON. */
export function parseAuditAnalysisReply(rawText: string): AuditAnalysis {
  const attempts = [rawText, closeTruncatedJson(rawText)];
  for (const attempt of attempts) {
    try {
      const parsed = parseJsonFromAiResponse(attempt);
      const normalized = normalizeAuditAnalysis(parsed);
      if (normalized) return normalized;
    } catch {
      /* try next */
    }
    try {
      const closed = closeTruncatedJson(attempt);
      const normalized = normalizeAuditAnalysis(JSON.parse(closed));
      if (normalized) return normalized;
    } catch {
      /* try next */
    }
  }
  return fallbackFromText(rawText);
}
