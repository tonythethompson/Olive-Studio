import { Suspense, lazy } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { type UIState } from "@/types";
import { cn } from "@/lib/utils";
import {
  Workflow,
  Code,
  Download,
  MoreHorizontal,
  History,
  Globe,
  RefreshCw,
} from "lucide-react";
import type { RecipeViewMode } from "./useRecipeView";

const RecipeGraphView = lazy(() => import("./recipe-graph/RecipeGraphView").then((m) => ({ default: m.RecipeGraphView })));

export interface RecipePreviewCardProps {
  recipe: Record<string, unknown>;
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  recipeView: RecipeViewMode;
  setRecipeView: (view: RecipeViewMode) => void;
  visitedRecipeViews: Set<string>;
  onExportRecipe: () => void;
  moreToolsOpen: boolean;
  setMoreToolsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  moreToolsContainerRef: React.RefObject<HTMLDivElement | null>;
  moreToolsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onOpenHistory: () => void;
  onOpenOwrExport: () => void;
}

function LoadingFallback({ label, minH }: { label: string; minH?: string }) {
  return (
    <div className="flex items-center justify-center w-full" style={minH ? { minHeight: minH } : undefined}>
      <div className="flex flex-col items-center gap-3 py-16">
        <RefreshCw className="h-5 w-5 text-electric-blue animate-spin" />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/**
 * Renders the Olive recipe definition preview with graph/json view toggle,
 * export actions, and the "More" tools menu.
 */
export function RecipePreviewCard({
  recipe,
  state,
  setState,
  recipeView,
  setRecipeView,
  visitedRecipeViews,
  onExportRecipe,
  moreToolsOpen,
  setMoreToolsOpen,
  moreToolsContainerRef,
  moreToolsTriggerRef,
  onOpenHistory,
  onOpenOwrExport,
}: RecipePreviewCardProps) {
  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden",
        recipeView === "graph" ? "min-h-[340px] wide:min-h-[380px]" : "min-h-[340px]",
      )}
    >
      <CardHeader
        className="p-3 pb-2"
        title="Olive Recipe Definition"
        description={
          recipeView === "graph"
            ? undefined
            : "The exact JSON schema that will be sent to the Olive Engine."
        }
        badge={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex bg-slate-900 border border-slate-800 rounded p-0.5"
              role="group"
              aria-label="Recipe view"
            >
              <button
                type="button"
                aria-pressed={recipeView === "graph"}
                onClick={() => setRecipeView("graph")}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${recipeView === "graph"
                  ? "bg-electric-blue text-slate-950"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                <Workflow className="h-3 w-3" /> Graph Flow
              </button>
              <button
                type="button"
                aria-pressed={recipeView === "json"}
                onClick={() => setRecipeView("json")}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${recipeView === "json"
                  ? "bg-electric-blue text-slate-950"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                <Code className="h-3 w-3" /> JSON Code
              </button>
            </div>
            <Button
              variant="outline"
              className="h-8 px-3 text-sm border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
              onClick={onExportRecipe}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export Recipe
            </Button>
            <div className="relative" ref={moreToolsContainerRef}>
              <Button
                ref={moreToolsTriggerRef}
                variant="outline"
                className="h-8 px-2.5 text-sm border-slate-700 text-slate-300 hover:border-slate-500"
                aria-expanded={moreToolsOpen}
                aria-haspopup="menu"
                onClick={() => setMoreToolsOpen((open) => !open)}
              >
                <MoreHorizontal className="h-3.5 w-3.5 mr-1" /> More
              </Button>
              {moreToolsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-slate-800 bg-slate-950 p-1 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
                    onClick={() => {
                      onOpenHistory();
                      setMoreToolsOpen(false);
                    }}
                  >
                    <History className="h-3 w-3" /> Run History
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
                    onClick={() => {
                      onOpenOwrExport();
                      setMoreToolsOpen(false);
                    }}
                  >
                    <Globe className="h-3 w-3" /> Export for OWR
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />
      {(["graph", "json"] as const).map((view) => {
        if (!visitedRecipeViews.has(view)) return null;
        const isActive = recipeView === view;
        return (
          <CardContent
            key={view}
            className={cn(
              "flex-1 overflow-hidden p-0",
              view === "graph" ? "min-h-[340px]" : "min-h-[340px]",
              isActive ? "block" : "hidden",
            )}
          >
            {view === "graph" && (
              <Suspense fallback={<LoadingFallback label="Loading graph editor..." minH="340px" />}>
                <RecipeGraphView state={state} setState={setState} />
              </Suspense>
            )}
            {view === "json" && (
              <div className="overflow-auto bg-slate-950 p-4 m-6 mt-0 rounded-lg border border-slate-800 min-h-[360px]">
                <pre className="text-sm font-mono text-emerald-400">{JSON.stringify(recipe, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        );
      })}
    </Card>
  );
}
