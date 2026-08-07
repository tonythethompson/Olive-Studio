import { useEffect, useRef, useState, useCallback } from "react";
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
import { matchLocalLogDiagnostic } from "@/lib/logFailurePatterns";

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
  if (
    typeof payload.title !== "string" ||
    !payload.title ||
    typeof payload.root_cause !== "string" ||
    !payload.root_cause ||
    typeof payload.workaround !== "string" ||
    !payload.workaround
  ) {
    return null;
  }

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

  // matched_entry: stable feedback id — string | null | omitted; empty → null
  const matchedEntry = optionalNullableString(payload.matched_entry);
  const optionalMatched = matchedEntry !== undefined || payload.matched_entry === undefined;

  const relatedEntry = optionalNullableString(payload.related_olive_entry);
  const optionalRelated = relatedEntry !== undefined || payload.related_olive_entry === undefined;

  // frequency is best-effort: invalid shape is stripped, not a hard reject
  const frequency = parseOptionalFrequency(payload.frequency);

  if (
    !optionalUpdated ||
    !optionalQuirks ||
    !optionalDomain ||
    !optionalApplyable ||
    !optionalMatched ||
    !optionalRelated
  ) {
    return null;
  }

  const diagnostic: McpDiagnostic = {
    title: payload.title,
    root_cause: payload.root_cause,
    workaround: payload.workaround,
    // Always define matched_entry so feedback UI can key off a stable value.
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

/**
 * Auto-clearing error state hook.
 *
 * Returns an error string and a setter that automatically clears the error
 * after `timeoutMs` (default 4 s). The timer is cleaned up on unmount so
 * we never call setState on an unmounted component.
 *
 * Usage:
 * ```ts
 * const [error, setError] = useAutoClearError(4000);
 * // to show an error:
 * setError("Something went wrong");
 * // to clear immediately:
 * setError("");
 * ```
 */
export function useAutoClearError(timeoutMs = 4000): [string, (msg: string) => void] {
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const setErrorWithAutoClear = useCallback(
    (msg: string) => {
      // Cancel any pending clear
      if (timerRef.current !== null) clearTimeout(timerRef.current);

      setError(msg);

      // Only schedule a clear for non-empty messages
      if (msg !== "") {
        timerRef.current = setTimeout(() => {
          setError("");
          timerRef.current = null;
        }, timeoutMs);
      }
    },
    [timeoutMs],
  );

  return [error, setErrorWithAutoClear];
}

// ─── MCP Diagnostic ──────────────────────────────────────────────

interface UseMcpDiagnosticReturn {
  /** The latest diagnostic result (only for single-diagnostic use). */
  diagnostic: McpDiagnostic | null;
  /** True while a fetch is in flight. */
  isDiagnosing: boolean;
  /** Last fetch error message, if any. Cleared on the next successful fetch. */
  error: string | null;
  /**
   * Fetch a diagnostic for the given logs. Returns the McpDiagnostic
   * result (or null on failure) so callers can store it in any shape
   * they need (single state, keyed Record, etc.).
   */
  fetchDiagnostic: (logs: string[]) => Promise<McpDiagnostic | null>;
}

/**
 * Retrieves a troubleshooting diagnostic for the provided logs.
 *
 * @param logs - Log lines to analyze.
 * @param signal - Optional signal used to cancel the request.
 * @returns An object containing the diagnostic, or an error message when retrieval fails.
 */
export async function requestMcpDiagnostic(
  logs: string[],
  signal?: AbortSignal,
): Promise<{ diagnostic: McpDiagnostic | null; error: string | null }> {
  if (logs.length === 0) return { diagnostic: null, error: null };

  // Prefer deterministic Studio matchers (Whisper HF task, etc.) over a vague MCP hit.
  const local = matchLocalLogDiagnostic(logs);
  if (local) return { diagnostic: local, error: null };

  try {
    const errorSnippet = logs.slice(-80).join("\n");
    const resp = await fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "troubleshoot_olive_error",
        args: { error_message: errorSnippet, domain: "auto" },
      }),
      signal,
    });
    const data: unknown = await resp.json().catch(() => null);
    if (signal?.aborted) return { diagnostic: null, error: null };

    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    // Prefer unwrapped tool payload when a legacy `{ result }` envelope is present.
    const payload =
      record && record.result && typeof record.result === "object" && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : record;

    if (!resp.ok) {
      const msg =
        (payload && typeof payload.error === "string" && payload.error) ||
        (record && typeof record.error === "string" && record.error) ||
        `Diagnosis failed (HTTP ${resp.status})`;
      return { diagnostic: null, error: msg };
    }

    if (payload && typeof payload.error === "string" && payload.error) {
      return { diagnostic: null, error: payload.error };
    }

    if (payload) {
      const diagnostic = parseMcpDiagnosticPayload(payload);
      if (diagnostic) {
        return { diagnostic, error: null };
      }
      if (typeof payload.title === "string" && payload.title) {
        return {
          diagnostic: null,
          error: "Diagnosis returned an incomplete or malformed payload.",
        };
      }
    }

    return { diagnostic: null, error: "Diagnosis returned an unexpected response." };
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { diagnostic: null, error: null };
    }
    return {
      diagnostic: null,
      error: err instanceof Error ? err.message : "Diagnosis request failed",
    };
  }
}

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

