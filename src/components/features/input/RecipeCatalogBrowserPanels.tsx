import { Input, Select } from "@/components/ui";
import { CompatCountSummary } from "@/components/features/input/CompatStatus";
import type { LocalModelHints } from "@/lib/recipeModelMatch";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import type { RecipeSortMode } from "@/components/features/input/useRecipeCatalog";
import { Search, X, Loader2, AlertTriangle } from "lucide-react";

export function RecipeCatalogSummaryLine({
  curatedCount,
  totalPresetCount,
  localModelHints,
  localHintsStatus,
  localMatchSummary,
  hardwareProbe,
  hardwareProbeStatus,
  hardwareMatchSummary,
}: {
  curatedCount: number;
  totalPresetCount: number;
  localModelHints: LocalModelHints | null;
  localHintsStatus: "idle" | "loading" | "ready";
  localMatchSummary: { match: number; possible: number; none: number } | null;
  hardwareProbe: HardwareProbeResult | null;
  hardwareProbeStatus: "idle" | "loading" | "ready";
  hardwareMatchSummary: { compatible: number; unavailable: number } | null;
}) {
  return (
    <p className="text-xs text-slate-400 font-mono mb-3">
      {curatedCount} of {totalPresetCount} presets
      {localModelHints && localHintsStatus !== "loading"
        ? ` · ${localMatchSummary?.match ?? 0} match local upload`
        : ""}
      {hardwareProbe && hardwareProbeStatus !== "loading"
        ? ` · ${hardwareMatchSummary?.compatible ?? 0} compatible with this PC`
        : ""}
    </p>
  );
}

export function RecipeCatalogHardwarePanel({
  hardwareProbe,
  hardwareProbeStatus,
  hardwareMatchSummary,
  compatibilityFilter,
  setCompatibilityFilter,
}: {
  hardwareProbe: HardwareProbeResult | null;
  hardwareProbeStatus: "idle" | "loading" | "ready";
  hardwareMatchSummary: { compatible: number; unavailable: number } | null;
  compatibilityFilter: "all" | "compatible-only";
  setCompatibilityFilter: (v: "all" | "compatible-only") => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
            Hardware compatibility
          </p>
          {hardwareProbeStatus === "loading" ? (
            <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-electric-blue" />
              Probing this machine…
            </p>
          ) : hardwareProbe ? (
            <div className="mt-1 space-y-1">
              <CompatCountSummary
                compatible={hardwareMatchSummary?.compatible ?? 0}
                incompatible={hardwareMatchSummary?.unavailable ?? 0}
              />
              <p className="text-xs text-slate-400">
                Detected:{" "}
                {hardwareProbe.detectedProviders
                  .map((p) => p.replace("ExecutionProvider", ""))
                  .join(", ")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-1">
              Hardware probe unavailable — compatibility not verified.
            </p>
          )}
        </div>
        {hardwareProbe && hardwareProbeStatus !== "loading" && (
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={compatibilityFilter === "compatible-only"}
              onChange={(e) => setCompatibilityFilter(e.target.checked ? "compatible-only" : "all")}
              className="rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
            />
            Hide incompatible
          </label>
        )}
      </div>
    </div>
  );
}

export function RecipeCatalogLocalMatchPanel({
  localModelHints,
  localHintsStatus,
  localMatchSummary,
  localMatchFilter,
  setLocalMatchFilter,
}: {
  localModelHints: LocalModelHints | null;
  localHintsStatus: "idle" | "loading" | "ready";
  localMatchSummary: { match: number; possible: number; none: number } | null;
  localMatchFilter: "all" | "local-only";
  setLocalMatchFilter: (v: "all" | "local-only") => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
            Local model recipe match
          </p>
          {localHintsStatus === "loading" ? (
            <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-electric-blue" />
              Reading upload…
            </p>
          ) : localModelHints ? (
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">
              <span className="text-slate-200 font-semibold">{localModelHints.displayName}</span>
              <span className="text-slate-600"> · </span>
              <span className="text-emerald-400">{localMatchSummary?.match ?? 0} match</span>
              {(localMatchSummary?.possible ?? 0) > 0 && (
                <>
                  <span className="text-slate-600"> · </span>
                  <span className="text-amber-400">{localMatchSummary?.possible} possible</span>
                </>
              )}
              <span className="text-slate-600"> · </span>
              <span className="text-slate-500">{localMatchSummary?.none ?? 0} no preset</span>
            </p>
          ) : null}
          {localModelHints?.hfModelIds[0] && (
            <p
              className="text-[11px] font-mono text-slate-500 mt-1 truncate"
              title={localModelHints.hfModelIds[0]}
            >
              From config: {localModelHints.hfModelIds[0]}
            </p>
          )}
        </div>
        {localModelHints && localHintsStatus !== "loading" && (localMatchSummary?.match ?? 0) > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={localMatchFilter === "local-only"}
              onChange={(e) => setLocalMatchFilter(e.target.checked ? "local-only" : "all")}
              className="rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
            />
            Matches only
          </label>
        )}
      </div>
    </div>
  );
}

