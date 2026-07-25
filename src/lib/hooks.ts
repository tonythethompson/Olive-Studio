import { useEffect, useRef, useState, useCallback } from "react";
import type { McpDiagnostic } from "@/types";

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
  /**
   * Fetch a diagnostic for the given logs. Returns the McpDiagnostic
   * result (or null on failure) so callers can store it in any shape
   * they need (single state, keyed Record, etc.).
   */
  fetchDiagnostic: (logs: string[]) => Promise<McpDiagnostic | null>;
}

/**
 * Fetch an MCP diagnostic for error logs via the troubleshoot_olive_error tool.
 *
 * Encapsulates the POST to /api/mcp/tool, loading state, and result storage.
 * Use this instead of duplicating the fetch logic in ExecutionWorkspace and
 * BatchProcessingPanel.
 *
 * For single-diagnostic use (ExecutionWorkspace):
 * ```ts
 * const { diagnostic, isDiagnosing, fetchDiagnostic } = useMcpDiagnostic();
 * ```
 *
 * For keyed-by-ID use (BatchProcessingPanel), manage the Record externally:
 * ```ts
 * const [diagnostics, setDiagnostics] = useState<Record<string, McpDiagnostic>>({});
 * const { fetchDiagnostic, isDiagnosing } = useMcpDiagnostic();
 * // In callback: fetchDiagnostic(logs).then(() => setDiagnostics(...))
 * ```
 */
export function useMcpDiagnostic(): UseMcpDiagnosticReturn {
  const [diagnostic, setDiagnostic] = useState<McpDiagnostic | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
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
    try {
      const errorSnippet = logs.slice(-20).join("\n");
      const resp = await fetch("/api/mcp/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: "troubleshoot_olive_error",
          args: { error_message: errorSnippet },
        }),
        signal: controller.signal,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && !data.error) {
          setDiagnostic(data);
          return data;
        }
      }
    } catch {
      // Ignore abort and network errors
    } finally {
      // Only clear loading if this request wasn't superseded by a newer one
      if (!controller.signal.aborted) setIsDiagnosing(false);
    }
    return null;
  }, []);

  return { diagnostic, isDiagnosing, fetchDiagnostic };
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
