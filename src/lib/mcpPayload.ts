/**
 * MCP diagnostic payload parsing and troubleshoot feedback normalization.
 * Pure functions — no React, no fetch, no side effects.
 */
import {
  MCP_TROUBLESHOOT_FEEDBACK_RATINGS,
  MCP_TROUBLESHOOT_FEEDBACK_REASON_CODES,
  type McpDiagnostic,
  type McpDiagnosticFrequency,
  type McpTroubleshootFeedbackArgs,
  type McpTroubleshootFeedbackError,
  type McpTroubleshootFeedbackRating,
  type McpTroubleshootFeedbackReasonCode,
  type McpTroubleshootFeedbackResult,
} from "@/types";

// ─── Internal helpers ──────────────────────────────────────────────────

/** Normalize optional string|null MCP fields; empty string → null. */
function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  return undefined; // invalid type — caller rejects
}

/** Parse optional frequency blob; invalid shapes are dropped (not fatal). */
function parseOptionalFrequency(value: unknown): McpDiagnosticFrequency | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const out: McpDiagnosticFrequency = {};
  if (!assignOptionalFrequencyCount(rec, out)) return undefined;
  if (!assignOptionalFrequencyString(rec, out, "first_seen")) return undefined;
  if (!assignOptionalFrequencyString(rec, out, "last_seen")) return undefined;
  if (!assignOptionalFrequencyString(rec, out, "label")) return undefined;
  return out;
}

function assignOptionalFrequencyCount(
  rec: Record<string, unknown>,
  out: McpDiagnosticFrequency,
): boolean {
  if (rec.occurrence_count === undefined) return true;
  if (typeof rec.occurrence_count !== "number" || !Number.isFinite(rec.occurrence_count)) {
    return false;
  }
  out.occurrence_count = rec.occurrence_count;
  return true;
}

function assignOptionalFrequencyString(
  rec: Record<string, unknown>,
  out: McpDiagnosticFrequency,
  key: "first_seen" | "last_seen" | "label",
): boolean {
  if (rec[key] === undefined) return true;
  if (rec[key] !== null && typeof rec[key] !== "string") return false;
  out[key] = rec[key] as string | null;
  return true;
}

function mcpDiagnosticRequiredFieldsPresent(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.title === "string" &&
    Boolean(payload.title) &&
    typeof payload.root_cause === "string" &&
    Boolean(payload.root_cause) &&
    typeof payload.workaround === "string" &&
    Boolean(payload.workaround)
  );
}

function mcpDiagnosticOptionalsValid(payload: Record<string, unknown>): boolean {
  const optionalUpdated =
    payload.updated_config === undefined ||
    (payload.updated_config !== null &&
      typeof payload.updated_config === "object" &&
      !Array.isArray(payload.updated_config));
  const optionalQuirks =
    payload.relevant_quirks === undefined ||
    (Array.isArray(payload.relevant_quirks) &&
      payload.relevant_quirks.every((q) => typeof q === "string"));
  const optionalDomain =
    payload.domain === undefined ||
    payload.domain === null ||
    payload.domain === "olive" ||
    payload.domain === "studio";
  const optionalApplyable = payload.applyable === undefined || typeof payload.applyable === "boolean";
  const matchedEntry = optionalNullableString(payload.matched_entry);
  const optionalMatched = matchedEntry !== undefined || payload.matched_entry === undefined;
  const relatedEntry = optionalNullableString(payload.related_olive_entry);
  const optionalRelated = relatedEntry !== undefined || payload.related_olive_entry === undefined;
  return (
    optionalUpdated &&
    optionalQuirks &&
    optionalDomain &&
    optionalApplyable &&
    optionalMatched &&
    optionalRelated
  );
}

function buildMcpDiagnosticFromPayload(payload: Record<string, unknown>): McpDiagnostic {
  const matchedEntry = optionalNullableString(payload.matched_entry);
  const relatedEntry = optionalNullableString(payload.related_olive_entry);
  const frequency = parseOptionalFrequency(payload.frequency);
  const diagnostic: McpDiagnostic = {
    title: payload.title as string,
    root_cause: payload.root_cause as string,
    workaround: payload.workaround as string,
    matched_entry: matchedEntry === undefined ? null : matchedEntry,
  };
  if (payload.updated_config !== undefined && payload.updated_config !== null) {
    diagnostic.updated_config = payload.updated_config as Record<string, unknown>;
  }
  if (Array.isArray(payload.relevant_quirks)) {
    diagnostic.relevant_quirks = payload.relevant_quirks as string[];
  }
  if (payload.domain !== undefined) {
    diagnostic.domain = payload.domain as McpDiagnostic["domain"];
  }
  if (typeof payload.applyable === "boolean") {
    diagnostic.applyable = payload.applyable;
  }
  if (relatedEntry !== undefined) {
    diagnostic.related_olive_entry = relatedEntry;
  }
  if (frequency !== undefined) {
    diagnostic.frequency = frequency;
  }
  return diagnostic;
}

