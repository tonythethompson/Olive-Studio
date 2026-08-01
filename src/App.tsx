import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrainCircuit, Cpu, Terminal, Bot, RefreshCw } from "lucide-react";
import { InputEnvironmentPanel } from "@/components/features/InputEnvironmentPanel";
import { IHVIntegrationPanel } from "@/components/features/IHVIntegrationPanel";
import { ExecutionWorkspace } from "@/components/features/ExecutionWorkspace";
import { LicenseNotice } from "@/components/LicenseNotice";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { KbSyncIndicator } from "@/components/features/KbSyncIndicator";
import { RuntimeEnvControls } from "@/components/features/RuntimeEnvControls";
import { TitleBar } from "@/components/TitleBar";
import { DesktopMinimumViewport } from "@/components/DesktopMinimumViewport";
import { cn } from "@/lib/utils";
import { OLIVE_PIPELINE_NAVIGATE, type PipelineViewId } from "@/lib/pipelineNavigation";

const BatchProcessingPanel = lazy(() =>
  import("@/components/features/BatchProcessingPanel").then((m) => ({ default: m.BatchProcessingPanel })),
);

const GeminiSidebar = lazy(() =>
  import("@/components/features/GeminiSidebar").then((m) => ({ default: m.GeminiSidebar })),
);

function SidebarFallback() {
  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900/40 flex items-center justify-center">
      <RefreshCw className="h-5 w-5 text-electric-blue animate-spin" />
    </div>
  );
}