function parseFeedbackToolPayload(
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

/**
 * Submit local aggregate troubleshoot feedback via the MCP proxy.
 * Sends only matched_entry + rating (+ optional reason_code) — never logs.
 */
export async function requestMcpTroubleshootFeedback(
  args: McpTroubleshootFeedbackArgs,
  signal?: AbortSignal,
): Promise<McpTroubleshootFeedbackResult | McpTroubleshootFeedbackError> {
  const normalized = normalizeMcpTroubleshootFeedbackArgs(args);
  if (!normalized.ok) {
    return { status: "error", error: "invalid_args", message: normalized.error };
  }

  try {
    const toolArgs: Record<string, string> = {
      matched_entry: normalized.args.matched_entry,
      rating: normalized.args.rating,
    };
    if (normalized.args.reason_code) {
      toolArgs.reason_code = normalized.args.reason_code;
    }

    const resp = await fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "record_troubleshoot_feedback",
        args: toolArgs,
      }),
      signal,
    });
    const data: unknown = await resp.json().catch(() => null);
    if (signal?.aborted) {
      return { status: "error", error: "aborted", message: "Feedback request was cancelled." };
    }

    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const payload =
      record && record.result && typeof record.result === "object" && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : record;

    if (!resp.ok) {
      const msg =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        (record && typeof record.error === "string" && record.error) ||
        `Feedback failed (HTTP ${resp.status})`;
      return {
        status: "error",
        error: typeof payload?.error === "string" ? payload.error : "http_error",
        message: msg,
      };
    }

    return parseFeedbackToolPayload(payload);
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { status: "error", error: "aborted", message: "Feedback request was cancelled." };
    }
    return {
      status: "error",
      error: "request_failed",
      message: err instanceof Error ? err.message : "Feedback request failed",
    };
  }
}

/**
 * Manages fetching and storing a single MCP diagnostic for error logs.
 *
 * Cancels any in-flight request when a new fetch starts or the component unmounts,
 * and exposes loading and error state alongside the diagnostic result.
 *
 * @returns The current diagnostic, loading state, error message, and diagnostic fetcher.
 */
export function useMcpDiagnostic(): UseMcpDiagnosticReturn {
  const [diagnostic, setDiagnostic] = useState<McpDiagnostic | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchDiagnostic = useCallback(async (logs: string[]): Promise<McpDiagnostic | null> => {
    if (logs.length === 0) return null;
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsDiagnosing(true);
    setError(null);
    try {
      const { diagnostic: result, error: fetchError } = await requestMcpDiagnostic(logs, controller.signal);
      if (controller.signal.aborted) return null;
      if (result) {
        setDiagnostic(result);
        setError(null);
        return result;
      }
      setError(fetchError);
      return null;
    } finally {
      // Only clear loading if this request wasn't superseded by a newer one
      if (!controller.signal.aborted) setIsDiagnosing(false);
    }
  }, []);

  return { diagnostic, isDiagnosing, error, fetchDiagnostic };
}

// ─── MCP Diagnostic (Keyed by ID) ─────────────────────────────

/**
 * Manages MCP diagnostics, loading states, and errors independently for each key.
 *
 * Starting a request for a key cancels any previous request for that key and clears
 * its previous diagnostic. Aborted requests do not update the returned state.
 *
 * @returns Functions and keyed state for fetching and tracking diagnostics.
 */
