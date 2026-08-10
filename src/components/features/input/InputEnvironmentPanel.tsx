/**
 * InputEnvironmentPanel — thin shell that orchestrates recipe tabs and model source config.
 * Sub-panels extracted per v0.2 Task 5:
 *   RecipeCatalogBrowser, GitHubRecipeSync, RecipeJsonEditor, LocalFileUpload.
 */
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
} from "@/components/ui";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { SUGGESTED_RECIPES } from "@/data/recipes";
import { cn } from "@/lib/utils";
import { buildLocalModelHints, type LocalModelHints } from "@/lib/recipeModelMatch";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { useRecipeCatalog, type RecipeSortMode } from "@/components/features/input/useRecipeCatalog";
import { useRecipeHub } from "@/components/features/input/useRecipeHub";
import { useHfToken } from "@/components/features/input/useHfToken";
import { RecipeCatalogBrowser } from "@/components/features/input/RecipeCatalogBrowser";
import { GitHubRecipeSync } from "@/components/features/input/GitHubRecipeSync";
import { RecipeJsonEditor } from "@/components/features/input/RecipeJsonEditor";
import { LocalFileUpload } from "@/components/features/input/LocalFileUpload";
import {
  DownloadCloud,
  KeyRound,
  Database,
  Search,
  HardDrive,
  Cloud,
  Loader2,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Activity,
  Globe,
  FileJson,
} from "lucide-react";

