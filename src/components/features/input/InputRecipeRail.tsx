import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import type { LocalModelHints } from "@/lib/recipeModelMatch";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import type { RecipeSortMode, RecipeRow } from "@/components/features/input/useRecipeCatalog";
import { RecipeCatalogBrowser } from "@/components/features/input/RecipeCatalogBrowser";
import { GitHubRecipeSync } from "@/components/features/input/GitHubRecipeSync";
import { RecipeJsonEditor } from "@/components/features/input/RecipeJsonEditor";
import { Activity, Globe, FileJson, ChevronUp } from "lucide-react";

export interface InputRecipeRailProps {
  activeRecipeTab: "starter" | "github" | "editor";
  setActiveRecipeTab: (v: "starter" | "github" | "editor") => void;
  visitedRecipeTabs: Set<string>;
  appliedRecipeLabel: string | null;
  setRecipeRailExpanded: (v: boolean) => void;
  recipeSearch: string;
  setRecipeSearch: (v: string) => void;
  selectedArchitecture: string;
  setSelectedArchitecture: (v: string) => void;
  selectedDevice: string;
  setSelectedDevice: (v: string) => void;
  recipeSort: RecipeSortMode;
  setRecipeSort: (v: RecipeSortMode) => void;
  hideIncompatibleRecipes: boolean;
  setHideIncompatibleRecipes: (v: boolean) => void;
  activeLocalRecipeMatchesOnly: boolean;
  setShowLocalRecipeMatchesOnly: (v: boolean) => void;
  localModelHints: LocalModelHints | null;
  localHintsLoading: boolean;
  hardwareProbe: HardwareProbeResult | null;
  hardwareProbeLoading: boolean;
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
  importJson: string;
  setImportError: (v: string | null) => void;
  importError: string | null;
  handleImport: () => void;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  repoBranch: string;
  setRepoBranch: (v: string) => void;
  repoPath: string;
  setRepoPath: (v: string) => void;
  handleFetchRemote: (opts?: { url: string; branch: string; path: string }) => Promise<void>;
  handleApplyCuratedRecipe: (item: RecipeCatalogItem) => void;
  handleApplyCuratedRecipeAnyway: (item: RecipeCatalogItem) => void;
}

export function InputRecipeRail(props: InputRecipeRailProps) {
  const {
    activeRecipeTab,
    setActiveRecipeTab,
    visitedRecipeTabs,
    appliedRecipeLabel,
    setRecipeRailExpanded,
    recipeSearch,
    setRecipeSearch,
    selectedArchitecture,
    setSelectedArchitecture,
    selectedDevice,
    setSelectedDevice,
    recipeSort,
    setRecipeSort,
    hideIncompatibleRecipes,
    setHideIncompatibleRecipes,
    activeLocalRecipeMatchesOnly,
    setShowLocalRecipeMatchesOnly,
    localModelHints,
    localHintsLoading,
    hardwareProbe,
    hardwareProbeLoading,
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
    importJson,
    setImportError,
    importError,
    handleImport,
    repoUrl,
    setRepoUrl,
    repoBranch,
    setRepoBranch,
    repoPath,
    setRepoPath,
    handleFetchRemote,
    handleApplyCuratedRecipe,
    handleApplyCuratedRecipeAnyway,
  } = props;

  return (
    <aside className="min-w-0 w-full" aria-label="Recipes" data-tour="model-source">
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
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">Sample recipe</p>
            <p className="text-xs text-slate-500">tiny-gpt2 on CPU. No download required to inspect the next steps.</p>
          </div>
          <button
            type="button"
            data-tour="tour-sample-apply"
            className="shrink-0 inline-flex items-center justify-center rounded-md bg-electric-blue px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-electric-blue-dark cursor-pointer"
            onClick={() => {
              void import("@/lib/tour").then(({ ensureTourDemoModel }) => {
                ensureTourDemoModel();
              });
            }}
          >
            Apply
          </button>
        </div>
        <Tabs
          value={activeRecipeTab}
          onValueChange={(v) => setActiveRecipeTab(v as "starter" | "github" | "editor")}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 h-auto rounded-lg p-1 bg-slate-950 border border-slate-900 mb-4">
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
              compatibilityFilter={hideIncompatibleRecipes ? "compatible-only" : "all"}
              setCompatibilityFilter={(v) => setHideIncompatibleRecipes(v === "compatible-only")}
              localMatchFilter={activeLocalRecipeMatchesOnly ? "local-only" : "all"}
              setLocalMatchFilter={(v) => setShowLocalRecipeMatchesOnly(v === "local-only")}
              localModelHints={localModelHints}
              localHintsStatus={localHintsLoading ? "loading" : localModelHints ? "ready" : "idle"}
              hardwareProbe={hardwareProbe}
              hardwareProbeStatus={hardwareProbeLoading ? "loading" : hardwareProbe ? "ready" : "idle"}
              localMatchSummary={localMatchSummary}
              hardwareMatchSummary={hardwareMatchSummary}
              curatedRecipesWithMatch={curatedRecipesWithMatch}
              groupedRecipes={groupedRecipes}
              totalPresetCount={totalPresetCount}
              localFilesCount={localFilesCount}
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
  );
}