export function RecipeCatalogFilterBar({
  recipeSearch,
  setRecipeSearch,
  selectedArchitecture,
  setSelectedArchitecture,
  selectedDevice,
  setSelectedDevice,
  recipeSort,
  setRecipeSort,
}: {
  recipeSearch: string;
  setRecipeSearch: (v: string) => void;
  selectedArchitecture: string;
  setSelectedArchitecture: (v: string) => void;
  selectedDevice: string;
  setSelectedDevice: (v: string) => void;
  recipeSort: RecipeSortMode;
  setRecipeSort: (v: RecipeSortMode) => void;
}) {
  return (
    <div className="space-y-2 pb-3 border-b border-slate-900">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
        <Input
          placeholder="Search recipes..."
          className="pl-9 h-9 text-sm"
          value={recipeSearch}
          onChange={(e) => setRecipeSearch(e.target.value)}
        />
        {recipeSearch && (
          <button
            type="button"
            aria-label="Clear recipe search"
            onClick={() => setRecipeSearch("")}
            className="absolute right-3 top-2.5 text-slate-500 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-0 p-0 m-0 min-w-0">
        <legend className="sr-only">Recipe filters</legend>
        <Select
          id="recipe-architecture-filter"
          aria-label="Architecture filter"
          value={selectedArchitecture}
          onChange={(e) => setSelectedArchitecture(e.target.value)}
          className="h-9 text-sm py-1"
        >
          <option value="All">All Architectures</option>
          <option value="Llama">Llama series</option>
          <option value="Phi">Phi series</option>
          <option value="Whisper">Whisper Speech</option>
          <option value="Qwen">Qwen series</option>
          <option value="BERT">BERT NLP</option>
          <option value="MobileNet">MobileNet vision</option>
          <option value="ResNet">ResNet series</option>
          <option value="Stable Diffusion">Stable Diffusion</option>
          <option value="Other">Other models</option>
        </Select>
        <Select
          id="recipe-platform-filter"
          aria-label="Platform filter"
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="h-9 text-sm py-1"
        >
          <option value="All">All Platforms / EPs</option>
          <option value="CUDA">NVIDIA CUDA GPU</option>
          <option value="DirectML">Windows DirectML</option>
          <option value="TensorRT">NVIDIA TensorRT (SDK)</option>
          <option value="TensorRT RTX">NVIDIA TensorRT RTX</option>
          <option value="QNN">Qualcomm QNN NPU</option>
          <option value="OpenVINO">Intel OpenVINO</option>
          <option value="CPU">Universal CPU</option>
        </Select>
        <Select
          id="recipe-sort"
          aria-label="Sort recipes"
          value={recipeSort}
          onChange={(e) => setRecipeSort(e.target.value as RecipeSortMode)}
          className="h-9 text-sm py-1"
        >
          <option value="recommended">Sort: Recommended</option>
          <option value="name-asc">Sort: Name A-Z</option>
          <option value="name-desc">Sort: Name Z-A</option>
          <option value="size-asc">Sort: Size (smallest)</option>
          <option value="size-desc">Sort: Size (largest)</option>
        </Select>
      </fieldset>
    </div>
  );
}

export function RecipeCatalogSyncError({ syncError }: { syncError: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{syncError}</span>
    </div>
  );
}