// ─── Public API ────────────────────────────────────────────────────────

/** True when a diagnosis has a stable KB id suitable for feedback submission. */
export function hasMcpFeedbackTarget(
  diagnostic: { matched_entry?: string | null } | null | undefined,
): diagnostic is { matched_entry: string } {
  return typeof diagnostic?.matched_entry === "string" && diagnostic.matched_entry.length > 0;
}

/**
 * Build a typed {@link McpDiagnostic} from an untrusted MCP tool payload.
 * Forwards only known fields (including feedback key `matched_entry`).
 * Returns null when required display fields are missing or optionals are malformed.
 */
export function parseMcpDiagnosticPayload(payload: Record<string, unknown>): McpDiagnostic | null {
  if (!mcpDiagnosticRequiredFieldsPresent(payload) || !mcpDiagnosticOptionalsValid(payload)) {
    return null;
  }
  return buildMcpDiagnosticFromPayload(payload);
}

// ─── Feedback normalization ────────────────────────────────────────────

const FEEDBACK_RATING_SET = new Set<string>(MCP_TROUBLESHOOT_FEEDBACK_RATINGS);
const FEEDBACK_REASON_SET = new Set<string>(MCP_TROUBLESHOOT_FEEDBACK_REASON_CODES);

/**
 * Validate and normalize client-side feedback args before POSTing to MCP.
 * Rejects empty matched_entry, unknown ratings, and non-allowlisted reason codes.
 * Never accepts logs or free-form text fields.
 */
export function normalizeMcpTroubleshootFeedbackArgs(
  args: McpTroubleshootFeedbackArgs,
): { ok: true; args: McpTroubleshootFeedbackArgs } | { ok: false; error: string } {
  const matched =
    typeof args.matched_entry === "string" ? args.matched_entry.trim() : "";
  if (!matched) {
    return { ok: false, error: "matched_entry must be a non-empty string entry id." };
  }
  if (!FEEDBACK_RATING_SET.has(args.rating)) {
    return { ok: false, error: "rating must be 'thumbs-up' or 'thumbs-down'." };
  }
  let reason_code: McpTroubleshootFeedbackReasonCode | undefined;
  if (args.reason_code !== undefined && args.reason_code !== null) {
    if (typeof args.reason_code !== "string" || !FEEDBACK_REASON_SET.has(args.reason_code)) {
      return { ok: false, error: "reason_code must be an allowlisted value or omitted." };
    }
    reason_code = args.reason_code;
  }
  const normalized: McpTroubleshootFeedbackArgs = {
    matched_entry: matched,
    rating: args.rating as McpTroubleshootFeedbackRating,
  };
  if (reason_code !== undefined) normalized.reason_code = reason_code;
  return { ok: true, args: normalized };
}

export function parseFeedbackToolPayload(
  payload: Record<string, unknown> | null,
): McpTroubleshootFeedbackResult | McpTroubleshootFeedbackError {
  if (!payload) {
    return { status: "error", error: "empty_response", message: "Feedback returned an empty response." };
  }
  if (payload.status === "ok" && typeof payload.matched_entry === "string") {
    const ok = parseFeedbackOkPayload(payload);
    if (ok) return ok;
  }
  const error =
    (typeof payload.error === "string" && payload.error) ||
    (typeof payload.message === "string" && "feedback_failed") ||
    "unexpected_response";
  const message =
    typeof payload.message === "string"
      ? payload.message
      : "Feedback request failed or returned an unexpected response.";
  return { status: "error", error, message };
}

function parseFeedbackOkPayload(
  payload: Record<string, unknown>,
): McpTroubleshootFeedbackResult | null {
  const rating = payload.rating;
  if (typeof rating !== "string" || !FEEDBACK_RATING_SET.has(rating)) return null;
  const thumbs_up = typeof payload.thumbs_up === "number" ? payload.thumbs_up : 0;
  const thumbs_down = typeof payload.thumbs_down === "number" ? payload.thumbs_down : 0;
  const reasonRaw = payload.reason_code;
  const reason_code =
    reasonRaw === null || reasonRaw === undefined
      ? null
      : typeof reasonRaw === "string" && FEEDBACK_REASON_SET.has(reasonRaw)
        ? (reasonRaw as McpTroubleshootFeedbackReasonCode)
        : null;
  const result: McpTroubleshootFeedbackResult = {
    status: "ok",
    matched_entry: payload.matched_entry as string,
    rating: rating as McpTroubleshootFeedbackRating,
    reason_code,
    thumbs_up,
    thumbs_down,
    total: typeof payload.total === "number" ? payload.total : thumbs_up + thumbs_down,
  };
  if (typeof payload.score_delta === "number") {
    result.score_delta = payload.score_delta;
  }
  return result;
}
