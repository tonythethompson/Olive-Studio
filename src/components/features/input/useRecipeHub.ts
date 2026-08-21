/**
 * Hook encapsulating Recipe Hub state and handlers (fetch, import, apply, tab management).
 * Extracted from InputEnvironmentPanel to reduce its complexity (#157).
 */
import { useRef, useState, useTransition } from "react";
import type { UIState } from "@/types";
import {
  compareCatalogMetadataToRecipe,
  deriveUiStateFromOliveRecipe,
  fetchGitHubRecipeJson,
  fetchOliveRecipesCatalogItem,
  getCatalogDeviceFromRecipe,
  getRecipesBranch,
  OLIVE_RECIPES_REPO,
  type RecipeCatalogItem,
} from "@/lib/oliveRecipeHub";
import { parseRecipeJson } from "@/lib/recipePipeline";
import {
  assessCatalogItemHardwareCompatibility,
  assessRecipeHardwareCompatibility,
} from "@/lib/recipeHardwareCompatibility";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

export type RecipeTab = "starter" | "github" | "editor";

export interface UseRecipeHubOpts {
  setState: (s: Partial<UIState>) => void;
  hardwareProbe: HardwareProbeResult | null;
}

export function useRecipeHub({ setState, hardwareProbe }: UseRecipeHubOpts) {
  const [recipeSearch, setRecipeSearch] = useState("");
  const [selectedArchitecture, setSelectedArchitecture] = useState<string>("All");
  const [selectedDevice, setSelectedDevice] = useState<string>("All");
  const [syncStatus, setSyncStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [repoUrl, setRepoUrl] = useState(`https://github.com/${OLIVE_RECIPES_REPO}`);
  const [repoBranch, setRepoBranch] = useState(getRecipesBranch);
  const [repoPath, setRepoPath] = useState(
    "Qwen-Qwen2.5-1.5B-Instruct/NvTensorRtRtx/Qwen2.5-1.5B-Instruct_model_builder_fp16.json",
  );
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [activeRecipeTab, setActiveRecipeTabRaw] = useState<RecipeTab>("starter");
  const [visitedRecipeTabs, setVisitedRecipeTabs] = useState<Set<string>>(new Set(["starter"]));
  const [, startRecipeTabTransition] = useTransition();
  const setActiveRecipeTab = (tab: RecipeTab) => {
    startRecipeTabTransition(() => {
      setActiveRecipeTabRaw(tab);
      setVisitedRecipeTabs((prev) => {
        if (prev.has(tab)) return prev;
        return new Set(prev).add(tab);
      });
    });
  };
  const [recipeSuccessMsg, setRecipeSuccessMsg] = useState<string | null>(null);
  const [applyingRecipePath, setApplyingRecipePath] = useState<string | null>(null);
  const [appliedRecipeLabel, setAppliedRecipeLabel] = useState<string | null>(null);
  const [recipeRailExpanded, setRecipeRailExpanded] = useState(true);
  const [sourceConfigExpanded, setSourceConfigExpanded] = useState(false);
  const applyRequestRef = useRef(0);

  const recipeRailCollapsed = Boolean(appliedRecipeLabel) && !recipeRailExpanded;

  const applyCuratedRecipe = async (item: RecipeCatalogItem, options?: { allowIncompatible?: boolean }) => {
    const requestId = ++applyRequestRef.current;
    setApplyingRecipePath(item.repoPath);
    setSyncStatus("idle");
    setSyncError("");
    try {
      const json = await fetchOliveRecipesCatalogItem(item);
      if (requestId !== applyRequestRef.current) return;
      const metadata = compareCatalogMetadataToRecipe(item, json);
      const hw = assessCatalogItemHardwareCompatibility(item, hardwareProbe, json);
      if (hw.tier === "unavailable" && !options?.allowIncompatible) {
        setSyncStatus("error");
        setSyncError(
          `Recipe targets ${hw.targetDevice} but this machine cannot run it. ${hw.reason} Use "Apply anyway" only for remote or cross-compile workflows.`,
        );
        return;
      }
      setState(deriveUiStateFromOliveRecipe(json, { replacePasses: true }));
      setAppliedRecipeLabel(item.name);
      setRecipeRailExpanded(false);
      setSourceConfigExpanded(true);
      setImportJson(JSON.stringify(json, null, 2));
      setImportError(null);
      const mismatchNote =
        !metadata.matches && metadata.recipeDevice
          ? ` Catalog device (${metadata.catalogDevice}) differs from recipe EP (${metadata.recipeDevice}).`
          : "";
      const approximateNote = item.metadataSource !== "recipe" ? " Tags are folder-inferred (approximate)." : "";
      const hwNote =
        hw.tier === "unavailable"
          ? " Applied despite missing local hardware (cross-compile / remote target)."
          : hw.tier === "compatible"
            ? ` Verified for ${hw.targetDevice} on this machine.`
            : "";
      setRecipeSuccessMsg(`Applied preset recipe: "${item.name}"!${approximateNote}${mismatchNote}${hwNote}`);
      setTimeout(() => { setRecipeSuccessMsg(null); }, 5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (requestId !== applyRequestRef.current) return;
      setSyncStatus("error");
      setSyncError(err.message || "Failed to load recipe from GitHub.");
    } finally {
      if (requestId === applyRequestRef.current) setApplyingRecipePath(null);
    }
  };

  const handleApplyCuratedRecipe = (item: RecipeCatalogItem) => applyCuratedRecipe(item);
  const handleApplyCuratedRecipeAnyway = (item: RecipeCatalogItem) =>
    applyCuratedRecipe(item, { allowIncompatible: true });

  /**
   * Clears the applied-recipe lock-in so the user can start over from the
   * catalog or a custom model source. An applied recipe sets `appliedRecipeLabel`
   * and collapses the rail with no way to dismiss it; clearing the model fields
   * alone leaves the "Applied recipe" banner stuck on the old model (e.g. the
   * tiny-gpt2 sample from issue #387). This resets both.
   */
  const handleClearRecipe = () => {
    setState({ hfModelId: "", hfDataset: "", hfTask: "", localFiles: [], azureModelPath: "" });
    setAppliedRecipeLabel(null);
    setRecipeRailExpanded(true);
    setSourceConfigExpanded(true);
    setImportJson("");
    setImportError(null);
    setSyncStatus("idle");
    setSyncError("");
    setRecipeSuccessMsg("Recipe cleared — choose a preset above or configure a custom model.");
    setTimeout(() => setRecipeSuccessMsg(null), 5000);
  };

  const handleFetchRemote = async (overrides?: { url?: string; branch?: string; path?: string }) => {
    const url = (overrides?.url ?? repoUrl).trim();
    const branch = (overrides?.branch ?? repoBranch).trim() || "main";
    const path = (overrides?.path ?? repoPath).trim();
    if (overrides?.url !== undefined) setRepoUrl(overrides.url);
    if (overrides?.branch !== undefined) setRepoBranch(overrides.branch);
    if (overrides?.path !== undefined) setRepoPath(overrides.path);
    if (!url) { setSyncStatus("error"); setSyncError("GitHub repository URL is required."); return; }
    if (!path) { setSyncStatus("error"); setSyncError("Recipe path is required."); return; }
    setSyncStatus("loading");
    setSyncError("");
    try {
      const { json } = await fetchGitHubRecipeJson(url, branch, path);
      setImportJson(JSON.stringify(json, null, 2));
      setImportError(null);
      setSyncStatus("success");
      setRecipeSuccessMsg("Downloaded remote recipe payload! Inspect in Editor tab.");
      setTimeout(() => setRecipeSuccessMsg(null), 4000);
      setActiveRecipeTab("editor");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(err);
      setSyncStatus("error");
      setSyncError(err.message || "Failed to download remote file. Check connection URL.");
    }
  };

  const handleImport = (allowIncompatible = false) => {
    const { recipe, schema } = parseRecipeJson(importJson);
    if (!schema.valid) { setImportError(`Recipe structure invalid:\n- ${schema.errors.join("\n- ")}`); return; }
    const targetDevice = getCatalogDeviceFromRecipe(recipe) ?? "CPU";
    const hw = assessRecipeHardwareCompatibility(targetDevice, hardwareProbe);
    if (hw.tier === "unavailable" && !allowIncompatible) {
      setImportError(`Recipe targets ${hw.targetDevice} but this machine cannot run it.\n${hw.reason}\nUse "Apply anyway" for remote/cross-compile workflows.`);
      return;
    }
    try {
      setState(deriveUiStateFromOliveRecipe(recipe, { replacePasses: true }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to apply imported recipe.");
      return;
    }
    setAppliedRecipeLabel("Custom JSON recipe");
    setRecipeRailExpanded(false);
    setSourceConfigExpanded(true);
    setImportError(null);
    setRecipeSuccessMsg(
      hw.tier === "unavailable"
        ? "Recipe applied (incompatible hardware \u2014 remote/cross-compile target)."
        : "Recipe parsed and applied successfully!",
    );
    setTimeout(() => setRecipeSuccessMsg(null), 4000);
  };

  return {
    recipeSearch, setRecipeSearch,
    selectedArchitecture, setSelectedArchitecture,
    selectedDevice, setSelectedDevice,
    syncStatus, setSyncStatus, syncError, setSyncError,
    repoUrl, setRepoUrl, repoBranch, setRepoBranch, repoPath, setRepoPath,
    importJson, setImportJson, importError, setImportError,
    activeRecipeTab, setActiveRecipeTab, visitedRecipeTabs,
    recipeSuccessMsg, setRecipeSuccessMsg, applyingRecipePath, appliedRecipeLabel,
    recipeRailExpanded, setRecipeRailExpanded,
    sourceConfigExpanded, setSourceConfigExpanded,
    recipeRailCollapsed,
    handleApplyCuratedRecipe, handleApplyCuratedRecipeAnyway,
    handleClearRecipe,
    handleFetchRemote, handleImport,
  };
}
