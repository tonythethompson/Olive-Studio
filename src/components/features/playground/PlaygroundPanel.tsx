import { useMemo, useState, useTransition, lazy, Suspense, useRef, type KeyboardEvent } from "react";
import { RefreshCw, Globe, Gauge, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePlaygroundStore, type PlaygroundSubView } from "@/lib/stores/playgroundStore";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { buildRecipeJsonFromState } from "@/lib/recipePipeline";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { mapExecutionProviderFromRecipe } from "@/lib/oliveRecipeHub";

/* ------------------------------------------------------------------ */
/*  Lazy sub-view imports                                               */
/* ------------------------------------------------------------------ */

const InBrowserValidation = lazy(() =>
  import("./InBrowserValidation").then((m) => ({ default: m.InBrowserValidation })),
);

const WebGpuBenchmarkPanel = lazy(() =>
  import("./WebGpuBenchmarkPanel").then((m) => ({ default: m.WebGpuBenchmarkPanel })),
);

const ArenaPanel = lazy(() =>
  import("./ArenaPanel").then((m) => ({ default: m.ArenaPanel })),
);

/* ------------------------------------------------------------------ */
/*  Sub-view tab definitions                                            */
/* ------------------------------------------------------------------ */

const SUB_VIEWS: {
  id: PlaygroundSubView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "browser-test", label: "Browser Test", icon: Globe },
  { id: "benchmark", label: "Benchmark", icon: Gauge },
  { id: "arena", label: "Arena", icon: Swords },
];

/* ------------------------------------------------------------------ */
/*  Loading fallback                                                    */
/* ------------------------------------------------------------------ */

function LoadingFallback({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center w-full min-h-[320px]">
      <div className="flex flex-col items-center gap-3 py-16">
        <span className="animate-spin">
          <RefreshCw className="h-5 w-5 text-electric-blue" />
        </span>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PlaygroundPanel                                                     */
/* ------------------------------------------------------------------ */

function isWebGpuRecipe(recipeJson: string): boolean {
  return mapExecutionProviderFromRecipe(recipeJson) === "WebGpuExecutionProvider";
}

export function PlaygroundPanel() {
  const activeSubView = usePlaygroundStore((s) => s.activeSubView);
  const setActiveSubView = usePlaygroundStore((s) => s.setActiveSubView);
  const capturedRunRecipe = usePlaygroundStore((s) => s.capturedRunRecipe);
  const { state } = usePipelineState();
  // Memoize captured WebGPU recipe check so JSON parsing doesn't re-run on frequent pipeline state edits.
  const isCapturedWebGpu = useMemo(() => {
    return Boolean(capturedRunRecipe && isWebGpuRecipe(capturedRunRecipe));
  }, [capturedRunRecipe]);

  // Use the recipe from the last successful Execute run if available (preserves context even if
  // user modifies state afterward). Fallback to building from current state for manual Browser Test.
  // Only pass recipe if provider is WebGPU; other providers should not show this hint.
  const recipeJson = useMemo(() => {
    if (isCapturedWebGpu && capturedRunRecipe) return capturedRunRecipe;
    return undefined;
  }, [isCapturedWebGpu, capturedRunRecipe]);

  // Rebuild recipe from state only if no captured WebGPU recipe is available
  const fallbackRecipeJson = useMemo(() => {
    if (isCapturedWebGpu) return undefined;
    return hasSelectedModel(state) && state.ihvProvider === "WebGpuExecutionProvider"
      ? buildRecipeJsonFromState(state)
      : undefined;
  }, [isCapturedWebGpu, state]);

  const finalRecipeJson = recipeJson || fallbackRecipeJson;

  // Keep-alive: seed from store so remounts don't blank a restored sub-view
  const [visitedSubViews, setVisitedSubViews] = useState<Set<string>>(
    () => new Set([activeSubView, "browser-test"]),
  );

  const [, startSubViewTransition] = useTransition();
  const tabRefs = useRef<Partial<Record<PlaygroundSubView, HTMLButtonElement | null>>>({});

  const handleSubViewChange = (id: PlaygroundSubView) => {
    startSubViewTransition(() => {
      setActiveSubView(id);
      setVisitedSubViews((prev) => {
        if (prev.has(id)) return prev;
        return new Set(prev).add(id);
      });
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: PlaygroundSubView) => {
    const ids = SUB_VIEWS.map((view) => view.id);
    const index = ids.indexOf(id);
    if (index < 0) return;

    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % ids.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + ids.length) % ids.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = ids.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextId = ids[nextIndex]!;
    handleSubViewChange(nextId);
    queueMicrotask(() => {
      tabRefs.current[nextId]?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 id="playground-heading" className="sr-only">
          Playground
        </h2>

        <div
          className="flex bg-slate-900 border border-slate-800 rounded p-0.5"
          role="tablist"
          aria-label="Playground sub-view"
        >
          {SUB_VIEWS.map(({ id, label, icon: Icon }) => {
            const selected = activeSubView === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`playground-tab-${id}`}
                aria-selected={selected}
                aria-controls={`playground-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                onClick={() => handleSubViewChange(id)}
                onKeyDown={(event) => handleTabKeyDown(event, id)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded transition-all flex items-center gap-1 cursor-pointer",
                  selected
                    ? "bg-electric-blue text-slate-950"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-view content — keep-alive via CSS hidden, not unmount */}
      <div className="relative">
        {visitedSubViews.has("browser-test") && (
          <div
            id="playground-panel-browser-test"
            role="tabpanel"
            aria-labelledby="playground-tab-browser-test"
            hidden={activeSubView !== "browser-test"}
            className={cn(activeSubView === "browser-test" ? "block" : "hidden")}
          >
            <ErrorBoundary label="Browser Test">
              <Suspense fallback={<LoadingFallback label="Loading Browser Test..." />}>
                <InBrowserValidation recipeJson={finalRecipeJson} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {visitedSubViews.has("benchmark") && (
          <div
            id="playground-panel-benchmark"
            role="tabpanel"
            aria-labelledby="playground-tab-benchmark"
            hidden={activeSubView !== "benchmark"}
            className={cn(activeSubView === "benchmark" ? "block" : "hidden")}
          >
            <ErrorBoundary label="Benchmark">
              <Suspense fallback={<LoadingFallback label="Loading Benchmark..." />}>
                <WebGpuBenchmarkPanel />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {visitedSubViews.has("arena") && (
          <div
            id="playground-panel-arena"
            role="tabpanel"
            aria-labelledby="playground-tab-arena"
            hidden={activeSubView !== "arena"}
            className={cn(activeSubView === "arena" ? "block" : "hidden")}
          >
            <ErrorBoundary label="Arena">
              <Suspense fallback={<LoadingFallback label="Loading Arena..." />}>
                <ArenaPanel />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