export function useMcpDiagnosticKeyed(): {
  fetchKeyedDiagnostic: (key: string, logs: string[]) => Promise<McpDiagnostic | null>;
  diagnostics: Record<string, McpDiagnostic>;
  diagnosingKeys: Record<string, boolean>;
  errors: Record<string, string | null>;
} {
  const [diagnostics, setDiagnostics] = useState<Record<string, McpDiagnostic>>({});
  const [diagnosingKeys, setDiagnosingKeys] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const aborts = abortMapRef.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, []);

  const fetchKeyedDiagnostic = useCallback(async (key: string, logs: string[]) => {
    if (logs.length === 0) return null;
    abortMapRef.current.get(key)?.abort();
    const controller = new AbortController();
    abortMapRef.current.set(key, controller);

    setDiagnosingKeys((prev) => ({ ...prev, [key]: true }));
    setDiagnostics((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const { diagnostic: result, error: fetchError } = await requestMcpDiagnostic(logs, controller.signal);
      if (controller.signal.aborted) return null;
      if (result) {
        setDiagnostics((prev) => ({ ...prev, [key]: result }));
        setErrors((prev) => ({ ...prev, [key]: null }));
        return result;
      }
      setErrors((prev) => ({ ...prev, [key]: fetchError }));
      return null;
    } finally {
      if (!controller.signal.aborted) {
        setDiagnosingKeys((prev) => ({ ...prev, [key]: false }));
      }
      if (abortMapRef.current.get(key) === controller) {
        abortMapRef.current.delete(key);
      }
    }
  }, []);

  return { fetchKeyedDiagnostic, diagnostics, diagnosingKeys, errors };
}

// ─── Import Presets ─────────────────────────────────────────────

interface ImportConfirmState<T> {
  importedPresets: T[];
  collisions: string[];
  mergedPresets: T[];
}

/** The return type shared by all preset import parsers (pruningPresets, quantPresets). */
interface ImportParseResult<T> {
  ok: true;
  presets: T[];
  importedPresets: T[];
  collisions: string[];
}

/**
 * Shared import-file logic for preset inspectors.
 *
 * Encapsulates: hidden file input → FileReader → parseImport → confirm state.
 * Each inspector passes its own parser (from pruningPresets or quantPresets).
 *
 * Usage:
 * ```ts
 * const { handleImport, importConfirm, setImportConfirm } = useImportPresets({
 *   customPresets,
 *   setError,
 *   parseImport: importPresetsJSON,
 * });
 * ```
 */
export function useImportPresets<T>(opts: {
  customPresets: T[];
  setError: (msg: string) => void;
  parseImport: (json: string, existing: T[]) => ImportParseResult<T> | { ok: false; error: string };
}): {
  handleImport: () => void;
  importConfirm: ImportConfirmState<T> | null;
  setImportConfirm: (state: ImportConfirmState<T> | null) => void;
} {
  const { customPresets, setError, parseImport } = opts;
  const [importConfirm, setImportConfirm] = useState<ImportConfirmState<T> | null>(null);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const result = parseImport(text, customPresets);
        if (result.ok === false) {
          setError(result.error);
        } else {
          setImportConfirm({
            importedPresets: result.importedPresets,
            collisions: result.collisions,
            mergedPresets: result.presets,
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [customPresets, setError, parseImport]);

  return { handleImport, importConfirm, setImportConfirm };
}

// ─── Export Presets ────────────────────────────────────────────

/**
 * Shared export-to-JSON-file logic for preset inspectors.
 *
 * Encapsulates: serialize → Blob → createObjectURL → download link → revoke.
 * Both PruningInspector and QuantizationInspector use the same pattern.
 *
 * Usage:
 * ```ts
 * const { handleExport, isEmpty } = useExportPresets({
 *   presets: customPresets,
 *   serialize: exportPresetsJSON,
 *   filename: "pruning-presets.json",
 * });
 * ```
 */
export function useExportPresets<T>(opts: {
  presets: T[];
  serialize: (presets: T[]) => string;
  filename: string;
}): {
  handleExport: () => void;
  isEmpty: boolean;
} {
  const { presets, serialize, filename } = opts;

  const handleExport = useCallback(() => {
    if (presets.length === 0) return;
    const json = serialize(presets);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [presets, serialize, filename]);

  return { handleExport, isEmpty: presets.length === 0 };
}
