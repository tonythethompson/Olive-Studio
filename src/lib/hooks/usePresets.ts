/**
 * Shared import/export preset hooks for inspector components.
 */
import { useState, useCallback } from "react";

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
