import { useState, useTransition, lazy, Suspense } from "react";
import { RefreshCw, Globe, Gauge, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePlaygroundStore, type PlaygroundSubView } from "@/lib/stores/playgroundStore";
import { ArenaPanel } from "./ArenaPanel";

/* ------------------------------------------------------------------ */
/*  Lazy sub-view imports                                               */
/* ------------------------------------------------------------------ */

const InBrowserValidation = lazy(() =>
  import("./InBrowserValidation").then((m) => ({ default: m.InBrowserValidation }))
);

const WebGpuBenchmarkPanel = lazy(() =>
  import("./WebGpuBenchmarkPanel").then((m) => ({ default: m.WebGpuBenchmarkPanel }))
);

/* ------------------------------------------------------------------ */
/*  Sub-view tab definitions                                            */
/* ------------------------------------------------------------------ */

const SUB_VIEWS: { id: PlaygroundSubView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
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
        <RefreshCw className="h-5 w-5 text-electric-blue animate-spin" />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PlaygroundPanel                                                     */
/* ------------------------------------------------------------------ */

export function PlaygroundPanel() {
  const activeSubView = usePlaygroundStore((s) => s.activeSubView);
  const setActiveSubView = usePlaygroundStore((s) => s.setActiveSubView);

  // Keep-alive: track which sub-views have been opened so they stay mounted
  const [visitedSubViews, setVisitedSubViews] = useState<Set<string>>(
    new Set(["browser-test"])
  );

  const [, startSubViewTransition] = useTransition();

  const handleSubViewChange = (id: PlaygroundSubView) => {
    startSubViewTransition(() => {
      setActiveSubView(id);
      setVisitedSubViews((prev) => {
        if (prev.has(id)) return prev;
        return new Set(prev).add(id);
      });
    });
  };

  return (
    <section
      id="playground"
      aria-labelledby="playground-heading"
      className="flex flex-col gap-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 id="playground-heading" className="sr-only">
          Playground
        </h2>

        {/* Sub-view tab bar — same pill/button-group style as graph/json toggle */}
        <div
          className="flex bg-slate-900 border border-slate-800 rounded p-0.5"
          role="group"
          aria-label="Playground sub-view"
        >
          {SUB_VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeSubView === id}
              onClick={() => handleSubViewChange(id)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded transition-all flex items-center gap-1 cursor-pointer",
                activeSubView === id
                  ? "bg-electric-blue text-slate-950"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-view content — keep-alive via CSS hidden, not unmount */}
      <div className="relative">
        {/* Browser Test */}
        {visitedSubViews.has("browser-test") && (
          <div className={cn(activeSubView === "browser-test" ? "block" : "hidden")}>
            <ErrorBoundary label="Browser Test">
              <Suspense fallback={<LoadingFallback label="Loading Browser Test..." />}>
                <InBrowserValidation recipeJson={undefined} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* Benchmark */}
        {visitedSubViews.has("benchmark") && (
          <div className={cn(activeSubView === "benchmark" ? "block" : "hidden")}>
            <ErrorBoundary label="Benchmark">
              <Suspense fallback={<LoadingFallback label="Loading Benchmark..." />}>
                <WebGpuBenchmarkPanel />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* Arena */}
        {visitedSubViews.has("arena") && (
          <div className={cn(activeSubView === "arena" ? "block" : "hidden")}>
            <ErrorBoundary label="Arena">
              <ArenaPanel />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </section>
  );
}
