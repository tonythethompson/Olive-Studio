import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { diffJson, type DiffLine } from "@/lib/jsonDiff";
import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import { UIState } from "@/types";
import { X, Code2 } from "lucide-react";

/** Extract only the quantization pass config from a full recipe. */
function getQuantConfig(state: UIState): Record<string, unknown> {
  if (!state.passes.quantization) return {};
  const recipe = buildOliveRecipe(state);
  const passes = recipe.passes as Record<string, unknown> | undefined;
  const quant = passes?.quantization as { type?: string; config?: Record<string, unknown> } | undefined;
  return {
    pass_type: quant?.type ?? "none",
    ...quant?.config,
  };
}

interface DiffOverlayProps {
  state: UIState;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bg = line.kind === "added" ? "bg-emerald-950/60" : line.kind === "removed" ? "bg-rose-950/60" : "";
  const textColor =
    line.kind === "added" ? "text-emerald-300" : line.kind === "removed" ? "text-rose-300" : "text-slate-400";
  const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";

  return (
    <pre className={`${bg} ${textColor} px-2 py-px text-[10px] font-mono leading-4 whitespace-pre`}>
      <span className="select-none w-4 inline-block shrink-0">{prefix}</span>
      {line.line}
    </pre>
  );
}

const renderRow = (l: DiffLine, i: number) => (
  <Fragment key={i}>
    <DiffLineRow line={l} />
  </Fragment>
);

export function RecipeDiffOverlay({ state }: DiffOverlayProps) {
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [prevConfig, setPrevConfig] = useState<Record<string, unknown> | null>(null);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentConfig = getQuantConfig(state);

  // Snapshot on first render
  const hasSnapshotted = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- intentional: one-time init guard, runs only before mount completes
  if (!hasSnapshotted.current) {
    hasSnapshotted.current = true;
    // Delay snapshot slightly so mount doesn't trigger a false diff
    setTimeout(() => setPrevConfig(currentConfig), 100);
  }

  useEffect(() => {
    if (!prevConfig || !hasSnapshotted.current) return;

    const prevJson = JSON.stringify(prevConfig);
    const currJson = JSON.stringify(currentConfig);
    if (prevJson === currJson) return;

    // Show diff when parameters actually changed
    const lines = diffJson(prevConfig, currentConfig);
    const hasChanges = lines.some((l) => l.kind !== "same");
    if (hasChanges) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: update diff from parameter comparison
      setDiff(lines);
      setVisible(true);
    }
    setPrevConfig(currentConfig);

    // Auto-dismiss after 8 seconds
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setVisible(false);
    }, 8000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConfig]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDiff(null);
  }, []);

  if (!visible || !diff) return null;

  return (
    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-2">
          <Code2 className="h-3.5 w-3.5 text-electric-blue" />
          <span className="text-[10px] font-mono font-semibold text-slate-300">Recipe diff</span>
          <span className="text-[9px] font-mono text-slate-600">Quantization pass config changed</span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          aria-label="Dismiss diff"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Diff body */}
      <div className="max-h-48 overflow-y-auto py-1">
        <div className="grid grid-cols-[1fr_1fr] divide-x divide-slate-800">
          <div className="min-w-0">
            <div className="sticky top-0 bg-slate-950 px-2 py-1 text-[9px] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
              Before
            </div>
            <div>{diff.filter((l) => l.kind !== "added").map(renderRow)}</div>
          </div>
          <div className="min-w-0">
            <div className="sticky top-0 bg-slate-950 px-2 py-1 text-[9px] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
              After
            </div>
            <div>{diff.filter((l) => l.kind !== "removed").map(renderRow)}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end px-3 py-1.5 border-t border-slate-800 bg-slate-900/80">
        <span className="text-[9px] text-slate-600 font-mono">Diff auto-clears in 8s</span>
      </div>
    </div>
  );
}
