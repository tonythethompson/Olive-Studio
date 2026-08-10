/**
 * RecipeCatalogBrowser — Presets tab for browsing the microsoft/olive-recipes catalog.
 * Extracted from InputEnvironmentPanel (Task 5).
 */
import { useState } from "react";
import { Input, Select, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fetchOliveRecipesCatalogItem, type RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import { estimateVramForCatalogPreset } from "@/lib/presetVramEstimate";
import {
  presetDisplayName,
  type RecipeSortMode,
  type RecipeRow,
} from "@/components/features/input/useRecipeCatalog";
import { CompatCountSummary, CompatStatusPill } from "@/components/features/input/CompatStatus";
import { navigatePipeline } from "@/lib/pipelineNavigation";
import type { LocalModelHints } from "@/lib/recipeModelMatch";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import {
  Search,
  X,
  Loader2,
  ChevronDown,
  AlertTriangle,
  DownloadCloud,
} from "lucide-react";

export interface RecipeCatalogBrowserProps {
  recipeSearch: string;
  setRecipeSearch: (v: string) => void;
  selectedArchitecture: string;
  setSelectedArchitecture: (v: string) => void;
  selectedDevice: string;
  setSelectedDevice: (v: string) => void;
  recipeSort: RecipeSortMode;
  setRecipeSort: (v: RecipeSortMode) => void;
  compatibilityFilter: "all" | "compatible-only";
  setCompatibilityFilter: (v: "all" | "compatible-only") => void;
  localMatchFilter: "all" | "local-only";
  setLocalMatchFilter: (v: "all" | "local-only") => void;
  localModelHints: LocalModelHints | null;
  localHintsStatus: "idle" | "loading" | "ready";
  hardwareProbe: HardwareProbeResult | null;
  hardwareProbeStatus: "idle" | "loading" | "ready";
  localMatchSummary: { match: number; possible: number; none: number } | null;
  hardwareMatchSummary: { compatible: number; unavailable: number } | null;
  curatedRecipesWithMatch: RecipeRow[];
  groupedRecipes: { title: string; rows: RecipeRow[] }[];
  totalPresetCount: number;
  localFilesCount: number;
  syncStatus: string;
  syncError: string;
  setSyncStatus: (v: "idle" | "loading" | "success" | "error") => void;
  setSyncError: (v: string) => void;
  applyingRecipePath: string | null;
  setImportJson: (v: string) => void;
  setActiveRecipeTab: (v: "starter" | "github" | "editor") => void;
  handleApplyCuratedRecipe: (item: RecipeCatalogItem) => void;
  handleApplyCuratedRecipeAnyway: (item: RecipeCatalogItem) => void;
}

export function RecipeCatalogBrowser({
  recipeSearch,
  setRecipeSearch,
  selectedArchitecture,
  setSelectedArchitecture,
  selectedDevice,
  setSelectedDevice,
  recipeSort,
  setRecipeSort,
  compatibilityFilter,
  setCompatibilityFilter,
  localMatchFilter,
  setLocalMatchFilter,
  localModelHints,
  localHintsStatus,
  hardwareProbe,
  hardwareProbeStatus,
  localMatchSummary,
  hardwareMatchSummary,
  curatedRecipesWithMatch,
  groupedRecipes,
  totalPresetCount,
  localFilesCount,
  syncStatus,
  syncError,
  setSyncStatus,
  setSyncError,
  applyingRecipePath,
  setImportJson,
  setActiveRecipeTab,
  handleApplyCuratedRecipe,
  handleApplyCuratedRecipeAnyway,
}: RecipeCatalogBrowserProps) {
  const [expandedRecipeGroups, setExpandedRecipeGroups] = useState<Set<string>>(new Set());

  return (
    <>
      <p className="text-xs text-slate-400 font-mono mb-3">
        {curatedRecipesWithMatch.length} of {totalPresetCount} presets
        {localModelHints && localHintsStatus !== "loading"
          ? ` · ${localMatchSummary?.match ?? 0} match local upload`
          : ""}
        {hardwareProbe && hardwareProbeStatus !== "loading"
          ? ` · ${hardwareMatchSummary?.compatible ?? 0} compatible with this PC`
          : ""}
      </p>

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

      {syncStatus === "error" && syncError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{syncError}</span>
        </div>
      )}

      {localFilesCount > 0 && (
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
                  <span className="text-slate-200 font-semibold">
                    {localModelHints.displayName}
                  </span>
                  <span className="text-slate-600"> · </span>
                  <span className="text-emerald-400">
                    {localMatchSummary?.match ?? 0} match
                  </span>
                  {(localMatchSummary?.possible ?? 0) > 0 && (
                    <>
                      <span className="text-slate-600"> · </span>
                      <span className="text-amber-400">
                        {localMatchSummary?.possible} possible
                      </span>
                    </>
                  )}
                  <span className="text-slate-600"> · </span>
                  <span className="text-slate-500">
                    {localMatchSummary?.none ?? 0} no preset
                  </span>
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
      )}

      {/* Search + Filters */}
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

      {/* Grouped recipe list */}
      <div className="max-h-[420px] overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800/80">
        {groupedRecipes.map(({ title: modelTitle, rows }) => {
          const isExpanded = expandedRecipeGroups.has(modelTitle);
          const toggleGroup = () => {
            setExpandedRecipeGroups((prev) => {
              const next = new Set(prev);
              if (next.has(modelTitle)) next.delete(modelTitle);
              else next.add(modelTitle);
              return next;
            });
          };
          const uniqueDevices = [...new Set(rows.map((r) => r.item.device))];
          return (
            <div key={modelTitle} className="bg-slate-950/20">
              <button
                type="button"
                onClick={toggleGroup}
                className="sticky top-0 z-[1] w-full flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2 cursor-pointer hover:bg-slate-900/80 transition-colors text-left"
                aria-expanded={isExpanded}
              >
                <h3 className="text-sm font-semibold text-slate-100 truncate">{modelTitle}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  {!isExpanded && (
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {uniqueDevices.map((device) => (
                        <span
                          key={device}
                          className="inline-flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono text-slate-300"
                        >
                          {device}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-xs font-mono text-slate-400">
                    {rows.length} target{rows.length === 1 ? "" : "s"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-slate-500 transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </div>
              </button>
              {isExpanded && (
                <div className="divide-y divide-slate-900/80">
                  {rows.map(({ item, match, hardware }) => {
                    const hwBlocked = hardware.tier === "unavailable";
                    const { meta } = presetDisplayName(item.name);
                    const vramEst = estimateVramForCatalogPreset(item, hardwareProbe);
                    const statusParts: string[] = [];
                    if (localModelHints && match?.tier === "match")
                      statusParts.push("Matches upload");
                    else if (localModelHints && match?.tier === "possible")
                      statusParts.push("Possible match");
                    if (item.metadataSource !== "recipe") statusParts.push("Approx. metadata");

                    return (
                      <div
                        key={item.repoPath}
                        title={hardware.reason}
                        className={cn(
                          "px-3 py-2 flex items-start gap-3 text-left",
                          hwBlocked && "opacity-90",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs font-mono text-slate-100">
                              {item.device}
                            </span>
                            <CompatStatusPill tier={hardware.tier} />
                            {meta && (
                              <span className="text-xs text-slate-400 truncate">{meta}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                            {item.description}
                          </p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">
                            {vramEst.summaryLine}
                            <span className="text-slate-600"> · </span>
                            {item.architecture}
                            {statusParts.length > 0 ? ` · ${statusParts.join(" · ")}` : ""}
                          </p>
                          {vramEst.fitHint && (
                            <p className="text-xs text-amber-500/90 mt-0.5">
                              {vramEst.fitHint}
                            </p>
                          )}
                          {hardware.requiresInstall && (
                            <div
                              className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5"
                              title={hardware.requiresInstall.hint}
                            >
                              <DownloadCloud className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-amber-300/95 leading-snug">
                                  {hardware.requiresInstall.hint}{" "}
                                  <button
                                    type="button"
                                    onClick={() => navigatePipeline("ihv")}
                                    className="text-electric-blue hover:text-white underline underline-offset-2 cursor-pointer"
                                  >
                                    Install in Hardware (step 02) →
                                  </button>
                                </p>
                                <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                                  {hardware.requiresInstall.installCommand}
                                </p>
                              </div>
                            </div>
                          )}
                          {hwBlocked && (
                            <p className="text-xs text-rose-400/80 mt-0.5 line-clamp-1">
                              {hardware.reason}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1.5 shrink-0 pt-0.5">
                          <Button
                            variant="outline"
                            type="button"
                            className="h-7 px-2 text-[11px] bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
                            disabled={applyingRecipePath === item.repoPath}
                            onClick={async () => {
                              try {
                                const json = await fetchOliveRecipesCatalogItem(item);
                                setImportJson(JSON.stringify(json, null, 2));
                                setActiveRecipeTab("editor");
                              } catch (err: unknown) {
                                setSyncStatus("error");
                                setSyncError(
                                  (err as Error).message || "Failed to load recipe JSON.",
                                );
                              }
                            }}
                          >
                            JSON
                          </Button>
                          {hwBlocked ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 text-[11px] border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                              disabled={applyingRecipePath === item.repoPath}
                              onClick={() => handleApplyCuratedRecipeAnyway(item)}
                            >
                              {applyingRecipePath === item.repoPath ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Apply anyway"
                              )}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              className="h-7 px-2.5 text-[11px] bg-electric-blue hover:bg-electric-blue-dark text-slate-950"
                              disabled={applyingRecipePath === item.repoPath}
                              onClick={() => handleApplyCuratedRecipe(item)}
                            >
                              {applyingRecipePath === item.repoPath ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Apply"
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {groupedRecipes.length === 0 && (
          <div className="p-6 text-center">
            <Search className="h-6 w-6 text-slate-700 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-400">
              {localMatchFilter === "local-only" && localModelHints
                ? "No presets match your local upload with current filters"
                : compatibilityFilter === "compatible-only" && hardwareProbe
                  ? "No presets compatible with this PC match your filters"
                  : "No Presets Match Filters"}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-[280px] mx-auto">
              {compatibilityFilter === "compatible-only" && hardwareProbe
                ? "Turn off \u201cHide incompatible\u201d or relax search and device filters."
                : localMatchFilter === "local-only" && localModelHints
                  ? "Turn off \u201cMatches only\u201d or relax search and device filters."
                  : "Try relaxing your search query or setting the category filters to default values."}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
