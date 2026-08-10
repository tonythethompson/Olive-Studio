/**
 * RecipeCatalogBrowser — Presets tab for browsing the microsoft/olive-recipes catalog.
 * Extracted from InputEnvironmentPanel (Task 5).
 */
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import type { RecipeSortMode, RecipeRow } from "@/components/features/input/useRecipeCatalog";
import type { LocalModelHints } from "@/lib/recipeModelMatch";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import { RecipeCatalogBrowserList } from "@/components/features/input/RecipeCatalogBrowserList";
import {
  RecipeCatalogFilterBar,
  RecipeCatalogHardwarePanel,
  RecipeCatalogLocalMatchPanel,
  RecipeCatalogSummaryLine,
  RecipeCatalogSyncError,
} from "@/components/features/input/RecipeCatalogBrowserPanels";

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
  syncStatus: "idle" | "loading" | "success" | "error";
  syncError: string;
  setSyncStatus: (v: "idle" | "loading" | "success" | "error") => void;
  setSyncError: (v: string) => void;
  applyingRecipePath: string | null;
  setImportJson: (v: string) => void;
  setActiveRecipeTab: (v: "starter" | "github" | "editor") => void;
  handleApplyCuratedRecipe: (item: RecipeCatalogItem) => void;
  handleApplyCuratedRecipeAnyway: (item: RecipeCatalogItem) => void;
}

export function RecipeCatalogBrowser(props: RecipeCatalogBrowserProps) {
  const {
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
  } = props;

  return (
    <>
      <RecipeCatalogSummaryLine
        curatedCount={curatedRecipesWithMatch.length}
        totalPresetCount={totalPresetCount}
        localModelHints={localModelHints}
        localHintsStatus={localHintsStatus}
        localMatchSummary={localMatchSummary}
        hardwareProbe={hardwareProbe}
        hardwareProbeStatus={hardwareProbeStatus}
        hardwareMatchSummary={hardwareMatchSummary}
      />

      <RecipeCatalogHardwarePanel
        hardwareProbe={hardwareProbe}
        hardwareProbeStatus={hardwareProbeStatus}
        hardwareMatchSummary={hardwareMatchSummary}
        compatibilityFilter={compatibilityFilter}
        setCompatibilityFilter={setCompatibilityFilter}
      />

      {syncStatus === "error" && syncError && <RecipeCatalogSyncError syncError={syncError} />}

      {localFilesCount > 0 && (
        <RecipeCatalogLocalMatchPanel
          localModelHints={localModelHints}
          localHintsStatus={localHintsStatus}
          localMatchSummary={localMatchSummary}
          localMatchFilter={localMatchFilter}
          setLocalMatchFilter={setLocalMatchFilter}
        />
      )}

      <RecipeCatalogFilterBar
        recipeSearch={recipeSearch}
        setRecipeSearch={setRecipeSearch}
        selectedArchitecture={selectedArchitecture}
        setSelectedArchitecture={setSelectedArchitecture}
        selectedDevice={selectedDevice}
        setSelectedDevice={setSelectedDevice}
        recipeSort={recipeSort}
        setRecipeSort={setRecipeSort}
      />

      <RecipeCatalogBrowserList
        groupedRecipes={groupedRecipes}
        localModelHints={localModelHints}
        hardwareProbe={hardwareProbe}
        localMatchFilter={localMatchFilter}
        compatibilityFilter={compatibilityFilter}
        applyingRecipePath={applyingRecipePath}
        setImportJson={setImportJson}
        setActiveRecipeTab={setActiveRecipeTab}
        setSyncStatus={setSyncStatus}
        setSyncError={setSyncError}
        handleApplyCuratedRecipe={handleApplyCuratedRecipe}
        handleApplyCuratedRecipeAnyway={handleApplyCuratedRecipeAnyway}
      />
    </>
  );
}
