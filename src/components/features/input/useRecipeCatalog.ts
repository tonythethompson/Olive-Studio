/**
 * Hook encapsulating recipe catalog filtering, sorting, and grouping logic.
 * Extracted from InputEnvironmentPanel to reduce its complexity.
 */
import { useMemo, useState, useEffect } from "react";
import { SUGGESTED_RECIPES, loadSuggestedRecipes } from "@/data/recipes";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import { isNvTensorRtRtxCatalogPath } from "@/lib/tensorrtRtxDeps";
import {
  assessCatalogItemHardwareCompatibility,
  summarizeRecipeHardwareCompatibility,
} from "@/lib/recipeHardwareCompatibility";
import {
  scoreRecipeMatchForLocal,
  summarizeLocalRecipeMatches,
  type LocalModelHints,
} from "@/lib/recipeModelMatch";
import { estimateVramForCatalogPreset } from "@/lib/presetVramEstimate";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

export type RecipeSortMode = "recommended" | "name-asc" | "name-desc" | "size-asc" | "size-desc";

export interface RecipeRow {
  item: RecipeCatalogItem;
  match: ReturnType<typeof scoreRecipeMatchForLocal> | null;
  hardware: ReturnType<typeof assessCatalogItemHardwareCompatibility>;
  modelTitle: string;
  inferenceGb: number;
}

export interface RecipeGroup {
  title: string;
  rows: RecipeRow[];
}

/**
 * Splits a preset name into its primary title and supplemental metadata.
 */
export function presetDisplayName(name: string): { title: string; meta: string } {
  const parts = name
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts[0], meta: parts.slice(1).join(" · ") };
  }
  return { title: name, meta: "" };
}

export interface UseRecipeCatalogOpts {
  recipeSearch: string;
  selectedArchitecture: string;
  selectedDevice: string;
  recipeSort: RecipeSortMode;
  localModelHints: LocalModelHints | null;
  showLocalRecipeMatchesOnly: boolean;
  hideIncompatibleRecipes: boolean;
  hardwareProbe: HardwareProbeResult | null;
}

export function useRecipeCatalog(opts: UseRecipeCatalogOpts) {
  const {
    recipeSearch,
    selectedArchitecture,
    selectedDevice,
    recipeSort,
    localModelHints,
    showLocalRecipeMatchesOnly,
    hideIncompatibleRecipes,
    hardwareProbe,
  } = opts;

  // SUGGESTED_RECIPES is mutated in-place after an async dynamic import.
  // This state toggle forces a re-render when the catalog finishes loading.
  const [catalogReady, setCatalogReady] = useState(SUGGESTED_RECIPES.length > 0);
  useEffect(() => {
    if (catalogReady) return;
    let cancelled = false;
    loadSuggestedRecipes().then(() => {
      if (!cancelled) setCatalogReady(true);
    });
    return () => { cancelled = true; };
  }, [catalogReady]);

  const filteredRecipes = (() => {
    const query = recipeSearch.toLowerCase();
    return SUGGESTED_RECIPES.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.repoPath.toLowerCase().includes(query);
      const matchesArch = selectedArchitecture === "All" || item.architecture === selectedArchitecture;
      const matchesDev =
        selectedDevice === "All" ||
        item.device === selectedDevice ||
        (selectedDevice === "TensorRT RTX" && isNvTensorRtRtxCatalogPath(item.repoPath));
      return matchesSearch && matchesArch && matchesDev;
    });
  })();

  const localMatchSummary = useMemo(
    () => (localModelHints ? summarizeLocalRecipeMatches(localModelHints, SUGGESTED_RECIPES) : null),
    // catalogReady isn't read in the body, but SUGGESTED_RECIPES mutates in
    // place (see above) so its reference never changes — this dep is the
    // only way useMemo notices the catalog finished loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localModelHints, catalogReady],
  );

  const hardwareMatchSummary = useMemo(
    () => (hardwareProbe ? summarizeRecipeHardwareCompatibility(SUGGESTED_RECIPES, hardwareProbe) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see localMatchSummary above
    [hardwareProbe, catalogReady],
  );

  const curatedRecipesWithMatch: RecipeRow[] = useMemo(() => {
    let rows = filteredRecipes;
    if (localModelHints && showLocalRecipeMatchesOnly) {
      rows = rows.filter((item) => scoreRecipeMatchForLocal(localModelHints, item).tier !== "none");
    }
    if (hideIncompatibleRecipes && hardwareProbe) {
      rows = rows.filter(
        (item) => assessCatalogItemHardwareCompatibility(item, hardwareProbe).tier !== "unavailable",
      );
    }

    const decorated: RecipeRow[] = rows.map((item) => ({
      item,
      match: localModelHints ? scoreRecipeMatchForLocal(localModelHints, item) : null,
      hardware: assessCatalogItemHardwareCompatibility(item, hardwareProbe),
      modelTitle: presetDisplayName(item.name).title,
      inferenceGb: estimateVramForCatalogPreset(item, hardwareProbe).inferenceGb,
    }));

    decorated.sort((a, b) => {
      if (recipeSort === "name-asc" || recipeSort === "name-desc") {
        const byTitle = a.modelTitle.localeCompare(b.modelTitle, undefined, { sensitivity: "base" });
        if (byTitle !== 0) return recipeSort === "name-asc" ? byTitle : -byTitle;
        const byName = a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
        return recipeSort === "name-asc" ? byName : -byName;
      }

      if (recipeSort === "size-asc" || recipeSort === "size-desc") {
        const bySize = a.inferenceGb - b.inferenceGb;
        if (bySize !== 0) return recipeSort === "size-asc" ? bySize : -bySize;
        return a.modelTitle.localeCompare(b.modelTitle, undefined, { sensitivity: "base" });
      }

      // Default: recommended (hardware-first, then match score)
      const hwOrder = { compatible: 0, unknown: 1, unavailable: 2 } as const;
      const hwDiff = hwOrder[a.hardware.tier] - hwOrder[b.hardware.tier];
      if (hwDiff !== 0) return hwDiff;
      return (b.match?.score ?? -1) - (a.match?.score ?? -1);
    });

    return decorated;
  }, [filteredRecipes, localModelHints, showLocalRecipeMatchesOnly, hideIncompatibleRecipes, hardwareProbe, recipeSort]);

  const groupedRecipes: RecipeGroup[] = useMemo(() => {
    const groups = new Map<string, RecipeGroup>();
    for (const row of curatedRecipesWithMatch) {
      const title = row.modelTitle;
      const existing = groups.get(title);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.set(title, { title, rows: [row] });
      }
    }
    return [...groups.values()];
  }, [curatedRecipesWithMatch]);

  return {
    filteredRecipes,
    localMatchSummary,
    hardwareMatchSummary,
    curatedRecipesWithMatch,
    groupedRecipes,
  };
}
