import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UIState } from "@/types";
import { BrainCircuit, Cpu, Zap, Terminal, Database, ListOrdered, Bot } from "lucide-react";
import { InputEnvironmentPanel } from "@/components/features/InputEnvironmentPanel";
import { IHVIntegrationPanel } from "@/components/features/IHVIntegrationPanel";
import { OptimizationPassesPanel } from "@/components/features/OptimizationPassesPanel";
import { EnterpriseInfraPanel } from "@/components/features/EnterpriseInfraPanel";
import { ExecutionWorkspace } from "@/components/features/ExecutionWorkspace";
import { BatchProcessingPanel } from "@/components/features/BatchProcessingPanel";
import { GeminiSidebar } from "@/components/features/GeminiSidebar";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient();

const defaultState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "",
  hfDataset: "",
  ihvProvider: "CPUExecutionProvider",
  cudaVersion: "auto",
  cacheDir: "",
  azureStr: "",
  distributedCaching: false,
  activeJobId: null,
  passes: {
    conversion: true,
    conversionSourceFormat: "pytorch",
    conversionFormat: "onnx",
    conversionOpset: 14,
    conversionInputTargetTypes: "float32",
    quantization: false,
    quantMethod: "ptq",
    quantPrecision: "int8",
    pruning: false,
    pruningSparsity: 0.5,
    pruningType: "unstructured",
    pruningMethod: "magnitude",
    pruningCriteria: "l1_norm",
    splitting: false,
    onnxTransforms: false,
    peft: false,
    peftMethod: "lora",
    diffusionLora: false,
  },
};

type ActiveView = "input" | "ihv" | "passes" | "infra" | "execute" | "batch";

const SECTIONS: { id: ActiveView; step: string; label: string; desc: string; icon: any }[] = [
  { id: "input",   step: "01", label: "Model Source & Data",      desc: "Select an existing recipe or define the base model for optimization.",          icon: BrainCircuit },
  { id: "ihv",     step: "02", label: "Target Hardware (IHV)",    desc: "Choose the hardware accelerator and execution provider framework.",              icon: Cpu },
  { id: "passes",  step: "03", label: "Optimization Passes",      desc: "Configure conversion, quantization, and pruning techniques.",                   icon: Zap },
  { id: "infra",   step: "04", label: "Enterprise Infrastructure",desc: "Connect to Azure Machine Learning or other enterprise deployments.",             icon: Database },
  { id: "execute", step: "05", label: "Recipe & Execution",       desc: "Review the generated Olive workflow and trigger the optimization.",              icon: Terminal },
  { id: "batch",   step: "06", label: "Batch Queue",              desc: "Monitor multi-model parallel optimization runs.",                               icon: ListOrdered },
];

function Dashboard() {
  const [state, setStateRaw] = useState<UIState>(defaultState);
  const [activeView, setActiveView] = useState<ActiveView>("input");
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);

  const setState = (partial: Partial<UIState>) =>
    setStateRaw(prev => ({ ...prev, ...partial }));

  return (
    <div className="flex h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">

      {/* ── Sidebar ── */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col z-10 shrink-0">

        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="border border-electric-blue/50 p-1.5 text-electric-blue shrink-0">
              <LayersIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="font-mono font-bold text-slate-100 text-xs tracking-[0.18em] uppercase">Olive Studio</div>
              <div className="font-mono text-[9px] text-slate-600 tracking-wider">model optimizer</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <div className="px-5 mb-3 font-mono text-[9px] text-slate-700 uppercase tracking-[0.18em]">// pipeline</div>
          <div className="space-y-px">
            {SECTIONS.map(({ id, step, label, icon: Icon }) => {
              const isActive = activeView === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setActiveView(id);
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 pl-5 pr-4 py-2 text-[11px] font-mono font-medium transition-colors group border-l-2",
                    isActive
                      ? "border-electric-blue text-electric-blue bg-electric-blue/5"
                      : "border-transparent text-slate-500 hover:border-slate-700 hover:text-slate-300"
                  )}
                >
                  <span className={cn(
                    "text-[9px] font-mono shrink-0 tabular-nums",
                    isActive ? "text-electric-blue/70" : "text-slate-700 group-hover:text-slate-600"
                  )}>{step}</span>
                  <Icon className={cn("w-3 h-3 shrink-0", isActive ? "text-electric-blue" : "text-slate-600 group-hover:text-slate-500")} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom hint */}
        <div className="px-5 py-4 border-t border-slate-800">
          <div className="flex items-start gap-2">
            <span className="font-mono text-electric-blue text-[10px] shrink-0 mt-px">→</span>
            <p className="text-[10px] font-mono text-slate-700 leading-relaxed">scroll to build pipeline top-to-bottom</p>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-950">

        {/* Header */}
        <header className="h-12 flex items-center justify-between px-8 border-b border-slate-800 bg-slate-950 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">workspace</span>
            <span className="text-slate-800 text-xs">—</span>
            <span className="text-[10px] font-mono text-slate-700">optimization pipeline</span>
          </div>
          <button
            onClick={() => setIsAiSidebarOpen(true)}
            className="px-3 py-1.5 border border-slate-700 hover:border-electric-blue text-[11px] font-mono font-bold text-slate-500 hover:text-electric-blue flex items-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wide"
          >
            <Bot className="h-3.5 w-3.5" />
            ai audit
          </button>
        </header>

        {/* Content */}
        <main
          className="flex-1 overflow-y-auto p-6 md:p-10 h-full scroll-smooth"
          onScroll={(e) => {
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
          <div className="pb-24 space-y-20">
            {SECTIONS.map(({ id, step, label, desc }) => (
              <section
                key={id}
                id={id}
                className={cn(
                  "pt-2 mx-auto w-full",
                  id === "execute" ? "max-w-7xl" : "max-w-5xl"
                )}
              >
                <div className="mb-6 pb-3 border-b border-slate-800">
                  <div className="text-[10px] font-mono text-electric-blue uppercase tracking-widest mb-1">{step} /</div>
                  <h2 className="text-xl font-mono font-bold text-slate-100">{label}</h2>
                  <p className="text-xs text-slate-500 mt-1">{desc}</p>
                </div>
                {id === "input"   && <InputEnvironmentPanel   state={state} setState={setState} />}
                {id === "ihv"     && <IHVIntegrationPanel     state={state} setState={setState} />}
                {id === "passes"  && <OptimizationPassesPanel state={state} setState={setState} />}
                {id === "infra"   && <EnterpriseInfraPanel    state={state} setState={setState} />}
                {id === "execute" && <ExecutionWorkspace       state={state} setState={setState} />}
                {id === "batch"   && <BatchProcessingPanel     state={state} setState={setState} />}
              </section>
            ))}
          </div>
        </main>
      </div>

      {/* AI sidebar */}
      <GeminiSidebar
        state={state}
        setState={setState}
        isOpen={isAiSidebarOpen}
        onClose={() => setIsAiSidebarOpen(false)}
      />
    </div>
  );
}

function LayersIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
