import { useState, useCallback } from "react";
import {
  Label,
  Select,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { getAllowedPruningTypes } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { Info, Plus, X } from "lucide-react";
import type { InspectorProps } from "./types";

// ── Custom preset storage ──────────────────────────────────────

interface CustomPreset {
  id: string;
  label: string;
  method: UIState["passes"]["pruningMethod"];
  criteria: UIState["passes"]["pruningCriteria"];
  sparsity: number;
}

const STORAGE_KEY = "olive-pruning-custom-presets";
const MAX_CUSTOM_PRESETS = 5;

function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(presets: CustomPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable or quota exceeded — fail silently
  }
}

// ── Built-in presets ───────────────────────────────────────────

const PRUNING_PRESETS = [
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Magnitude · L1 · 70% — maximizes sparsity, tolerates accuracy loss",
    method: "magnitude" as const,
    criteria: "l1_norm" as const,
    sparsity: 0.7,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Magnitude · L2 · 50% — smooth pruning with moderate compression",
    method: "magnitude" as const,
    criteria: "l2_norm" as const,
    sparsity: 0.5,
  },
  {
    id: "sparsegpt",
    label: "SparseGPT",
    description: "SparseGPT · 50% — one-shot LLM pruning with minimal accuracy loss",
    method: "sparsegpt" as const,
    criteria: "l1_norm" as const,
    sparsity: 0.5,
  },
  {
    id: "wanda",
    label: "Wanda",
    description: "Wanda · 50% — weight × activation pruning, fast calibration",
    method: "wanda" as const,
    criteria: "l1_norm" as const,
    sparsity: 0.5,
  },
] as const;

type PruningPreset = (typeof PRUNING_PRESETS)[number];

function getActivePresetId(
  state: UIState,
  allPresets: readonly (PruningPreset | CustomPreset)[],
): string | null {
  for (const preset of allPresets) {
    if (
      state.passes.pruningMethod === preset.method &&
      state.passes.pruningCriteria === preset.criteria &&
      Math.abs(state.passes.pruningSparsity - preset.sparsity) < 0.01
    ) {
      return preset.id;
    }
  }
  return null;
}

