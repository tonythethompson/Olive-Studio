import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, Button, Label, Input, Select, Switch } from "@/components/ui";
import { UIState, BatchJob, IHVProvider, ModelSource } from "@/types";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  PlayCircle, 
  XCircle, 
  ChevronRight, 
  Database, 
  Cpu, 
  Layers, 
  FolderPlus,
  ArrowRight,
  Sparkles,
  AlertCircle
} from "lucide-react";

export function BatchProcessingPanel({ state, setState }: { state: UIState; setState: (s: Partial<UIState>) => void }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>("job-2");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Custom job creation states
  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("meta-llama/Llama-3-8B");
  const [newSource, setNewSource] = useState<ModelSource>("huggingface");
  const [newProvider, setNewProvider] = useState<IHVProvider>("CUDAExecutionProvider");
  
  // Enabled passes for custom job
  const [passConv, setPassConv] = useState(true);
  const [passQuant, setPassQuant] = useState(true);
  const [passPruning, setPassPruning] = useState(false);
  const [passTransformer, setPassTransformer] = useState(false);

  // Initialize batchJobs in global state if not present
  useEffect(() => {
    if (!state.batchJobs) {
      const initialBatchJobs: BatchJob[] = [
        {
          id: "job-1",
          name: "Llama-3-8B PTQ Quantization Strategy",
          modelSource: "huggingface",
          modelIdentifier: "meta-llama/Meta-Llama-3-8B",
          provider: "CUDAExecutionProvider",
          passes: ["Model Conversion", "OnnxQuantization (4-bit Dynamic)"],
          status: "completed",
          progress: 100,
          logs: [
            "[10:30:12] Initializing Olive pipeline for CUDAExecutionProvider...",
            "[10:30:15] Loaded Hugging Face model metadata for meta-llama/Meta-Llama-3-8B.",
            "[10:30:20] Executing pass: Model Conversion...",
            "[10:31:05] Model Conversion succeeded. Output size: 15.6 GB.",
            "[10:31:10] Executing pass: OnnxQuantization (4-bit AWQ)...",
            "[10:32:45] Calibration completed on 512 tokens.",
            "[10:33:12] Quantization completed. Original weights dense fp16 -> quantized int4.",
            "[10:33:15] Pipeline completed successfully. Output workspace: ./outputs/llama-3-8b-int4/"
          ],
          metrics: {
            latency: "14.2 ms",
            throughput: "70.4 tok/s",
            memory: "4.8 GB",
            compression: "3.25x"
          }
        },
        {
          id: "job-2",
          name: "Whisper-Large-V3 CPU Int8 Optimization",
          modelSource: "huggingface",
          modelIdentifier: "openai/whisper-large-v3",
          provider: "CPUExecutionProvider",
          passes: ["Model Conversion", "OnnxQuantization (8-bit)", "OrtTransformersOptimization"],
          status: "running",
          progress: 45,
          logs: [
            "[10:35:01] Initializing CPU-optimized container pipeline...",
            "[10:35:05] Loading model model weights from offline HF Hub cache...",
            "[10:35:12] Model loaded. Starting standard OnnxConversion to target Opset 14...",
            "[10:35:50] Conversion passed correctly. Size matches baseline expectations (3.1 GB).",
            "[10:35:54] Executing OrtTransformersOptimization for custom multihead attention fusing...",
            "[10:36:10] Transformer Attention fusion applied. Optimized graph contains 14 fusions.",
            "[10:36:12] Entering OnnxQuantization (Int8 PTQ)..."
          ]
        },
        {
          id: "job-3",
          name: "Stable Diffusion UNet TensorRT FP16 Pass",
          modelSource: "local",
          modelIdentifier: "unet_sd15_subfolder",
          provider: "TensorrtExecutionProvider",
          passes: ["Model Conversion", "TensorRTOptimization"],
          status: "queued",
          progress: 0,
          logs: [
            "Job queued. Awaiting serial pipeline executor thread trigger..."
          ]
        }
      ];
      setState({ batchJobs: initialBatchJobs });
    }
  }, [state.batchJobs]);

  const jobs = state.batchJobs || [];

  // Sequential execution simulator trigger
  useEffect(() => {
    let interval: any = null;
    if (isProcessing) {
      interval = setInterval(() => {
        // Find the first job that is running or queued
        const currentActiveIndex = jobs.findIndex(j => j.status === "running");
        
        if (currentActiveIndex !== -1) {
          const currentJob = jobs[currentActiveIndex];
          const newProgress = Math.min(currentJob.progress + 5, 100);
          
          let updatedLogs = [...currentJob.logs];
          if (newProgress === 60 && currentJob.passes.includes("OnnxQuantization (8-bit)")) {
            updatedLogs.push(`[${new Date().toLocaleTimeString()}] ONNX Quantization PTQ layer calibration...`);
          } else if (newProgress === 80) {
            updatedLogs.push(`[${new Date().toLocaleTimeString()}] Optimizing execution graphs and exporting runtime configurations...`);
          } else if (newProgress === 100) {
            updatedLogs.push(`[${new Date().toLocaleTimeString()}] Assembly and validation check passing...`);
            updatedLogs.push(`[${new Date().toLocaleTimeString()}] Serial run completed. Workspace exported.`);
          }

          const updatedJob: BatchJob = {
            ...currentJob,
            progress: newProgress,
            logs: updatedLogs,
            status: newProgress === 100 ? "completed" : "running",
            metrics: newProgress === 100 ? {
              latency: currentJob.provider.includes("CUDA") || currentJob.provider.includes("Tensorrt") ? "9.1 ms" : "34.5 ms",
              throughput: currentJob.provider.includes("CUDA") || currentJob.provider.includes("Tensorrt") ? "105.2 req/s" : "18.1 req/s",
              memory: "1.2 GB",
              compression: "4.0x"
            } : undefined
          };

          const updatedJobs = [...jobs];
          updatedJobs[currentActiveIndex] = updatedJob;
          setState({ batchJobs: updatedJobs });
        } else {
          // No active job running, check if there is a queued job we can transition to 'running'
          const nextQueuedIndex = jobs.findIndex(j => j.status === "queued");
          if (nextQueuedIndex !== -1) {
            const updatedJobs = [...jobs];
            updatedJobs[nextQueuedIndex] = {
              ...updatedJobs[nextQueuedIndex],
              status: "running",
              progress: 5,
              logs: [
                `[${new Date().toLocaleTimeString()}] Serial Queue triggered. Initializing Olive workspace...`,
                `[${new Date().toLocaleTimeString()}] Pulling environment configuration targets...`,
                `[${new Date().toLocaleTimeString()}] Running passes sequentially: ${updatedJobs[nextQueuedIndex].passes.join(" → ")}`
              ]
            };
            setState({ batchJobs: updatedJobs });
          } else {
            // No running or queued jobs remaining, turn off execution simulator
            setIsProcessing(false);
          }
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isProcessing, jobs]);

  // Queue current dashboard configuration
  const handleQueueCurrent = () => {
    const activePassesNames: string[] = [];
    if (state.passes.conversion) activePassesNames.push(`Conversion (${state.passes.conversionFormat === "onnx" ? "ONNX" : "OpenVINO"})`);
    if (state.passes.quantization) activePassesNames.push(`Quantization (${state.passes.quantPrecision})`);
    if (state.passes.pruning) activePassesNames.push(`Pruning (${state.passes.pruningMethod})`);
    if (state.passes.onnxTransforms) activePassesNames.push("ORT Transforms");
    
    if (activePassesNames.length === 0) {
      activePassesNames.push("Default Baseline Export");
    }

    let mid = "Offline Weights Folder";
    if (state.modelSource === "huggingface") {
      mid = state.hfModelId || "unspecified-hf-model";
    } else if (state.modelSource === "azure") {
      mid = state.azureModelPath || "AzureML Asset Container";
    }

    const jobName = `Staged: ${mid.split("/").pop()} - ${state.ihvProvider.replace("ExecutionProvider", "")}`;

    const newJob: BatchJob = {
      id: "job-" + Date.now(),
      name: jobName,
      modelSource: state.modelSource,
      modelIdentifier: mid,
      provider: state.ihvProvider,
      passes: activePassesNames,
      status: "queued",
      progress: 0,
      logs: ["Job created from active template configuration. Awaiting queue start."]
    };

    setState({ batchJobs: [...jobs, newJob] });
    setSelectedJobId(newJob.id);
  };

  const handleAddCustom = () => {
    if (!newModelName.trim()) return;

    const chosenPasses: string[] = [];
    if (passConv) chosenPasses.push("Model Conversion (ONNX)");
    if (passQuant) chosenPasses.push("Quantization (INT8 PTQ)");
    if (passPruning) chosenPasses.push("Sparsity Pruning");
    if (passTransformer) chosenPasses.push("Graph Transformers Fusions");
    if (chosenPasses.length === 0) chosenPasses.push("Model Assembly Standard Pass");

    const newJob: BatchJob = {
      id: "job-" + Date.now(),
      name: newModelName,
      modelSource: newSource,
      modelIdentifier: newModelId || "source_weights",
      provider: newProvider,
      passes: chosenPasses,
      status: "queued",
      progress: 0,
      logs: ["Custom pipeline queued manually via workspace controller."]
    };

    setState({ batchJobs: [...jobs, newJob] });
    setSelectedJobId(newJob.id);
    
    // Reset inputs
    setNewModelName("");
    setNewModelId("");
    setShowAddForm(false);
  };

  const handleDeleteJob = (id: string) => {
    const filtered = jobs.filter(j => j.id !== id);
    setState({ batchJobs: filtered });
    if (selectedJobId === id) {
      setSelectedJobId(filtered.length > 0 ? filtered[0].id : null);
    }
  };

  const handleResetQueue = () => {
    const resetJobs = jobs.map(j => ({
      ...j,
      status: "queued" as const,
      progress: 0,
      logs: ["Pipeline reset to initial queued state by analyst."],
      metrics: undefined
    }));
    setState({ batchJobs: resetJobs });
  };

  const counts = {
    queued: jobs.filter(j => j.status === "queued").length,
    running: jobs.filter(j => j.status === "running").length,
    completed: jobs.filter(j => j.status === "completed").length,
    total: jobs.length
  };

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Sidebar Queue List */}
      <div className="xl:col-span-2 space-y-6">
        <Card>
          <CardHeader 
            title="Olive Batch Serialization Queue" 
            description="Manage sequential optimization jobs to execute parallel permutations or benchmark suites."
            badge={
              <div className="flex gap-2">
                 <Button variant="outline" className="h-8 text-xs shrink-0" onClick={handleQueueCurrent}>
                   Queue Active Setup
                 </Button>
                 <Button variant="default" className="h-8 text-xs bg-electric-blue text-white shrink-0" onClick={() => setShowAddForm(!showAddForm)}>
                   <Plus className="h-4 w-4 mr-1" /> Custom Job
                 </Button>
              </div>
            }
          />

          <CardContent className="space-y-4">
             {/* Info Bar */}
             <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs font-mono">
                <div className="flex items-center gap-4">
                   <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500 animate-pulse" /> {counts.queued} Queued</div>
                   <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-electric-blue animate-pulse" /> {counts.running} Processing</div>
                   <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> {counts.completed} Completed</div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    variant={isProcessing ? "outline" : "default"} 
                    className="h-8 text-xs font-semibold px-4" 
                    onClick={() => setIsProcessing(!isProcessing)}
                    disabled={counts.queued === 0 && counts.running === 0 && !isProcessing}
                  >
                     {isProcessing ? <><Pause className="h-3.5 w-3.5 mr-1" /> Halt Serial Engine</> : <><Play className="h-3.5 w-3.5 mr-1 text-emerald-400 fill-emerald-400" /> Start Queue</>}
                  </Button>
                  <Button variant="outline" className="h-8 p-2" title="Reset all statuses to Queued" onClick={handleResetQueue}>
                     <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </div>
             </div>

             {/* Slide down Custom form */}
             {showAddForm && (
               <div className="p-5 border border-slate-750 bg-slate-950 rounded-xl space-y-4 animate-in slide-in-from-top-4 duration-200">
                  <div className="flex items-center justify-between">
                     <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <FolderPlus className="h-4.5 w-4.5 text-electric-blue" />
                        Configure New Batch Job Entry
                     </h4>
                     <button className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer" onClick={() => setShowAddForm(false)}>Cancel</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                       <Label>Job Name</Label>
                       <Input 
                         placeholder="e.g. Phi-3 mini-4k Int4 CUDA" 
                         value={newModelName}
                         onChange={(e) => setNewModelName(e.target.value)}
                       />
                     </div>
                     <div className="space-y-1.5">
                       <Label>Model Identifier</Label>
                       <Input 
                         placeholder="e.g. microsoft/Phi-3-mini-4k-instruct" 
                         value={newModelId}
                         onChange={(e) => setNewModelId(e.target.value)}
                       />
                     </div>
                     <div className="space-y-1.5">
                       <Label>Source Provider</Label>
                        <Select value={newSource} onChange={(e) => setNewSource(e.target.value as any)}>
                          <option value="huggingface">Hugging Face Hub</option>
                          <option value="local">Local Files Chunked</option>
                          <option value="azure">Azure ML Asset</option>
                        </Select>
                     </div>
                     <div className="space-y-1.5">
                       <Label>Target Execution Provider</Label>
                        <Select value={newProvider} onChange={(e) => setNewProvider(e.target.value as any)}>
                          <option value="CUDAExecutionProvider">GPU: NVIDIA CUDA</option>
                          <option value="TensorrtExecutionProvider">GPU: NVIDIA TensorRT</option>
                          <option value="CPUExecutionProvider">CPU: ONNX Standard</option>
                          <option value="OpenVINOExecutionProvider">CPU/GPU: Intel OpenVINO</option>
                        </Select>
                     </div>
                  </div>

                  {/* Active Passes for manual additions */}
                  <div className="space-y-2 border-t border-slate-900 pt-4">
                     <Label className="text-xs text-slate-400 uppercase tracking-wider">Pass Pipeline Elements</Label>
                     <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                          <input type="checkbox" checked={passConv} onChange={() => setPassConv(!passConv)} className="accent-electric-blue" />
                          <span>Conversion</span>
                        </label>
                        <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                          <input type="checkbox" checked={passQuant} onChange={() => setPassQuant(!passQuant)} className="accent-electric-blue" />
                          <span>Quantization</span>
                        </label>
                        <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                          <input type="checkbox" checked={passPruning} onChange={() => setPassPruning(!passPruning)} className="accent-electric-blue" />
                          <span>Weight Pruning</span>
                        </label>
                        <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                          <input type="checkbox" checked={passTransformer} onChange={() => setPassTransformer(!passTransformer)} className="accent-electric-blue" />
                          <span>Attention Fusions</span>
                        </label>
                     </div>
                  </div>

                  <div className="flex justify-end pt-2">
                     <Button variant="default" className="px-6 text-xs bg-electric-blue text-white" disabled={!newModelName.trim()} onClick={handleAddCustom}>
                        Inject Into Serials Queues
                     </Button>
                  </div>
               </div>
             )}

             {/* Queue Jobs Cards */}
             <div className="space-y-2.5">
               {jobs.length === 0 ? (
                 <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 text-slate-500">
                   <Layers className="h-10 w-10 mx-auto mb-3 opacity-30 text-slate-400" />
                   <h5 className="font-semibold text-slate-400 mb-1">Queue Empty</h5>
                   <p className="text-xs text-slate-500 max-w-sm mx-auto">Configure your source models and trigger passes to queue jobs or add a custom sequence manually.</p>
                 </div>
               ) : (
                 jobs.map(job => {
                   const isSelected = selectedJobId === job.id;
                   return (
                     <div 
                       key={job.id}
                       onClick={() => setSelectedJobId(job.id)}
                       className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                         isSelected 
                           ? 'border-electric-blue bg-electric-blue/5 shadow-[0_0_15px_rgba(59,130,246,0.05)]' 
                           : 'border-slate-800/80 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/50'
                       }`}
                     >
                       <div className="flex items-start gap-3.5 min-w-0">
                          {/* Status Icon */}
                          <div className="mt-0.5 shrink-0">
                             {job.status === "completed" && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                             {job.status === "running" && <PlayCircle className="h-5 w-5 text-electric-blue animate-pulse" />}
                             {job.status === "queued" && <Clock className="h-5 w-5 text-slate-500" />}
                             {job.status === "failed" && <XCircle className="h-5 w-5 text-red-500" />}
                          </div>

                          <div className="min-w-0">
                             <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                <h4 className={`text-sm font-semibold truncate ${isSelected ? "text-slate-100" : "text-slate-300"}`}>{job.name}</h4>
                                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${
                                  job.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                                  job.status === "running" ? "bg-electric-blue/10 text-electric-blue" :
                                  "bg-slate-800 text-slate-400"
                                }`}>
                                   {job.status}
                                </span>
                             </div>

                             <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                                <span className="flex items-center gap-1 font-mono text-slate-450"><Database className="h-3 w-3" /> {job.modelIdentifier.split('/').pop()}</span>
                                <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {job.provider.replace("ExecutionProvider", "")}</span>
                             </div>

                             {/* Passes tag pill representation */}
                             <div className="flex flex-wrap gap-1 mt-2.5">
                                {job.passes.map((p, idx) => (
                                   <span key={idx} className="text-[10px] font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850 text-slate-400">
                                      {p}
                                   </span>
                                ))}
                             </div>
                          </div>
                       </div>

                       <div className="flex items-center justify-between sm:justify-end gap-4 mt-4 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-900 shrink-0">
                          {job.status === "running" && (
                            <div className="flex flex-col items-end gap-1.5 w-24">
                              <span className="text-[10px] font-mono text-electric-blue">{job.progress}%</span>
                              <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
                                <div className="h-full bg-electric-blue transition-all duration-300" style={{ width: `${job.progress}%` }} />
                              </div>
                            </div>
                          )}

                          {job.status === "completed" && job.metrics && (
                            <div className="text-right text-xs bg-emerald-500/5 px-2.5 py-1.5 rounded-md border border-emerald-500/10">
                              <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider font-mono">LATENCY</span>
                              <span className="font-semibold text-emerald-400 font-mono">{job.metrics.latency}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-1">
                             <button onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }} className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-900 transition-colors shrink-0 cursor-pointer">
                                <Trash2 className="h-4 w-4" />
                             </button>
                             <ChevronRight className={`h-4 w-4 text-slate-600 ${isSelected ? "text-slate-350" : ""}`} />
                          </div>
                       </div>
                     </div>
                   )
                 })
               )}
             </div>
          </CardContent>
        </Card>
      </div>

      {/* Selected Job details Panel */}
      <div className="space-y-6">
         <Card className="h-[calc(100vh-140px)] flex flex-col overflow-hidden">
           <CardHeader 
             title="Run Pipeline Analysis" 
             description="Inspect selected batch execution profiles and log outputs."
             badge={<Layers className="h-4 w-4 text-slate-500" />}
           />

           <CardContent className="flex-1 overflow-y-auto space-y-5 flex flex-col p-6 pt-0">
              {selectedJob ? (
                <>
                  <div className="space-y-3.5 bg-slate-950/40 p-4 border border-slate-900 rounded-xl text-xs">
                     <div className="flex justify-between items-center text-slate-450 border-b border-slate-900 pb-2">
                        <span className="font-semibold text-slate-300">Run Configuration Overview</span>
                     </div>
                     <div className="grid grid-cols-2 gap-3 font-mono">
                        <div>
                           <span className="text-slate-500 text-[10px] block uppercase font-bold">Model Base</span>
                           <span className="text-slate-350 text-xs truncate block mt-0.5">{selectedJob.modelIdentifier}</span>
                        </div>
                        <div>
                           <span className="text-slate-500 text-[10px] block uppercase font-bold">Provider target</span>
                           <span className="text-slate-350 text-xs truncate block mt-0.5">{selectedJob.provider}</span>
                        </div>
                     </div>
                  </div>

                  {/* Benchmark targets summary */}
                  {selectedJob.status === "completed" && selectedJob.metrics ? (
                    <div className="grid grid-cols-2 gap-2.5 animate-in fade-in">
                       <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                          <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono">Latency</span>
                          <span className="text-base font-bold text-slate-200 block mt-0.5 font-mono">{selectedJob.metrics.latency}</span>
                       </div>
                       <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                          <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono">Throughput</span>
                          <span className="text-base font-bold text-emerald-400 block mt-0.5 font-mono">{selectedJob.metrics.throughput}</span>
                       </div>
                       <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                          <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono font-mono">VRAM Size</span>
                          <span className="text-base font-bold text-purple-400 block mt-0.5 font-mono">{selectedJob.metrics.memory}</span>
                       </div>
                       <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center font-mono">
                          <span className="text-slate-500 text-[10px] block uppercase font-bold">Compression</span>
                          <span className="text-base font-bold text-electric-blue block mt-0.5 font-mono">{selectedJob.metrics.compression}</span>
                       </div>
                    </div>
                  ) : selectedJob.status === "running" ? (
                    <div className="p-4 rounded-lg bg-electric-blue/5 border border-electric-blue/10 flex items-center justify-between gap-3 text-xs text-electric-blue animate-pulse">
                       <span className="flex items-center gap-2 font-semibold">
                          <Play className="h-4 w-4 fill-electric-blue" />
                          Serial runner active...
                       </span>
                       <span className="font-mono">{selectedJob.progress}% complete</span>
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg bg-slate-900 border border-slate-850 flex items-center gap-3 text-xs text-slate-450">
                       <AlertCircle className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                       <span>Execution logs will stream in live once queue is triggered.</span>
                    </div>
                  )}

                  {/* Logs terminal */}
                  <div className="flex-1 flex flex-col min-h-[220px]">
                     <span className="text-[10px] uppercase font-bold tracking-wider text-slate-450 mb-1.5 block font-mono">Sequential Log Output</span>
                     <div className="flex-1 bg-slate-950 rounded-lg p-3 border border-slate-850 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-400/80">
                        {selectedJob.logs.map((log, i) => (
                           <div key={i} className="mb-1 text-balance">
                              {log}
                           </div>
                        ))}
                     </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500">
                   <Layers className="h-8 w-8 mb-2 opacity-30" />
                   <p className="text-xs">No job selected. Click any job to inspect its serialization performance.</p>
                </div>
              )}
           </CardContent>
         </Card>
      </div>

    </div>
  )
}
