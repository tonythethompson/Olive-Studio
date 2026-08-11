/**
 * InputEnvironmentPanel — thin shell that orchestrates recipe tabs and model source config.
 * Sub-panels extracted per v0.2 Task 5:
 *   InputRecipeRail, InputModelSourceSection, LocalFileUpload.
 */
import { useState, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  Button,
} from "@/components/ui";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { SUGGESTED_RECIPES } from "@/data/recipes";
import { buildLocalModelHints, type LocalModelHints } from "@/lib/recipeModelMatch";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { useRecipeCatalog, type RecipeSortMode } from "@/components/features/input/useRecipeCatalog";
import { useRecipeHub } from "@/components/features/input/useRecipeHub";
import { useHfToken } from "@/components/features/input/useHfToken";
import { InputModelSourceSection } from "@/components/features/input/InputModelSourceSection";
import { InputRecipeRail } from "@/components/features/input/InputRecipeRail";
import {
  Database,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

/**
 * Configures recipe selection, model sources, and shared cache and infrastructure settings.
 *
 * @param state - Optional UI state override.
 * @param setState - Optional handler for updating UI state.
 */
export function InputEnvironmentPanel({
  state: propState,
  setState: propSetState,
}: {
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
} = {}) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;

  const {
    hfTokenInput, setHfTokenInput, hfTokenStatus,
    submitTokenMutation, clearTokenMutation, isTokenMutating,
    handleSubmitToken, handleClearToken,
  } = useHfToken();

  const { data: hardwareProbe = null, isLoading: hardwareProbeLoading } = useHardwareProbe();
  const {
    recipeSearch, setRecipeSearch, selectedArchitecture, setSelectedArchitecture,
    selectedDevice, setSelectedDevice, syncStatus, setSyncStatus, syncError, setSyncError,
    repoUrl, setRepoUrl, repoBranch, setRepoBranch, repoPath, setRepoPath,
    importJson, setImportJson, importError, setImportError,
    activeRecipeTab, setActiveRecipeTab, visitedRecipeTabs,
    recipeSuccessMsg, applyingRecipePath, appliedRecipeLabel,
    setRecipeRailExpanded,
    sourceConfigExpanded, setSourceConfigExpanded,
    recipeRailCollapsed,
    handleApplyCuratedRecipe, handleApplyCuratedRecipeAnyway,
    handleFetchRemote, handleImport,
  } = useRecipeHub({ setState, hardwareProbe });

  const [configText, setConfigText] = useState<string | undefined>();
  const [configTextStatus, setConfigTextStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [showLocalRecipeMatchesOnly, setShowLocalRecipeMatchesOnly] = useState(false);
  const [hideIncompatibleRecipes, setHideIncompatibleRecipes] = useState(true);
  const [recipeSort, setRecipeSort] = useState<RecipeSortMode>("recommended");

  const handleConfigTextChange = useCallback(
    (text: string | undefined, status: "idle" | "loading" | "ready") => {
      setConfigText(text);
      setConfigTextStatus(status);
    },
    [],
  );

  const localModelHints = useMemo<LocalModelHints | null>(() => {
    if (state.localFiles.length === 0) return null;
    return buildLocalModelHints(
      state.localFiles.map((f) => f.name),
      configText,
    );
  }, [state.localFiles, configText]);

  const localHintsLoading = configTextStatus === "loading";
  const activeLocalRecipeMatchesOnly =
    state.localFiles.length > 0 && showLocalRecipeMatchesOnly;

  const {
    localMatchSummary, hardwareMatchSummary, curatedRecipesWithMatch, groupedRecipes,
  } = useRecipeCatalog({
    recipeSearch, selectedArchitecture, selectedDevice, recipeSort,
    localModelHints, showLocalRecipeMatchesOnly: activeLocalRecipeMatchesOnly, hideIncompatibleRecipes, hardwareProbe,
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 animate-duration-300">
      {recipeSuccessMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm sm:text-sm font-medium">{recipeSuccessMsg}</div>
        </div>
      )}

      <Card className="border-slate-800/80">
        <CardHeader
          title="Recipes & model source"
          description="Start from an Olive recipe preset. Configure Hugging Face, local, or Azure sources when you need a custom model."
        />
        <CardContent>
          {recipeRailCollapsed && (
            <div className="mb-6 flex flex-col gap-3 rounded border border-electric-blue/25 bg-electric-blue/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-electric-blue/15 text-electric-blue">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-electric-blue font-medium">Applied recipe</p>
                  <p className="truncate text-sm font-semibold text-slate-200" title={appliedRecipeLabel ?? undefined}>
                    {appliedRecipeLabel}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Source fields below are pre-filled. Edit anytime before running.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                className="h-8 shrink-0 self-start px-3 text-xs bg-electric-blue hover:bg-electric-blue-dark text-slate-950 sm:self-center"
                onClick={() => { setRecipeRailExpanded(true); setActiveRecipeTab("starter"); }}
              >
                Change recipe
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {!recipeRailCollapsed && (
              <InputRecipeRail
                activeRecipeTab={activeRecipeTab}
                setActiveRecipeTab={setActiveRecipeTab}
                visitedRecipeTabs={visitedRecipeTabs}
                appliedRecipeLabel={appliedRecipeLabel}
                setRecipeRailExpanded={setRecipeRailExpanded}
                recipeSearch={recipeSearch}
                setRecipeSearch={setRecipeSearch}
                selectedArchitecture={selectedArchitecture}
                setSelectedArchitecture={setSelectedArchitecture}
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                recipeSort={recipeSort}
                setRecipeSort={setRecipeSort}
                hideIncompatibleRecipes={hideIncompatibleRecipes}
                setHideIncompatibleRecipes={setHideIncompatibleRecipes}
                activeLocalRecipeMatchesOnly={activeLocalRecipeMatchesOnly}
                setShowLocalRecipeMatchesOnly={setShowLocalRecipeMatchesOnly}
                localModelHints={localModelHints}
                localHintsLoading={localHintsLoading}
                hardwareProbe={hardwareProbe}
                hardwareProbeLoading={hardwareProbeLoading}
                localMatchSummary={localMatchSummary}
                hardwareMatchSummary={hardwareMatchSummary}
                curatedRecipesWithMatch={curatedRecipesWithMatch}
                groupedRecipes={groupedRecipes}
                totalPresetCount={SUGGESTED_RECIPES.length}
                localFilesCount={state.localFiles.length}
                syncStatus={syncStatus}
                syncError={syncError}
                setSyncStatus={setSyncStatus}
                setSyncError={setSyncError}
                applyingRecipePath={applyingRecipePath}
                setImportJson={setImportJson}
                importJson={importJson}
                setImportError={setImportError}
                importError={importError}
                handleImport={handleImport}
                repoUrl={repoUrl}
                setRepoUrl={setRepoUrl}
                repoBranch={repoBranch}
                setRepoBranch={setRepoBranch}
                repoPath={repoPath}
                setRepoPath={setRepoPath}
                handleFetchRemote={handleFetchRemote}
                handleApplyCuratedRecipe={handleApplyCuratedRecipe}
                handleApplyCuratedRecipeAnyway={handleApplyCuratedRecipeAnyway}
              />
            )}

            <InputModelSourceSection
              state={state}
              setState={setState}
              appliedRecipeLabel={appliedRecipeLabel}
              recipeRailCollapsed={recipeRailCollapsed}
              sourceConfigExpanded={sourceConfigExpanded}
              setSourceConfigExpanded={setSourceConfigExpanded}
              hfTokenInput={hfTokenInput}
              setHfTokenInput={setHfTokenInput}
              hfTokenStatus={hfTokenStatus}
              isTokenMutating={isTokenMutating}
              submitTokenMutation={submitTokenMutation}
              clearTokenMutation={clearTokenMutation}
              handleSubmitToken={handleSubmitToken}
              handleClearToken={handleClearToken}
              onConfigTextChange={handleConfigTextChange}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Shared Cache & Infrastructure Settings"
          description="Configure enterprise caching to minimize redundant processing."
          badge={
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-electric-blue/10 text-electric-blue">
              <Database className="h-4 w-4" />
            </div>
          }
        />
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-3">
              <Label htmlFor="cacheDir">Local Cache Directory</Label>
              <Input id="cacheDir" placeholder="~/.cache/olive" value={state.cacheDir} onChange={(e) => setState({ cacheDir: e.target.value })} />
            </div>
            <div className="grid gap-3">
              <Label htmlFor="azureStr">Azure Blob Connection String</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input id="azureStr" type="password" placeholder="DefaultEndpointsProtocol=https;AccountName=..." className="pl-9 font-mono text-sm" value={state.azureStr} onChange={(e) => setState({ azureStr: e.target.value })} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