/**
 * Renders the model source configuration and Olive recipe management panel.
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

  const [localModelHints, setLocalModelHints] = useState<LocalModelHints | null>(null);
  const [localHintsLoading, setLocalHintsLoading] = useState(false);
  const [showLocalRecipeMatchesOnly, setShowLocalRecipeMatchesOnly] = useState(false);
  const [hideIncompatibleRecipes, setHideIncompatibleRecipes] = useState(true);
  const [recipeSort, setRecipeSort] = useState<RecipeSortMode>("recommended");

  const {
    localMatchSummary, hardwareMatchSummary, curatedRecipesWithMatch, groupedRecipes,
  } = useRecipeCatalog({
    recipeSearch, selectedArchitecture, selectedDevice, recipeSort,
    localModelHints, showLocalRecipeMatchesOnly, hideIncompatibleRecipes, hardwareProbe,
  });

  useEffect(() => {
    if (state.localFiles.length === 0) {
      setLocalModelHints(null);
      setLocalHintsLoading(false);
      setShowLocalRecipeMatchesOnly(false);
      return;
    }
    let cancelled = false;
    setLocalHintsLoading(true);
    void (async () => {
      const hints = buildLocalModelHints(state.localFiles.map((f) => f.name), undefined);
      if (!cancelled) { setLocalModelHints(hints); setLocalHintsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [state.localFiles]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 animate-duration-300">
      {/* SUCCESS TOAST BANNER */}
      {recipeSuccessMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm sm:text-sm font-medium">{recipeSuccessMsg}</div>
        </div>
      )}

      {/* Unified Model Source + Recipe split panel */}
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
                    Source fields below are pre-filled — edit anytime before running.
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
              <aside className="min-w-0 w-full" aria-label="Recipes">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">Recipes</h3>
                  {appliedRecipeLabel && (
                    <button
                      type="button"
                      onClick={() => setRecipeRailExpanded(false)}
                      className="flex cursor-pointer items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-slate-300"
                    >
                      <ChevronUp className="h-3 w-3" /> Collapse
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 sm:p-4 animate-in fade-in duration-200">
                  <Tabs
                    value={activeRecipeTab}
                    onValueChange={(v) => setActiveRecipeTab(v as "starter" | "github" | "editor")}
                    className="w-full"
                  >
                    <TabsList className="grid w-full grid-cols-3 h-auto rounded-lg p-1 bg-slate-950 border border-slate-900 mb-4">
                      <TabsTrigger value="starter" className="text-[11px] sm:text-sm py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer">
                        <Activity className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-electric-blue" /> Presets
                      </TabsTrigger>
                      <TabsTrigger value="github" className="text-[11px] sm:text-sm py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer">
                        <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-electric-blue" /> GitHub
                      </TabsTrigger>
                      <TabsTrigger value="editor" className="text-[11px] sm:text-sm py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer">
                        <FileJson className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-amber-400" /> JSON
                      </TabsTrigger>
                    </TabsList>

                    {/* PRESETS TAB */}
                    <TabsContent
                      value="starter"
                      {...(visitedRecipeTabs.has("starter") ? { forceMount: true as const } : {})}
                      className={cn("space-y-3 animate-in fade-in mt-0", activeRecipeTab !== "starter" && "hidden")}
                    >
                      <RecipeCatalogBrowser
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
                        showLocalRecipeMatchesOnly={showLocalRecipeMatchesOnly}
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
                        setActiveRecipeTab={setActiveRecipeTab}
                        handleApplyCuratedRecipe={handleApplyCuratedRecipe}
                        handleApplyCuratedRecipeAnyway={handleApplyCuratedRecipeAnyway}
                      />
                    </TabsContent>

                    {/* GITHUB TAB */}
                    <TabsContent
                      value="github"
                      {...(visitedRecipeTabs.has("github") ? { forceMount: true as const } : {})}
                      className={cn("space-y-3 animate-in fade-in mt-0", activeRecipeTab !== "github" && "hidden")}
                    >
                      <GitHubRecipeSync
                        repoUrl={repoUrl}
                        setRepoUrl={setRepoUrl}
                        repoBranch={repoBranch}
                        setRepoBranch={setRepoBranch}
                        repoPath={repoPath}
                        setRepoPath={setRepoPath}
                        syncStatus={syncStatus}
                        syncError={syncError}
                        handleFetchRemote={handleFetchRemote}
                      />
                    </TabsContent>

                    {/* JSON EDITOR TAB */}
                    <TabsContent
                      value="editor"
                      {...(visitedRecipeTabs.has("editor") ? { forceMount: true as const } : {})}
                      className={cn("space-y-3 animate-in fade-in mt-0", activeRecipeTab !== "editor" && "hidden")}
                    >
                      <RecipeJsonEditor
                        importJson={importJson}
                        setImportJson={setImportJson}
                        importError={importError}
                        setImportError={setImportError}
                        handleImport={handleImport}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              </aside>
            )}

            {/* Source config section */}
            <div className="min-w-0 w-full">
              {!sourceConfigExpanded && !recipeRailCollapsed ? (
                <button
                  type="button"
                  onClick={() => setSourceConfigExpanded(true)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-3 text-left transition-colors hover:border-electric-blue/40 hover:bg-slate-950/70 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                      <DownloadCloud className="h-3.5 w-3.5 text-electric-blue" />
                      Configure model source
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Optional custom path: Hugging Face, local files, or Azure ML. Prefer a recipe preset above when you can.
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-400 flex items-center gap-1.5">
                      <DownloadCloud className="h-3.5 w-3.5 text-electric-blue" /> Source config
                    </h3>
                    {!recipeRailCollapsed && (
                      <button
                        type="button"
                        onClick={() => setSourceConfigExpanded(false)}
                        className="flex cursor-pointer items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-slate-300"
                      >
                        <ChevronUp className="h-3 w-3" /> Hide
                      </button>
                    )}
                  </div>

                  {appliedRecipeLabel && (
                    <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm text-slate-300">
                      <span className="text-emerald-400 font-semibold">From recipe:</span> {appliedRecipeLabel}
                      <span className="text-slate-500"> · </span>
                      <span className="font-mono text-xs text-slate-400">
                        {state.modelSource === "huggingface" && state.hfModelId
                          ? `HF · ${state.hfModelId}`
                          : state.modelSource === "local"
                            ? `Local · ${state.localFiles.length} file(s)`
                            : state.modelSource === "azure" && state.azureModelPath
                              ? `Azure · ${state.azureModelPath}`
                              : state.modelSource}
                      </span>
                    </div>
                  )}

                  <Tabs
                    value={state.modelSource}
                    onValueChange={(v) => setState({ modelSource: v as UIState["modelSource"] })}
                    className="w-full"
                  >
                    <TabsList className="mb-6 !grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1.5">
                      <TabsTrigger value="huggingface" title="Hugging Face Hub" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                        <DownloadCloud className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Hugging Face</span>
                      </TabsTrigger>
                      <TabsTrigger value="local" title="Local Machine" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                        <HardDrive className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Local</span>
                      </TabsTrigger>
                      <TabsTrigger value="azure" title="Azure ML Model" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                        <Cloud className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Azure ML</span>
                      </TabsTrigger>
                    </TabsList>

                    {/* Hugging Face source tab */}
                    <TabsContent value="huggingface" className="space-y-6 animate-in fade-in">
                      <div className="grid gap-3">
                        <Label htmlFor="modelId">Hugging Face Model ID</Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <Input id="modelId" placeholder="e.g. meta-llama/Llama-2-7b-hf" className="pl-9" value={state.hfModelId} onChange={(e) => setState({ hfModelId: e.target.value })} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-xs text-slate-500 mr-1">Quick Select:</span>
                          {[
                            { label: "Meta-Llama-3", id: "meta-llama/Meta-Llama-3-8B" },
                            { label: "Phi-3 Mini", id: "microsoft/Phi-3-mini-4k-instruct" },
                            { label: "Whisper Large V3", id: "openai/whisper-large-v3" },
                            { label: "Stable Diffusion XL", id: "stabilityai/stable-diffusion-xl-base-1.0" },
                            { label: "BERT Base", id: "bert-base-uncased" },
                          ].map((m) => (
                            <button key={m.id} type="button" onClick={() => setState({ hfModelId: m.id })} className="text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer">
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* HuggingFace Token */}
                      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Label className="flex items-center gap-1.5 mb-0">
                            <KeyRound className="h-3.5 w-3.5 text-amber-400" /> HuggingFace Token
                          </Label>
                          {hfTokenStatus === "loading" && <span className="text-[11px] text-slate-500 font-mono">Checking...</span>}
                          {hfTokenStatus === "environment" && <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">✓ Found in environment</span>}
                          {hfTokenStatus === "runtime" && <span className="text-[11px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono font-semibold">✓ Set for this session</span>}
                          {hfTokenStatus === "none" && <span className="text-[11px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-mono">Not set — required for gated models</span>}
                          {hfTokenStatus === "error" && <span className="text-[11px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-mono">Couldn&apos;t check token status</span>}
                        </div>
                        {hfTokenStatus !== "environment" && hfTokenStatus !== "loading" && (
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                              <input type="password" placeholder="hf_..." autoComplete="off" className="w-full pl-9 pr-3 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-electric-blue rounded-md font-mono text-sm text-slate-200 placeholder:text-slate-600 outline-none" value={hfTokenInput} onChange={(e) => setHfTokenInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmitToken()} disabled={isTokenMutating} />
                            </div>
                            <Button type="button" onClick={handleSubmitToken} disabled={!hfTokenInput.trim() || isTokenMutating} className="h-9 px-4 text-sm bg-electric-blue hover:bg-electric-blue/90 text-slate-950 font-bold">
                              {submitTokenMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </Button>
                            {hfTokenStatus === "runtime" && (
                              <Button type="button" variant="outline" onClick={handleClearToken} disabled={isTokenMutating} className="h-9 px-3 text-sm border-red-500/30 text-red-400 hover:bg-red-500/10">
                                {clearTokenMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Clear"}
                              </Button>
                            )}
                          </div>
                        )}
                        {clearTokenMutation.isError && <p role="alert" className="text-[11px] text-rose-400">Couldn&apos;t clear the token — try again.</p>}
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Stored in server memory only — never written to disk or returned to the client. Set <code className="text-slate-400 font-mono">HF_TOKEN</code> in environment variables for persistent access.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="grid gap-3">
                          <Label htmlFor="hf-task-type">Task Type</Label>
                          <Select id="hf-task-type" aria-label="Hugging Face task type" value={state.hfTask || ""} onChange={(e) => setState({ hfTask: e.target.value })}>
                            <option value="">Auto (from model id)</option>
                            <option value="text-generation">Text Generation</option>
                            <option value="feature-extraction">Feature Extraction</option>
                            <option value="text-classification">Text Classification</option>
                            <option value="fill-mask">Fill Mask</option>
                            <option value="text2text-generation">Text2Text Generation</option>
                            <option value="automatic-speech-recognition">Automatic Speech Recognition</option>
                            <option value="image-classification">Image Classification</option>
                            <option value="object-detection">Object Detection</option>
                            <option value="sentence-similarity">Sentence Similarity</option>
                            <option value="conversational">Conversational</option>
                          </Select>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Written into Olive <code className="font-mono text-slate-400">input_model.config.task</code>. Embedding models (GTE, BGE, E5) should use Feature Extraction.
                          </p>
                        </div>
                        <div className="grid gap-3">
                          <Label htmlFor="dataset">Calibration Dataset (Optional)</Label>
                          <Input id="dataset" placeholder="e.g. wikitext" value={state.hfDataset} onChange={(e) => setState({ hfDataset: e.target.value })} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="grid gap-3">
                          <Label htmlFor="user-script">User Script Path (Optional)</Label>
                          <Input id="user-script" placeholder="e.g. ./user_script.py" value={state.userScript || ""} onChange={(e) => setState({ userScript: e.target.value || undefined })} />
                          <p className="text-[11px] text-slate-500 leading-relaxed">Path to a Python script with eval/calibration functions required by some optimization passes.</p>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Local source tab */}
                    <TabsContent value="local" className="animate-in fade-in">
                      <LocalFileUpload state={state} setState={setState} />
                    </TabsContent>

                    {/* Azure source tab */}
                    <TabsContent value="azure" className="space-y-6 animate-in fade-in">
                      <div className="grid gap-3">
                        <Label htmlFor="azureModel">Azure ML Workspace Path</Label>
                        <div className="relative">
                          <Cloud className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <Input id="azureModel" placeholder="azureml://subscriptions/.../models/my-model/versions/1" className="pl-9 font-mono text-sm" value={state.azureModelPath} onChange={(e) => setState({ azureModelPath: e.target.value })} />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shared Cache & Azure Infrastructure Options */}
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
