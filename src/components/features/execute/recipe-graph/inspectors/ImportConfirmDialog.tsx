import { useRef, useEffect } from "react";

/** Minimal shape every preset must have for the confirmation dialog. */
export interface ImportConfirmPreset {
  label: string;
}

interface ImportConfirmDialogProps<T extends ImportConfirmPreset> {
  importedPresets: T[];
  collisions: string[];
  mergedPresets: T[];
  /** Render a detail line below each preset label (e.g. "AWQ · INT4" or "magnitude · l1_norm · 70%"). */
  presetDetail: (preset: T) => string;
  onImport: (mergedPresets: T[]) => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog shown before applying an import of custom presets.
 * Handles keyboard shortcuts (Escape to cancel), auto-focuses the Cancel button,
 * and displays collision indicators with detail lines for each preset.
 */
export function ImportConfirmDialog<T extends ImportConfirmPreset>({
  importedPresets,
  collisions,
  mergedPresets,
  presetDetail,
  onImport,
  onCancel,
}: ImportConfirmDialogProps<T>) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button when the dialog opens
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  return (
    <div
      className="rounded-lg border border-slate-700 bg-slate-900/90 p-3 space-y-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
        Import {importedPresets.length} preset{importedPresets.length !== 1 ? "s" : ""}
      </p>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {importedPresets.map((preset) => {
          const isCollision = collisions.includes(preset.label);
          return (
            <div
              key={preset.label}
              className={`rounded px-2 py-1 ${isCollision ? "bg-amber-500/5" : "bg-slate-800/50"}`}
            >
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCollision ? "bg-amber-400" : "bg-emerald-400"}`}
                />
                <span className={`font-medium ${isCollision ? "text-amber-300" : "text-slate-300"}`}>
                  {preset.label}
                </span>
                {isCollision && <span className="text-[9px] text-amber-500/70">will overwrite</span>}
              </div>
              <div className="ml-3 text-[9px] text-slate-500 font-mono">{presetDetail(preset)}</div>
            </div>
          );
        })}
      </div>
      {collisions.length > 0 && (
        <p className="text-[11px] text-amber-400/80">
          {collisions.length} preset{collisions.length !== 1 ? "s" : ""} will overwrite existing custom
          presets with the same name.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onImport(mergedPresets)}
          className="h-7 px-3 text-[11px] font-medium rounded border border-electric-blue/50 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 transition-colors"
        >
          Import
        </button>
        <button
          ref={cancelBtnRef}
          type="button"
          onClick={onCancel}
          className="h-7 px-3 text-[11px] font-medium rounded border border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
