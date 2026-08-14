import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrainCircuit, Cpu, Terminal, Bot, RefreshCw, FlaskConical, Settings } from "lucide-react";
import { useThemeEffect } from "@/lib/hooks/useThemeEffect";
import { SettingsMenu } from "@/components/SettingsMenu";
import { InputEnvironmentPanel } from "@/components/features/input/InputEnvironmentPanel";
import { LicenseNotice } from "@/components/LicenseNotice";
import { WelcomeModal } from "@/components/WelcomeModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { getPipelineValidation, hasSelectedModel, type PipelineValidationResult } from "@/lib/pipelineValidation";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import type { ReportArea } from "@/lib/issueReport";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { KbSyncIndicator } from "@/components/features/KbSyncIndicator";
import { RuntimeEnvControls } from "@/components/features/RuntimeEnvControls";

import { TitleBar } from "@/components/TitleBar";
import { DesktopMinimumViewport, WIDE_SHELL_MIN_WIDTH_PX } from "@/components/DesktopMinimumViewport";
import { cn } from "@/lib/utils";
import { OLIVE_PIPELINE_NAVIGATE, isPipelineViewId, type PipelineViewId, expandPipelineValidation, emphasizeValidationPanel } from "@/lib/pipelineNavigation";
import { OLIVE_ASK_AI_CHAT, type AskAiChatDetail } from "@/lib/aiChatBridge";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { PipelineStatusSummary } from "@/components/features/pipeline/PipelineStatusSummary";
import { PipelineSectionGate } from "@/components/features/pipeline/PipelineSectionGate";

const BatchProcessingPanel = lazy(() =>
  import("@/components/features/execute/BatchProcessingPanel").then((m) => ({ default: m.BatchProcessingPanel })),
);

const AssistantSidebar = lazy(() =>
  import("@/components/features/assistant/AssistantSidebar").then((m) => ({ default: m.AssistantSidebar })),
);

const PlaygroundPanel = lazy(() =>
  import("@/components/features/playground/PlaygroundPanel").then((m) => ({ default: m.PlaygroundPanel })),
);

const IHVIntegrationPanel = lazy(() =>
  import("@/components/features/ihv/IHVIntegrationPanel").then((m) => ({ default: m.IHVIntegrationPanel })),
);

const ExecutionWorkspace = lazy(() =>
  import("@/components/features/execute/ExecutionWorkspace").then((m) => ({ default: m.ExecutionWorkspace })),
);

const ReportIssueModal = lazy(() =>
  import("@/components/ReportIssueModal").then((m) => ({ default: m.ReportIssueModal })),
);

function SidebarFallback() {
  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900/40 flex items-center justify-center">
      <span className="animate-spin"><RefreshCw className="h-5 w-5 text-electric-blue" /></span>
    </div>
  );
}

function BatchPanelFallback() {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-12 flex items-center justify-center">
      <span className="animate-spin"><RefreshCw className="h-5 w-5 text-electric-blue" /></span>
    </div>
  );
}

function PanelFallback() {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-16 flex items-center justify-center">
      <span className="animate-spin"><RefreshCw className="h-5 w-5 text-electric-blue" /></span>
    </div>
  );
}

function PlaygroundPanelFallback() {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-12 flex items-center justify-center">
      <span className="animate-spin"><RefreshCw className="h-5 w-5 text-electric-blue" /></span>
    </div>
  );
}

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
  {
    id: "playground",
    step: "04",
    label: "Playground",
    desc: "In-browser inference, WebGPU benchmarks, and model Arena.",
    icon: FlaskConical,
  },
];

/**
 * Renders the Olive Studio recipe builder dashboard with navigable model, hardware, and execution sections.
 */