function BatchPanelFallback() {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-12 flex items-center justify-center">
      <RefreshCw className="h-5 w-5 text-electric-blue animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient();

type ActiveView = PipelineViewId;

const SECTIONS: { id: ActiveView; step: string; label: string; desc: string; icon: typeof BrainCircuit }[] = [
  {
    id: "input",
    step: "01",
    label: "Model source",
    desc: "Recipe preset or Hugging Face, local, and Azure model inputs.",
    icon: BrainCircuit,
  },
  { id: "ihv", step: "02", label: "Hardware", desc: "Execution provider and accelerator target.", icon: Cpu },
  {
    id: "execute",
    step: "03",
    label: "Recipe & run",
    desc: "Review workflow, execute, or queue batch jobs.",
    icon: Terminal,
  },
];

/**
 * Renders the Olive Studio recipe builder dashboard with navigable model, hardware, and execution sections.
 */
function Dashboard() {
  const [activeView, setActiveView] = useState<ActiveView>("input");
  const [isOliveRunning, setIsOliveRunning] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [triggerAiAudit, setTriggerAiAudit] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const scrollingToRef = useRef<ActiveView | null>(null);

  const handleOpenAiAudit = () => {
    setIsAiSidebarOpen(true);
    setTriggerAiAudit(true);
  };

  const scrollToSection = useCallback(
    (id: ActiveView) => {
      if (isOliveRunning && id !== "execute") return;
      setActiveView(id);
      scrollingToRef.current = id;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        if (scrollingToRef.current === id) scrollingToRef.current = null;
      }, 900);
    },
    [isOliveRunning],
  );

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<PipelineViewId>).detail;
      if (detail !== "input" && detail !== "ihv" && detail !== "execute") return;
      scrollToSection(detail);
    };
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, onNavigate);
    return () => window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, onNavigate);
  }, [scrollToSection]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const syncActiveFromScroll = () => {
      if (scrollingToRef.current) return;
      const mainTop = main.getBoundingClientRect().top;
      let current: ActiveView = "input";
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - mainTop <= 96) current = id;
      }
      setActiveView((prev) => (prev === current ? prev : current));
    };

    main.addEventListener("scroll", syncActiveFromScroll, { passive: true });
    syncActiveFromScroll();
    return () => main.removeEventListener("scroll", syncActiveFromScroll);
  }, []);

  return (
    <DesktopMinimumViewport>
      <div className="flex flex-col h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">
        <TitleBar />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-electric-blue focus:text-white focus:rounded-md"
          >
            Skip to main content
          </a>
          <aside className="w-14 wide:w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
            <div className="h-14 flex items-center justify-center wide:justify-start px-2 wide:px-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/assets/logo.png"
                  alt="Olive Studio"
                  className="h-8 w-8 shrink-0 rounded object-contain"
                />
                <div className="min-w-0 hidden wide:block">
                  <div className="text-sm font-semibold text-slate-100 truncate">Olive Studio</div>
                  <div className="text-[11px] text-slate-400">Recipe builder</div>
                </div>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-3" aria-label="Pipeline">
              <div className="px-4 mb-2 text-[11px] font-medium text-slate-400 hidden wide:block">
                Pipeline
              </div>
              <div className="space-y-0.5">
                {SECTIONS.map(({ id, step, label, icon: Icon }) => {
                  const isActive = activeView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      title={`${step} ${label}`}
                      aria-label={`${step} ${label}`}
                      onClick={() => scrollToSection(id)}
                      aria-current={isActive ? "step" : undefined}
                      disabled={isOliveRunning && id !== "execute"}
                      className={cn(
                        "w-full flex items-center gap-2.5 justify-center wide:justify-start px-2 wide:pl-4 wide:pr-3 py-2.5 wide:py-2 text-sm transition-colors border-l-2 text-left",
                        isActive
                          ? "border-electric-blue text-slate-100 bg-electric-blue/5"
                          : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40",
                        isOliveRunning &&
                          id !== "execute" &&
                          "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-slate-400",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[11px] tabular-nums shrink-0 w-5 text-center wide:text-left",
                          isActive ? "text-electric-blue" : "text-slate-400",
                        )}
                      >
                        {step}
                      </span>
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 hidden wide:block",
                          isActive ? "text-electric-blue" : "text-slate-400",
                        )}
                        aria-hidden
                      />
                      <span className="truncate hidden wide:inline">{label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <div className="shrink-0 border-t border-slate-800 hidden wide:block">
              <VramEstimateBanner sidebar />
            </div>

            <footer className="shrink-0 border-t border-slate-800 px-2 wide:px-4 py-2.5 flex justify-center wide:justify-start">
              <button
                type="button"
                onClick={() => setLicenseOpen(true)}
                className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                MIT
              </button>
            </footer>
          </aside>

          <div className="flex-1 flex min-w-0 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
              <header className="h-12 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-3 wide:px-6 min-[1000px]:px-8 border-b border-slate-800 bg-slate-950 sticky top-0 z-20 shrink-0">
                <div className="justify-self-start min-w-0">
                  <span className="text-sm text-slate-400 truncate hidden wide:inline">
                    Optimization pipeline
                  </span>
                </div>
                <div className="justify-self-center flex items-center gap-5 min-w-0">
                  <KbSyncIndicator />
                  <span className="hidden sm:block w-px h-4 bg-slate-700/80 shrink-0" aria-hidden />
                  <RuntimeEnvControls />
                </div>
                <div className="justify-self-end">
                  <button
                    type="button"
                    onClick={() => setIsAiSidebarOpen((open) => !open)}
                    className={cn(
                      "px-2.5 wide:px-3 py-1.5 border text-sm flex items-center gap-1.5 transition-colors cursor-pointer shrink-0",
                      isAiSidebarOpen
                        ? "border-electric-blue text-electric-blue bg-electric-blue/5"
                        : "border-slate-700 text-slate-400 hover:border-electric-blue hover:text-electric-blue",
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Assistant</span>
                  </button>
                </div>
              </header>

              <main
                ref={mainRef}
                id="main"
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 wide:px-6 wide:py-8 min-[1000px]:px-10 h-full min-w-0"
              >
                <h1 className="sr-only">Olive Studio recipe builder</h1>
                <div className="mx-auto w-full max-w-5xl min-w-0 pb-16">
                  {SECTIONS.map(({ id, step, label, desc }, index) => (
                    <section
                      key={id}
                      id={id}
                      aria-labelledby={`${id}-heading`}
                      className={cn("scroll-mt-4", index > 0 && "mt-12 pt-10 border-t border-slate-800")}
                    >
                      <header className="mb-5 pb-4 border-b border-slate-800/80">
                        <p className="text-xs text-electric-blue mb-1">{step}</p>
                        <h2 id={`${id}-heading`} className="text-lg font-semibold text-slate-100">
                          {label}
                        </h2>
                        <p className="text-sm text-slate-400 mt-0.5">{desc}</p>
                      </header>
                      {id === "input" && (
                        <ErrorBoundary label="Model source">
                          <InputEnvironmentPanel />
                        </ErrorBoundary>
                      )}
                      {id === "ihv" && (
                        <ErrorBoundary label="Hardware">
                          <IHVIntegrationPanel />
                        </ErrorBoundary>
                      )}
                      {id === "execute" && (
                        <div className="space-y-8">
                          <ErrorBoundary label="Recipe &amp; run">
                            <ExecutionWorkspace
                              onOpenAiAudit={handleOpenAiAudit}
                              onRunStateChange={(running) => {
                                setIsOliveRunning(running);
                                if (running) scrollToSection("execute");
                              }}
                            />
                          </ErrorBoundary>
                          <ErrorBoundary label="Batch queue">
                            <Suspense fallback={<BatchPanelFallback />}>
                              <BatchProcessingPanel />
                            </Suspense>
                          </ErrorBoundary>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </main>
            </div>

            <ErrorBoundary label="Assistant">
              <Suspense fallback={<SidebarFallback />}>
                <GeminiSidebar
                  isOpen={isAiSidebarOpen}
                  onClose={() => setIsAiSidebarOpen(false)}
                  openToAudit={triggerAiAudit}
                  onAuditOpened={() => setTriggerAiAudit(false)}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>

        <LicenseNotice open={licenseOpen} onClose={() => setLicenseOpen(false)} />
      </div>
    </DesktopMinimumViewport>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
