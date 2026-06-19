import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UIState } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";
import { BrainCircuit, Cpu, Terminal, Bot } from "lucide-react";
import { InputEnvironmentPanel } from "@/components/features/InputEnvironmentPanel";
import { IHVIntegrationPanel } from "@/components/features/IHVIntegrationPanel";
import { ExecutionWorkspace } from "@/components/features/ExecutionWorkspace";
import { BatchProcessingPanel } from "@/components/features/BatchProcessingPanel";
import { GeminiSidebar } from "@/components/features/GeminiSidebar";
import { LicenseNotice } from "@/components/LicenseNotice";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient();

const defaultState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "meta-llama/Meta-Llama-3-8B",
  hfDataset: "",
  ihvProvider: "CPUExecutionProvider",
  memoryOffload: "gpu_only",
  cudaVersion: "auto",
  cacheDir: "",
  azureStr: "",
  distributedCaching: false,
  activeJobId: null,
  passes: { ...DEFAULT_PASSES },
};

type ActiveView = "input" | "ihv" | "execute";

const SECTIONS: { id: ActiveView; step: string; label: string; desc: string; icon: typeof BrainCircuit }[] = [
  { id: "input", step: "01", label: "Model source", desc: "Recipe preset or Hugging Face, local, and Azure model inputs.", icon: BrainCircuit },
  { id: "ihv", step: "02", label: "Hardware", desc: "Execution provider and accelerator target.", icon: Cpu },
  { id: "execute", step: "03", label: "Recipe & run", desc: "Review workflow, execute, or queue batch jobs.", icon: Terminal },
];

function Dashboard() {
  const [state, setStateRaw] = useState<UIState>(defaultState);
  const [activeView, setActiveView] = useState<ActiveView>("input");
  const [isOliveRunning, setIsOliveRunning] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [triggerAiAudit, setTriggerAiAudit] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);

  const handleOpenAiAudit = () => {
    setIsAiSidebarOpen(true);
    setTriggerAiAudit(true);
  };

  const setState = (partial: Partial<UIState>) =>
    setStateRaw((prev) => commitUiStateUpdate(prev, partial));

  return (
    <div className="flex h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/logo.png"
              alt="Olive Studio"
              className="h-8 w-8 shrink-0 rounded object-contain"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100 truncate">Olive Studio</div>
              <div className="text-[11px] text-slate-500">Recipe builder</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          <div className="px-4 mb-2 text-[11px] font-medium text-slate-600">Pipeline</div>
          <div className="space-y-0.5">
            {SECTIONS.map(({ id, step, label, icon: Icon }) => {
              const isActive = activeView === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveView(id);
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 pl-4 pr-3 py-2 text-sm transition-colors border-l-2 text-left",
                    isActive
                      ? "border-electric-blue text-slate-100 bg-electric-blue/5"
                      : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/40",
                  )}
                >
                  <span className={cn("text-[11px] tabular-nums shrink-0 w-5", isActive ? "text-electric-blue" : "text-slate-600")}>
                    {step}
                  </span>
                  <Icon className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-electric-blue" : "text-slate-600")} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-slate-800">
          <VramEstimateBanner state={state} sidebar />
        </div>

        <footer className="shrink-0 border-t border-slate-800 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setLicenseOpen(true)}
            className="text-[10px] text-slate-600 hover:text-slate-400 cursor-pointer"
          >
            AGPL-3.0
          </button>
        </footer>
      </aside>

      <div className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
          <header className="h-12 flex items-center justify-between px-6 md:px-8 border-b border-slate-800 bg-slate-950 sticky top-0 z-20 shrink-0">
            <span className="text-sm text-slate-500">Optimization pipeline</span>
            <button
              type="button"
              onClick={() => setIsAiSidebarOpen((open) => !open)}
              className={cn(
                "px-3 py-1.5 border text-sm flex items-center gap-1.5 transition-colors cursor-pointer",
                isAiSidebarOpen
                  ? "border-electric-blue text-electric-blue bg-electric-blue/5"
                  : "border-slate-700 text-slate-400 hover:border-electric-blue hover:text-electric-blue",
              )}
            >
              <Bot className="h-3.5 w-3.5" />
              Assistant
            </button>
          </header>

          <main
            className="flex-1 overflow-y-auto px-6 py-8 md:px-10 h-full scroll-smooth"
            onScroll={(e) => {
              if (isOliveRunning) return;
              const scrollPos = (e.target as HTMLElement).scrollTop + 120;
              for (let i = SECTIONS.length - 1; i >= 0; i--) {
                const el = document.getElementById(SECTIONS[i].id);
                if (el && el.offsetTop <= scrollPos) {
                  if (activeView !== SECTIONS[i].id) setActiveView(SECTIONS[i].id);
                  break;
                }
              }
            }}
          >
            <div className="pb-16 space-y-16">
              {SECTIONS.map(({ id, step, label, desc }) => (
                <section
                  key={id}
                  id={id}
                  className="mx-auto w-full max-w-7xl"
                >
                  <header className="mb-5 pb-4 border-b border-slate-800">
                    <p className="text-xs text-electric-blue mb-1">{step}</p>
                    <h2 className="text-lg font-semibold text-slate-100">{label}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
                  </header>
                  {id === "input" && <InputEnvironmentPanel state={state} setState={setState} />}
                  {id === "ihv" && <IHVIntegrationPanel state={state} setState={setState} />}
                  {id === "execute" && (
                    <div className="space-y-8">
                      <ExecutionWorkspace
                        state={state}
                        setState={setState}
                        onOpenAiAudit={handleOpenAiAudit}
                        onRunStateChange={(running) => {
                          setIsOliveRunning(running);
                          if (running) {
                            setActiveView("execute");
                            document.getElementById("execute")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                      />
                      <BatchProcessingPanel state={state} setState={setState} />
                    </div>
                  )}
                </section>
              ))}
            </div>
          </main>
        </div>

        <GeminiSidebar
          state={state}
          setState={setState}
          isOpen={isAiSidebarOpen}
          onClose={() => setIsAiSidebarOpen(false)}
          openToAudit={triggerAiAudit}
          onAuditOpened={() => setTriggerAiAudit(false)}
        />
      </div>

      <LicenseNotice open={licenseOpen} onClose={() => setLicenseOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
