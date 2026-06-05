import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UIState } from "@/types";
import { BrainCircuit, Cpu, Zap, LayoutDashboard, Terminal, Database, ListOrdered, Sparkles } from "lucide-react";
import { InputEnvironmentPanel } from "@/components/features/InputEnvironmentPanel";
import { IHVIntegrationPanel } from "@/components/features/IHVIntegrationPanel";
import { OptimizationPassesPanel } from "@/components/features/OptimizationPassesPanel";
import { EnterpriseInfraPanel } from "@/components/features/EnterpriseInfraPanel";
import { ExecutionWorkspace } from "@/components/features/ExecutionWorkspace";
import { BatchProcessingPanel } from "@/components/features/BatchProcessingPanel";
import { GeminiSidebar } from "@/components/features/GeminiSidebar";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient();

// Initial State Profile
const defaultState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "",
  hfDataset: "",
  ihvProvider: "CPUExecutionProvider",
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
  }
};

type ActiveView = "input" | "ihv" | "passes" | "infra" | "execute" | "batch";

function Dashboard() {
  const [state, setStateRaw] = useState<UIState>(defaultState);
  const [activeView, setActiveView] = useState<ActiveView>("input");
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);

  const setState = (partial: Partial<UIState>) => {
    setStateRaw(prev => ({ ...prev, ...partial }));
  };


  const navItems: { id: ActiveView; label: string; icon: any }[] = [
    { id: "input", label: "Model Source & Data", icon: BrainCircuit },
    { id: "ihv", label: "Hardware Target (IHV)", icon: Cpu },
    { id: "passes", label: "Optimization Passes", icon: Zap },
    { id: "infra", label: "Enterprise Infra", icon: Database },
    { id: "execute", label: "Recipe & Execution", icon: Terminal },
    { id: "batch", label: "Batch Queue", icon: ListOrdered },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-300 overflow-hidden font-sans">
      {/* Sidebar Navigation (Table of Contents) */}
      <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col z-10 shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-900/50 block">
          <div className="flex items-center gap-3">
             <div className="bg-electric-blue rounded border border-electric-blue/50 p-1.5 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
               <LayersIcon className="w-5 h-5 text-white" />
             </div>
             <span className="font-semibold text-slate-100 tracking-tight text-lg">Olive Studio</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          <div className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pipeline Flow</div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  const el = document.getElementById(item.id);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group",
                  isActive 
                    ? "bg-electric-blue/10 text-electric-blue" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-electric-blue" : "text-slate-500 group-hover:text-slate-400")} />
                {item.label}
              </button>
            )
          })}
        </div>
        
        <div className="p-4 border-t border-slate-800">
           <div className="bg-slate-800/50 rounded-lg p-3 text-xs flex items-start gap-2 border border-slate-800">
              <LayoutDashboard className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-slate-400 leading-relaxed">
                Scroll through the workspace to build your Olive optimization recipe from top to bottom.
              </p>
           </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-slate-950 to-slate-950">
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 shrink-0">
           <h2 className="text-lg font-medium text-slate-200 shadow-sm">
             Workspace Environment
           </h2>

           <button 
             onClick={() => setIsAiSidebarOpen(true)}
             className="px-3.5 py-1.5 bg-electric-blue/10 hover:bg-electric-blue/20 border border-electric-blue/30 hover:border-electric-blue/50 rounded-lg text-xs font-semibold text-electric-blue hover:text-white flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(59,130,246,0.06)] cursor-pointer"
           >
             <Sparkles className="h-3.5 w-3.5 text-electric-blue" />
             AI Companion Audit
           </button>
        </header>

        <main 
          className="flex-1 overflow-y-auto p-4 md:p-8 h-full scroll-smooth"
          onScroll={(e) => {
            const targets = navItems.map(item => document.getElementById(item.id));
            const scrollPos = (e.target as HTMLElement).scrollTop + 100;
            for (let i = targets.length - 1; i >= 0; i--) {
              const target = targets[i];
              if (target && target.offsetTop <= scrollPos) {
                if (activeView !== navItems[i].id) {
                  setActiveView(navItems[i].id);
                }
                break;
              }
            }
          }}
        >
          <div className="max-w-6xl mx-auto pb-24 space-y-16">
            <section id="input" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">1. Recipe Hub & Model Source</h2>
                <p className="text-sm text-slate-400 mt-1">Select an existing recipe or define the base model for optimization.</p>
              </div>
              <InputEnvironmentPanel state={state} setState={setState} />
            </section>
            
            <section id="ihv" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">2. Target Hardware (IHV)</h2>
                <p className="text-sm text-slate-400 mt-1">Choose the specific hardware accelerator and execution provider framework.</p>
              </div>
              <IHVIntegrationPanel state={state} setState={setState} />
            </section>
            
            <section id="passes" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">3. Optimization Passes</h2>
                <p className="text-sm text-slate-400 mt-1">Configure conversion, quantization, and pruning techniques.</p>
              </div>
              <OptimizationPassesPanel state={state} setState={setState} />
            </section>
            
            <section id="infra" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">4. Enterprise Infrastructure</h2>
                <p className="text-sm text-slate-400 mt-1">Connect to Azure Machine Learning or other enterprise deployments.</p>
              </div>
              <EnterpriseInfraPanel state={state} setState={setState} />
            </section>
            
            <section id="execute" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">5. Recipe Review & Execution</h2>
                <p className="text-sm text-slate-400 mt-1">Review the generated Olive workflow and trigger the optimization.</p>
              </div>
              <ExecutionWorkspace state={state} setState={setState} onExecute={async (recipeJson: string) => {
                try {
                  const resp = await fetch("/api/olive/run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recipeJson }),
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
                    console.error("Olive run failed:", err.error);
                    return;
                  }
                  const data = await resp.json();
                  setState({ activeJobId: data.jobId });
                } catch (err: any) {
                  console.error("Failed to start Olive run:", err.message);
                }
              }} />
            </section>

            <section id="batch" className="pt-2">
              <div className="mb-6 border-b border-slate-800 pb-2">
                <h2 className="text-2xl font-semibold text-slate-100">6. Batch Queue</h2>
                <p className="text-sm text-slate-400 mt-1">Monitor multi-model parallel optimization runs.</p>
              </div>
              <BatchProcessingPanel state={state} setState={setState} />
            </section>
          </div>
        </main>
      </div>

      {/* Global Slide-Over AI Companion Sidebar */}
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
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

