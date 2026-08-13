import { useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fetchOliveRecipesCatalogItem, type RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import { estimateVramForCatalogPreset } from "@/lib/presetVramEstimate";
import { formatMemoryGb } from "@/lib/vramEstimate";
import { presetDisplayName, type RecipeRow } from "@/components/features/input/useRecipeCatalog";
import { CompatStatusPill } from "@/components/features/input/CompatStatus";
import { navigatePipeline } from "@/lib/pipelineNavigation";
import type { LocalModelHints } from "@/lib/recipeModelMatch";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import { Search, Loader2, ChevronDown, DownloadCloud } from "lucide-react";

interface RecipeCatalogBrowserListProps {
  groupedRecipes: { title: string; rows: RecipeRow[] }[];
  localModelHints: LocalModelHints | null;
  hardwareProbe: HardwareProbeResult | null;
  localMatchFilter: "all" | "local-only";
  compatibilityFilter: "all" | "compatible-only";
  applyingRecipePath: string | null;
  setImportJson: (v: string) => void;
  setActiveRecipeTab: (v: "starter" | "github" | "editor") => void;
  setSyncStatus: (v: "idle" | "loading" | "success" | "error") => void;
  setSyncError: (v: string) => void;
  handleApplyCuratedRecipe: (item: RecipeCatalogItem) => void;
  handleApplyCuratedRecipeAnyway: (item: RecipeCatalogItem) => void;
}

function RecipeCatalogEmptyState({
  localMatchFilter,
  localModelHints,
  compatibilityFilter,
  hardwareProbe,
}: Pick<
  RecipeCatalogBrowserListProps,
  "localMatchFilter" | "localModelHints" | "compatibilityFilter" | "hardwareProbe"
>) {
  return (
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
  );
}

function RecipeCatalogRow({
  item,
  match,
  hardware,
  localModelHints,
  hardwareProbe,
  applyingRecipePath,
  setImportJson,
  setActiveRecipeTab,
  setSyncStatus,
  setSyncError,
  handleApplyCuratedRecipe,
  handleApplyCuratedRecipeAnyway,
}: {
  item: RecipeCatalogItem;
  match: RecipeRow["match"];
  hardware: RecipeRow["hardware"];
  localModelHints: LocalModelHints | null;
  hardwareProbe: HardwareProbeResult | null;
  applyingRecipePath: string | null;
  setImportJson: (v: string) => void;
  setActiveRecipeTab: (v: "starter" | "github" | "editor") => void;
  setSyncStatus: (v: "idle" | "loading" | "success" | "error") => void;
  setSyncError: (v: string) => void;
  handleApplyCuratedRecipe: (item: RecipeCatalogItem) => void;
  handleApplyCuratedRecipeAnyway: (item: RecipeCatalogItem) => void;
}) {
  const hwBlocked = hardware.tier === "unavailable";
  const { meta } = presetDisplayName(item.name);
  const vramEst = estimateVramForCatalogPreset(item, hardwareProbe);
  const statusParts: string[] = [];
  if (localModelHints && match?.tier === "match") statusParts.push("Matches upload");
  else if (localModelHints && match?.tier === "possible") statusParts.push("Possible match");
  if (item.metadataSource !== "recipe") statusParts.push("Approx. metadata");

  return (
    <div
      title={hardware.reason}
      className={cn("px-3 py-2 flex items-start gap-3 text-left", hwBlocked && "opacity-90")}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs font-mono text-slate-100">
            {item.device}
          </span>
          <CompatStatusPill tier={hardware.tier} />
          {meta && <span className="text-xs text-slate-400 truncate">{meta}</span>}
        </div>
        <p className="text-xs text-slate-400 mt-1 line-clamp-1">{item.description}</p>
        <p className="text-xs text-slate-400 font-mono mt-0.5">
          {vramEst.summaryLine}
          <span className="text-slate-600"> · </span>
          {item.architecture}
          {statusParts.length > 0 ? ` · ${statusParts.join(" · ")}` : ""}
        </p>
        {vramEst.fitHint && (
          <p className="text-xs text-amber-500/90 mt-0.5">{vramEst.fitHint}</p>
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
          <p className="text-xs text-rose-400/80 mt-0.5 line-clamp-1">{hardware.reason}</p>
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
              setSyncError((err as Error).message || "Failed to load recipe JSON.");
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
}

export function RecipeCatalogBrowserList({
  groupedRecipes,
  localModelHints,
  hardwareProbe,
  localMatchFilter,
  compatibilityFilter,
  applyingRecipePath,
  setImportJson,
  setActiveRecipeTab,
  setSyncStatus,
  setSyncError,
  handleApplyCuratedRecipe,
  handleApplyCuratedRecipeAnyway,
}: RecipeCatalogBrowserListProps) {
  const [expandedRecipeGroups, setExpandedRecipeGroups] = useState<Set<string>>(new Set());

  return (
    <div className="max-h-[420px] overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800/80">
      {groupedRecipes.map(({ title: modelTitle, rows }) => {
        const isExpanded = expandedRecipeGroups.has(modelTitle);
        const uniqueDevices = [...new Set(rows.map((r) => r.item.device))];
        const sizesGb = rows.map((r) => r.inferenceGb).filter((gb) => gb > 0);
        const minSizeGb = sizesGb.length ? Math.min(...sizesGb) : null;
        const maxSizeGb = sizesGb.length ? Math.max(...sizesGb) : null;
        const sizeLabel =
          minSizeGb == null || maxSizeGb == null
            ? null
            : minSizeGb === maxSizeGb
              ? `~${formatMemoryGb(minSizeGb)}`
              : `~${formatMemoryGb(minSizeGb)}–${formatMemoryGb(maxSizeGb)}`;
        return (
          <div key={modelTitle} className="bg-slate-950/20">
            <button
              type="button"
              onClick={() => {
                setExpandedRecipeGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(modelTitle)) next.delete(modelTitle);
                  else next.add(modelTitle);
                  return next;
                });
              }}
              className="sticky top-0 z-[1] w-full flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2 cursor-pointer hover:bg-slate-900/80 transition-colors text-left"
              aria-expanded={isExpanded}
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="text-sm font-semibold text-slate-100 truncate">{modelTitle}</h3>
                {sizeLabel && (
                  <span
                    className="shrink-0 text-[11px] font-mono text-slate-500"
                    title="Approximate deployed model size, smallest to largest available target"
                  >
                    {sizeLabel}
                  </span>
                )}
              </div>
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
                {rows.map(({ item, match, hardware }) => (
                  <RecipeCatalogRow
                    key={item.repoPath}
                    item={item}
                    match={match}
                    hardware={hardware}
                    localModelHints={localModelHints}
                    hardwareProbe={hardwareProbe}
                    applyingRecipePath={applyingRecipePath}
                    setImportJson={setImportJson}
                    setActiveRecipeTab={setActiveRecipeTab}
                    setSyncStatus={setSyncStatus}
                    setSyncError={setSyncError}
                    handleApplyCuratedRecipe={handleApplyCuratedRecipe}
                    handleApplyCuratedRecipeAnyway={handleApplyCuratedRecipeAnyway}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {groupedRecipes.length === 0 && (
        <RecipeCatalogEmptyState
          localMatchFilter={localMatchFilter}
          localModelHints={localModelHints}
          compatibilityFilter={compatibilityFilter}
          hardwareProbe={hardwareProbe}
        />
      )}
    </div>
  );
}