export function PruningInspector({ state, setState }: InspectorProps) {
  const allowedPruningTypes = getAllowedPruningTypes(state.ihvProvider);
  const awqBlocksPruning = state.passes.quantMethod === "awq";

  // ── Custom preset state ──
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(loadCustomPresets);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  const persistCustomPresets = useCallback((presets: CustomPreset[]) => {
    setCustomPresets(presets);
    saveCustomPresets(presets);
  }, []);

  const duplicateName =
    showSaveDialog && newPresetName.trim()
      ? customPresets.some((p) => p.label.toLowerCase() === newPresetName.trim().toLowerCase())
      : false;

  const handleSaveCustomPreset = useCallback(() => {
    const name = newPresetName.trim();
    if (!name || customPresets.length >= MAX_CUSTOM_PRESETS) return;
    if (customPresets.some((p) => p.label.toLowerCase() === name.toLowerCase())) return;

    const preset: CustomPreset = {
      id: `custom-${Date.now()}`,
      label: name,
      method: state.passes.pruningMethod,
      criteria: state.passes.pruningCriteria,
      sparsity: state.passes.pruningSparsity,
    };
    persistCustomPresets([...customPresets, preset]);
    setNewPresetName("");
    setShowSaveDialog(false);
  }, [newPresetName, customPresets, state.passes, persistCustomPresets]);

  const handleDeleteCustomPreset = useCallback(
    (id: string) => {
      persistCustomPresets(customPresets.filter((p) => p.id !== id));
    },
    [customPresets, persistCustomPresets],
  );

  if (!state.passes.pruning) {
    return (
      <p className="text-sm text-slate-500 font-mono italic text-center py-4">
        Pruning is skipped — weights stay dense.
      </p>
    );
  }

  const allPresets = [...PRUNING_PRESETS, ...customPresets];
  const activePresetId = getActivePresetId(state, allPresets);

  return (
    <div className="space-y-5">
      {awqBlocksPruning && (
        <p className="text-xs text-amber-500/90 leading-relaxed rounded border border-amber-500/20 bg-amber-950/20 px-3 py-2">
          AWQ is active — pruning cannot run until you switch to PTQ or disable quantization.
        </p>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Quick presets</p>
          <button
            type="button"
            onClick={() => setShowSaveDialog(!showSaveDialog)}
            className="text-[10px] text-slate-500 hover:text-amber-400 transition-colors flex items-center gap-1"
            title="Save current settings as a custom preset"
          >
            <Plus className="h-3 w-3" />
            Save
            {customPresets.length > 0 && (
              <span className="text-slate-600">
                ({customPresets.length}/{MAX_CUSTOM_PRESETS})
              </span>
            )}
          </button>
        </div>
        {showSaveDialog && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveCustomPreset();
                if (e.key === "Escape") {
                  setShowSaveDialog(false);
                  setNewPresetName("");
                }
              }}
              placeholder="Preset name…"
              maxLength={24}
              className="flex-1 h-7 px-2 text-[10px] bg-slate-950 border border-slate-700 rounded text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
            />
            <button
              type="button"
              onClick={handleSaveCustomPreset}
              disabled={!newPresetName.trim() || duplicateName || customPresets.length >= MAX_CUSTOM_PRESETS}
              className={`h-7 px-2 text-[10px] font-medium rounded border transition-colors ${
                duplicateName
                  ? "border-red-500/50 bg-red-500/10 text-red-400"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Save
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {allPresets.map((preset) => {
            const isActive = activePresetId === preset.id;
            const isCustom = !PRUNING_PRESETS.some((p) => p.id === preset.id);
            return (
              <div key={preset.id} className="group relative">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() =>
                          setState({
                            passes: {
                              ...state.passes,
                              pruningMethod: preset.method,
                              pruningCriteria: preset.criteria,
                              pruningSparsity: preset.sparsity,
                            },
                          })
                        }
                        className={`px-2.5 py-1 text-[10px] font-medium rounded border transition-colors ${
                          isActive
                            ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                            : isCustom
                              ? "border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-slate-200"
                              : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {preset.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>
                        {isCustom
                          ? `${preset.method} · ${preset.criteria} · ${(preset.sparsity * 100).toFixed(0)}%`
                          : preset.description}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {isCustom && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomPreset(preset.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:bg-red-900/60 hover:text-red-300 hover:border-red-500/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`Delete preset '${preset.label}'`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs text-slate-400 flex items-center gap-1.5">
            Sparsity ratio
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger type="button" className="cursor-help text-slate-500 hover:text-slate-300">
                  <Info className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Fraction of weights set to zero. Higher = smaller model, more accuracy risk.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <span className="text-sm font-bold text-amber-400 font-mono tabular-nums">
            {(state.passes.pruningSparsity * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[state.passes.pruningSparsity]}
          onValueChange={(val) => setState({ passes: { ...state.passes, pruningSparsity: val[0] } })}
          min={0}
          max={0.99}
          step={0.01}
          className="py-2"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="pruning-method" className="text-xs text-slate-400">
            Method
          </Label>
          <Select
            id="pruning-method"
            value={state.passes.pruningMethod}
            onChange={(e) =>
              setState({
                passes: {
                  ...state.passes,
                  pruningMethod: e.target.value as UIState["passes"]["pruningMethod"],
                },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="sparsegpt">SparseGPT</option>
            <option value="wanda">Wanda</option>
            <option value="magnitude">Magnitude (L1/L2)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pruning-pattern" className="text-xs text-slate-400">
            Sparsity pattern
          </Label>
          <Select
            id="pruning-pattern"
            value={state.passes.pruningType}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, pruningType: e.target.value as UIState["passes"]["pruningType"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            {allowedPruningTypes.includes("unstructured") && (
              <option value="unstructured">Unstructured</option>
            )}
            {allowedPruningTypes.includes("structured") && <option value="structured">Structured 2:4</option>}
          </Select>
        </div>
        {state.passes.pruningMethod === "magnitude" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pruning-criteria" className="text-xs text-slate-400 flex items-center gap-1.5">
              Pruning criteria
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger type="button" className="cursor-help text-slate-500 hover:text-slate-300">
                    <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-semibold mb-1">How weights are ranked for removal</p>
                    <p className="text-slate-300">
                      <b>L1 norm</b> — sums absolute values. Produces sparser, blockier weight distributions.
                      Best when you want aggressively zeroed weights and can tolerate accuracy loss.
                    </p>
                    <p className="text-slate-300 mt-1">
                      <b>L2 norm</b> — sums squared values. Preserves relative weight magnitudes more evenly.
                      Gentler pruning with smoother accuracy degradation.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Select
              id="pruning-criteria"
              value={state.passes.pruningCriteria}
              onChange={(e) =>
                setState({
                  passes: {
                    ...state.passes,
                    pruningCriteria: e.target.value as UIState["passes"]["pruningCriteria"],
                  },
                })
              }
              className="h-9 text-xs bg-slate-950 max-w-xs"
            >
              <option value="l1_norm">L1 norm — aggressive</option>
              <option value="l2_norm">L2 norm — gentle</option>
            </Select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {state.passes.pruningCriteria === "l1_norm"
                ? "Sparser, blockier weight distributions — aggressively zeros weights with smaller absolute magnitudes."
                : "Smoother magnitude preservation — penalizes larger weights more heavily, gentler accuracy degradation."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