function Dashboard() {
  useThemeEffect();

  const { state: pipelineState } = usePipelineState();
  const { data: hardwareProbe } = useHardwareProbe();
  const modelSelected = useMemo(() => hasSelectedModel(pipelineState), [pipelineState]);
  const validation: PipelineValidationResult = useMemo(
    () => getPipelineValidation(pipelineState, { forLocalExecution: true, hardwareProbe: hardwareProbe ?? null }),
    [pipelineState, hardwareProbe],
  );
  const [activeView, setActiveView] = useState<ActiveView>("input");
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<ActiveView>>(() => new Set(["input"]));
  const [pendingResolveIssues, setPendingResolveIssues] = useState(false);

  // Header center cluster (KB sync / runtime) must never wrap
  // onto a second line. Measure the actual gap between the fixed left and
  // right header columns and collapse the cluster to icon-only once the
  // full-label layout wouldn't fit — driven by real available space rather
  // than a viewport breakpoint, since the sidebar and header columns already
  // resize independently at their own breakpoints.
  const headerLeftRef = useRef<HTMLDivElement>(null);
  const headerRightRef = useRef<HTMLDivElement>(null);
  const [headerCompact, setHeaderCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < WIDE_SHELL_MIN_WIDTH_PX;
  });
  const HEADER_CLUSTER_FULL_WIDTH = 520;

  const [isOliveRunning, setIsOliveRunning] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [triggerAiAudit, setTriggerAiAudit] = useState(false);
  const [pendingChatQuery, setPendingChatQuery] = useState<AskAiChatDetail | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  // First run only: once dismissed via "Don't show again", this never re-opens.
  const [welcomeOpen, setWelcomeOpen] = useState(
    () => !usePreferencesStore.getState().welcomeDismissed,
  );
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportData, setReportData] = useState<{
    error: Error;
    label?: string;
    componentStack?: string;
    frequencyInfo?: import("@/lib/errorFrequency").ErrorFrequencyInfo | null;
  } | null>(null);

  useLayoutEffect(() => {
    const leftEl = headerLeftRef.current;
    const rightEl = headerRightRef.current;
    if (!leftEl || !rightEl) return;

    const measure = () => {
      const available = rightEl.getBoundingClientRect().left - leftEl.getBoundingClientRect().right;
      setHeaderCompact(available < HEADER_CLUSTER_FULL_WIDTH);
    };

    measure();
    window.addEventListener("resize", measure);

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(leftEl);
      ro.observe(rightEl);
    }

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isAiSidebarOpen]);

  const handleReportError = useCallback(
    (details: {
      error: Error;
      label?: string;
      componentStack?: string;
      frequencyInfo?: import("@/lib/errorFrequency").ErrorFrequencyInfo | null;
    }) => {
      setReportData(details);
      setIsReportOpen(true);
    },
    [],
  );

  // Map ErrorBoundary label to ReportArea for pre-filling
  const labelToArea = (label?: string): ReportArea => {
    if (!label) return "other";
    const lower = label.toLowerCase();
    if (lower.includes("model") || lower.includes("input")) return "recipe-builder";
    if (lower.includes("hardware") || lower.includes("ep")) return "hardware-ep";
    if (lower.includes("recipe") || lower.includes("run") || lower.includes("batch")) return "execution-batch";
    if (lower.includes("playground") || lower.includes("arena")) return "playground-arena";
    if (lower.includes("assistant") || lower.includes("chat")) return "assistant-ai";
    return "other";
  };
  const mainRef = useRef<HTMLElement>(null);
  const scrollingToRef = useRef<ActiveView | null>(null);

  const handleOpenAiAudit = () => {
    setIsAiSidebarOpen(true);
    setTriggerAiAudit(true);
  };

  // Lazy-load driver.js so the tour (and its CSS) stays out of the main bundle.
  const startTour = useCallback(() => {
    void import("@/lib/tour").then(({ startGuidedTour }) =>
      startGuidedTour(() => usePreferencesStore.getState().markTourSeen()),
    );
  }, []);

  // Auto-offer the guided tour once: on a true first run it starts right after
  // the welcome modal closes; on installs that already dismissed the welcome
  // screen it starts on the first launch that includes the tour. Either way it
  // only happens until the tour has been seen (finished or skipped) — after
  // that it is replayable from Settings → Take the tour.
  useEffect(() => {
    if (welcomeOpen) return;
    if (usePreferencesStore.getState().tourSeen) return;
    const timer = window.setTimeout(startTour, 600);
    return () => window.clearTimeout(timer);
  }, [welcomeOpen, startTour]);

  const scrollToSection = useCallback(
    (id: ActiveView) => {
      if (isOliveRunning && id !== "execute" && id !== "playground") return;
      setActiveView(id);
      setVisitedSections((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      scrollingToRef.current = id;
      const main = mainRef.current;
      const target = document.getElementById(id);
      if (!main || !target) return;
      // Resolve the target position relative to the scroll container. Using
      // offsetTop here would depend on the element's offsetParent.
      const mainTop = main.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      const top = targetTop - mainTop + main.scrollTop - 16;
      const max = main.scrollHeight - main.clientHeight;
      main.scrollTo({ top: Math.max(0, Math.min(top, max)), behavior: "smooth" });
      window.setTimeout(() => {
        if (scrollingToRef.current === id) scrollingToRef.current = null;
      }, 900);
    },
    [isOliveRunning],
  );

  const handleSelectModel = useCallback(() => scrollToSection("input"), [scrollToSection]);
  const handleReviewRun = useCallback(() => scrollToSection("execute"), [scrollToSection]);
  const handleResolveIssues = useCallback(() => {
    const panel = document.getElementById("recipe-validation-panel");
    const main = mainRef.current;
    const isVisible = (() => {
      if (!panel || !main) return false;
      const mainRect = main.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(panelRect.bottom, mainRect.bottom) - Math.max(panelRect.top, mainRect.top));
      return visibleHeight > panelRect.height * 0.5;
    })();

    if (isVisible) {
      expandPipelineValidation();
      emphasizeValidationPanel();
      return;
    }

    setPendingResolveIssues(true);
    scrollToSection("execute");
  }, [scrollToSection]);

  useEffect(() => {
    if (!pendingResolveIssues || activeView !== "execute") return;

    let completed = false;

    const complete = () => {
      if (completed) return;
      completed = true;
      setPendingResolveIssues(false);
    };

    const tryExpandAndScroll = () => {
      const panel = document.getElementById("recipe-validation-panel");
      if (!panel) return false;
      expandPipelineValidation();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      // Keep this timer independent of effect cleanup: flipping pendingResolveIssues
      // remounts the effect and would cancel the emphasize flash too early.
      window.setTimeout(() => emphasizeValidationPanel(), 600);
      return true;
    };

    if (tryExpandAndScroll()) {
      complete();
      return;
    }

    // Keep observing until the lazy Execute workspace mounts the panel.
    // No short safety cutoff: a slow chunk load would otherwise drop Resolve Issues silently.
    const observer = new MutationObserver(() => {
      if (tryExpandAndScroll()) {
        window.clearTimeout(timeoutId);
        observer.disconnect();
        complete();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      complete();
    }, 15000);

    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [pendingResolveIssues, activeView]);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isPipelineViewId(detail)) return;
      scrollToSection(detail);
    };
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, onNavigate);
    return () => window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, onNavigate);
  }, [scrollToSection]);

  useEffect(() => {
    const onAskAiChat = (event: Event) => {
      const detail = (event as CustomEvent<AskAiChatDetail>).detail;
      if (!detail?.query) return;
      setIsAiSidebarOpen(true);
      setPendingChatQuery(detail);
    };
    window.addEventListener(OLIVE_ASK_AI_CHAT, onAskAiChat);
    return () => window.removeEventListener(OLIVE_ASK_AI_CHAT, onAskAiChat);
  }, []);

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
      setVisitedSections((prev) => (prev.has(current) ? prev : new Set(prev).add(current)));
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
          <aside className="w-12 wide:w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
            <div className="h-14 flex items-center justify-center wide:justify-start px-1 wide:px-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/assets/logo.png"
                  alt="Olive Studio"
                  width={32}
                  height={32}
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
                  const isIncomplete = !modelSelected && id !== "input" && !visitedSections.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      title={isIncomplete ? `${step} ${label} — select a model first` : `${step} ${label}`}
                      aria-label={isIncomplete ? `${step} ${label}, incomplete` : `${step} ${label}`}
                      onClick={() => scrollToSection(id)}
                      aria-current={isActive ? "step" : undefined}
                      disabled={isOliveRunning && id !== "execute" && id !== "playground"}
                      className={cn(
                        "w-full flex items-center gap-2.5 justify-center wide:justify-start px-2 wide:pl-4 wide:pr-3 py-2.5 wide:py-2 text-sm transition-colors border-l-2 text-left",
                        isActive
                          ? "border-electric-blue text-slate-100 bg-electric-blue/5"
                          : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40",
                        isOliveRunning &&
                        id !== "execute" &&
                        id !== "playground" &&
                        "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-slate-400",
                      )}
                    >
                      <span
                        className={cn(
                          "relative text-[11px] tabular-nums shrink-0 w-5 text-center wide:text-left",
                          isActive ? "text-electric-blue" : "text-slate-400",
                        )}
                      >
                        {step}
                        {isIncomplete && (
                          <span
                            className="absolute -top-0.5 -right-0.5 wide:right-auto wide:left-[calc(100%-2px)] h-1.5 w-1.5 rounded-full bg-amber-500"
                            aria-hidden
                          />
                        )}
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

            <div className="shrink-0 border-t border-slate-800">
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
              <header className="min-h-12 grid grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)_minmax(min-content,1fr)] items-center gap-2 wide:gap-4 px-3 wide:px-6 min-[1000px]:px-8 py-1.5 border-b border-slate-800 bg-slate-950 sticky top-0 z-20 shrink-0">
                {/*
                  Invisible mirror of the Assistant button. The two outer grid
                  tracks use minmax(min-content,1fr), so they hold at least
                  their content's width while the center cluster is measured
                  with a real ResizeObserver. Mirroring the same markup on the
                  left keeps both floors identical, which keeps the center
                  cluster visually centered instead of drifting toward the
                  empty side.
                */}
                <div ref={headerLeftRef} className="justify-self-start flex items-center gap-2" aria-hidden="true">
                  <span className="invisible p-1.5">
                    <Settings className="h-4 w-4" />
                  </span>
                  <span
                    className={cn(
                      "invisible px-2.5 wide:px-3 py-1.5 border text-[clamp(0.75rem,0.65rem+0.3vw,0.875rem)] flex items-center gap-1.5",
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="hidden wide:inline">Assistant</span>
                  </span>
                </div>
                <div className="justify-self-center flex items-center flex-nowrap justify-center gap-x-3 min-w-0 overflow-hidden">
                  <KbSyncIndicator compact={headerCompact} />
                  {!headerCompact && <span className="block w-px h-4 bg-slate-700/80 shrink-0" aria-hidden />}
                  <RuntimeEnvControls compact={headerCompact} />

                </div>
                <div ref={headerRightRef} className="justify-self-end flex items-center gap-2">
                  <SettingsMenu onTakeTour={startTour} />
                  <button
                    type="button"
                    data-tour="assistant"
                    onClick={() => setIsAiSidebarOpen((open) => !open)}
                    aria-label={isAiSidebarOpen ? "Close Assistant" : "Open Assistant"}
                    aria-expanded={isAiSidebarOpen}
                    aria-controls="assistant-panel"
                    className={cn(
                      "px-2.5 wide:px-3 py-1.5 border text-[clamp(0.75rem,0.65rem+0.3vw,0.875rem)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0",
                      isAiSidebarOpen
                        ? "border-electric-blue text-electric-blue bg-electric-blue/5"
                        : "border-slate-700 text-slate-400 hover:border-electric-blue hover:text-electric-blue",
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="hidden wide:inline">Assistant</span>
                  </button>
                </div>
              </header>
              <div className="shrink-0 border-b border-slate-800 bg-slate-950/95 backdrop-blur z-10">
                <PipelineStatusSummary
                  state={pipelineState}
                  validation={validation}
                  modelSelected={modelSelected}
                  onSelectModel={handleSelectModel}
                  onResolveIssues={handleResolveIssues}
                  onReviewRun={handleReviewRun}
                />
              </div>
              <main
                ref={mainRef}
                id="main"
                className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-4 wide:px-6 wide:py-5 min-[1000px]:px-8 h-full min-w-0"
              >
                <h1 className="sr-only">Olive Studio recipe builder</h1>
                <div className="mx-auto w-full max-w-5xl min-w-0">
                  {SECTIONS.map(({ id, step, label, desc }, index) => {
                    const isLast = index === SECTIONS.length - 1;
                    return (
                      <section
                        key={id}
                        id={id}
                        aria-labelledby={`${id}-heading`}
                        data-pipeline-section={id}
                        className={cn(
                          "scroll-mt-4",
                          index > 0 && "mt-6 pt-5 border-t border-slate-800",
                          // The final pipeline section must be tall enough that
                          // `scrollIntoView({block:"start"})` can land its top at
                          // the scroll-container's top without being clamped to
                          // `maxScroll`. Otherwise the user sees the tail of the
                          // previous section (visible as empty gray) above the
                          // playground header, which reads as "the app rolled
                          // past the section". Height covers title bar + header
                          // + post-section breathing room; uses the dynamic
                          // viewport unit so browser chrome (URL bar, devtools)
                          // does not leave the section short.
                          isLast && "min-h-[calc(100dvh-3rem)] pb-16",
                        )}
                      >
                        <header className="mb-3 pb-2.5 border-b border-slate-800/80">
                          <p className="text-xs text-electric-blue mb-0.5">{step}</p>
                          <h2 id={`${id}-heading`} className="text-lg font-semibold text-slate-100">
                            {label}
                          </h2>
                          <p className="text-sm text-slate-400 mt-0.5">{desc}</p>
                        </header>
                        <PipelineSectionGate locked={!modelSelected && id !== "input" && id !== "playground"}>
                          {id === "input" && (
                            <ErrorBoundary label="Model source" onReportError={handleReportError}>
                              <InputEnvironmentPanel />
                            </ErrorBoundary>
                          )}
                          {id === "ihv" && (
                            <ErrorBoundary label="Hardware" onReportError={handleReportError}>
                              <Suspense fallback={<PanelFallback />}>
                                <IHVIntegrationPanel />
                              </Suspense>
                            </ErrorBoundary>
                          )}
                          {id === "execute" && (
                            <div className="space-y-8">
                              <ErrorBoundary label="Recipe & run" onReportError={handleReportError}>
                                <Suspense fallback={<PanelFallback />}>
                                  <ExecutionWorkspace
                                    onOpenAiAudit={handleOpenAiAudit}
                                    onRunStateChange={(running) => {
                                      setIsOliveRunning(running);
                                    }}
                                  />
                                </Suspense>
                              </ErrorBoundary>
                              <ErrorBoundary label="Batch queue" onReportError={handleReportError}>
                                <Suspense fallback={<BatchPanelFallback />}>
                                  <BatchProcessingPanel />
                                </Suspense>
                              </ErrorBoundary>
                            </div>
                          )}
                          {id === "playground" && (
                            <ErrorBoundary label="Playground" onReportError={handleReportError}>
                              <Suspense fallback={<PlaygroundPanelFallback />}>
                                <PlaygroundPanel />
                              </Suspense>
                            </ErrorBoundary>
                          )}
                        </PipelineSectionGate>
                      </section>
                    );
                  })}
                </div>
              </main>
            </div>

            <ErrorBoundary label="Assistant" onReportError={handleReportError}>
              <Suspense fallback={<SidebarFallback />}>
                <AssistantSidebar
                  isOpen={isAiSidebarOpen}
                  onClose={() => setIsAiSidebarOpen(false)}
                  openToAudit={triggerAiAudit}
                  onAuditOpened={() => setTriggerAiAudit(false)}
                  pendingChatQuery={pendingChatQuery}
                  onChatQueryConsumed={() => setPendingChatQuery(null)}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>

        <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

        <LicenseNotice open={licenseOpen} onClose={() => setLicenseOpen(false)} />

        {/* Report Issue Modal */}
        {isReportOpen && (
          <ErrorBoundary label="Report issue" onReportError={() => setIsReportOpen(false)}>
            <Suspense fallback={null}>
              <ReportIssueModal
                open={isReportOpen}
                onClose={() => {
                  setIsReportOpen(false);
                  setReportData(null);
                }}
                state={pipelineState}
                defaultArea={labelToArea(reportData?.label)}
                defaultDescription={
                  reportData
                    ? `Error in ${reportData.label ?? "unknown section"}:\n\n${reportData.error.message}\n\n${reportData.componentStack ? `Component stack:\n${reportData.componentStack}` : ""}`
                    : undefined
                }
                frequencyInfo={reportData?.frequencyInfo}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </DesktopMinimumViewport>
  );
}

export default function App() {
  // Lazy initializer keeps a single client per App instance without leaking
  // a module-level singleton between test runs.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
