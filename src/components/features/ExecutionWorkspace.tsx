import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, Button, Label } from "@/components/ui";
import { UIState } from "@/types";
import {
  Code,
  Play,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  FileJson,
  X,
  Workflow,
  Globe,
  RefreshCw,
  Download,
  Laptop,
  Smartphone,
  FileCode,
  Sliders,
  Cpu,
  AlertTriangle,
  CircleDot,
} from "lucide-react";
import JSZip from "jszip";
import { RecipeGraphView } from "./RecipeGraphView";
import { cn } from "@/lib/utils";
import { buildRecipeFromState, buildRecipeJsonFromState } from "@/lib/recipePipeline";
import { fetchHardwareProbe, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";

export function ExecutionWorkspace({
  state,
  setState,
  onOpenAiAudit,
  onRunStateChange,
  onExecute: _onExecute,
  jobId: _jobId,
  isRunning: _isRunning,
  setIsRunning: _setIsRunning,
}: {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  onOpenAiAudit?: () => void;
  onRunStateChange?: (running: boolean) => void;
  onExecute?: () => void;
  jobId?: string | null;
  isRunning?: boolean;
  setIsRunning?: (v: boolean) => void;
}) {
  // Live execution state
  const [_liveJobId, setLiveJobId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [executionStatus, setExecutionStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [executionExitCode, setExecutionExitCode] = useState<number | null>(null);
  const liveSourceRef = useRef<EventSource | null>(null);
  const [recipeView, setRecipeView] = useState<"graph" | "json">("graph");
  const [_isCopied, setIsCopied] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [showGraphDot, setShowGraphDot] = useState(true);
  const [isExportCopied, setIsExportCopied] = useState(false);
  const [justQueued, setJustQueued] = useState(false);

  // States for Exporting to ONNX Runtime Web/Mobile (OWR)
  const [isOwrExportOpen, setIsOwrExportOpen] = useState(false);
  const [owrPlatform, setOwrPlatform] = useState<"web" | "mobile">("web");
  const [owrThreads, setOwrThreads] = useState("4");
  const [owrVramMode, setOwrVramMode] = useState<"performance" | "memory">("performance");
  const [owrSelectedFile, setOwrSelectedFile] = useState<
    "ort_config.json" | "web_init.js" | "mobile_init.kt" | "onnx_model_manifest.json"
  >("ort_config.json");
  const [isOwrCopied, setIsOwrCopied] = useState(false);
  const [hardwareProbe, setHardwareProbe] = useState<HardwareProbeResult | null>(null);

  useEffect(() => {
    fetchHardwareProbe()
      .then(setHardwareProbe)
      .catch(() => setHardwareProbe(null));
  }, []);

  // Dynamic generation helper for OWR Config Bundle
  const getOwrConfigs = () => {
    const rawModelId = state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model";
    const modelName = rawModelId.split("/").pop() || "model";

    // Deduce architecture
    let architecture = "DecoderLLM";
    const nameLower = modelName.toLowerCase();
    if (nameLower.includes("llama")) architecture = "Llama";
    else if (nameLower.includes("phi")) architecture = "Phi";
    else if (nameLower.includes("whisper")) architecture = "Whisper";
    else if (nameLower.includes("resnet")) architecture = "ResNet";
    else if (nameLower.includes("mobilenet")) architecture = "MobileNet";
    else if (nameLower.includes("bert")) architecture = "BERT";
    else if (nameLower.includes("stable") || nameLower.includes("diffusion"))
      architecture = "Stable Diffusion";

    const ortConfig = {
      model_path: owrPlatform === "web" ? "models/optimized/model.onnx" : "models/optimized/model.ort",
      session_options: {
        execution_mode: "ORT_SEQUENTIAL",
        execution_providers:
          owrPlatform === "web"
            ? owrVramMode === "performance"
              ? ["WebGPUExecutionProvider", "WasmExecutionProvider"]
              : ["WasmExecutionProvider"]
            : ["XnnpackExecutionProvider", "NnapiExecutionProvider"],
        graph_optimization_level: "ORT_ENABLE_ALL",
        intra_op_num_threads: parseInt(owrThreads) || 4,
        inter_op_num_threads: 1,
        log_id: owrPlatform === "web" ? "onnxruntime_web" : "onnxruntime_mobile",
        enable_profiling: false,
        enable_mem_pattern: true,
        enable_cpu_mem_arena: true,
      },
      run_options: {
        log_severity_level: 2,
      },
    };

    const manifestConfig = {
      manifest_version: "1.0.0",
      generator: "Olive OWR Cross-Compiling Exporter",
      export_date: new Date().toISOString(),
      model_metadata: {
        name: modelName,
        architecture: architecture,
        quantization: state.passes.quantization ? state.passes.quantPrecision : "none",
        precision: state.passes.conversionInputTargetTypes || "float32",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        passes_applied: Object.keys(state.passes).filter((k) => (state.passes as any)[k]),
      },
      deployment_requirements: {
        runtime: `onnxruntime-${owrPlatform}`,
        vram_constraint: owrVramMode,
        optimal_execution_providers:
          owrPlatform === "web" ? ["WebGPU", "WASM"] : ["NNAPI (Android)", "CoreML (iOS)", "XNNPACK"],
      },
    };

    const webInitCode = `// ONNX Runtime Web (OWR) Service-Worker / App Loader
// Configured dynamically for: ${modelName} (${architecture})
// Execute: npm install onnxruntime-web

import * as ort from "onnxruntime-web";

// Configure WASM and WebGPU threads
ort.env.wasm.numThreads = ${owrThreads};
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

export async function initializeOrtSession() {
  console.log("Loading OWR model pipeline from memory...");
  
  const sessionOptions = {
    executionProviders: ${owrVramMode === "performance" ? '["webgpu", "wasm"]' : '["wasm"]'},
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true
  };

  try {
    const session = await ort.InferenceSession.create("./models/optimized/model.onnx", sessionOptions);
    console.log("Session init success! Available Inputs:", session.inputNames);
    return session;
  } catch (err) {
    console.error("Failed to boot ONNX Runtime session:", err);
    throw err;
  }
}

export async function runInference(session, rawFloatBuffer) {
  // Map dynamic inputs to graph feeds
  const feeds = {};
  for (const name of session.inputNames) {
    // Creating default tensors matched to compiling specifications
    feeds[name] = new ort.Tensor("float32", new Float32Array(rawFloatBuffer || 1024), [1, 1024]);
  }
  
  const results = await session.run(feeds);
  return results;
}
`;

    const mobileInitCode = `package com.onnxruntime.mobile

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.FloatBuffer

/**
 * High-performance ONNX Runtime Mobile Wrapper Session
 * Generated dynamically for model: ${modelName} (${architecture})
 */
class OnnxModelExecutor(private val context: Context) : AutoCloseable {
    private val ortEnv: OrtEnvironment = OrtEnvironment.getEnvironment()
    private var ortSession: OrtSession? = null

    fun loadModelFromAssets(assetName: String = "model.ort") {
        val modelBytes = readAsset(assetName)
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(${owrThreads})
            // Establish target execution capabilities
            addXnnpack()
            addNnapi()
        }
        ortSession = ortEnv.createSession(modelBytes, opts)
    }

    fun runInference(inputData: FloatArray, shape: LongArray): Map<String, Any> {
        val session = ortSession ?: throw IllegalStateException("Session not initialized.")
        val buffer = FloatBuffer.wrap(inputData)
        val inputName = session.inputNames.first()
        val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)
        
        tensor.use {
            val outputs = session.run(mapOf(inputName to tensor))
            return outputs.associate { it.key to it.value.value }
        }
    }

    private fun readAsset(fileName: String): ByteArray {
        context.assets.open(fileName).use { stream ->
            val byteBuffer = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            var len: Int
            while (stream.read(buffer).also { len = it } != -1) {
                byteBuffer.write(buffer, 0, len)
            }
            return byteBuffer.toByteArray()
        }
    }

    override fun close() {
        ortSession?.close()
    }
}
`;

    return { ortConfig, manifestConfig, webInitCode, mobileInitCode };
  };

  const handleDownloadOwrBundle = async () => {
    const { ortConfig, manifestConfig, webInitCode, mobileInitCode } = getOwrConfigs();
    const zip = new JSZip();

    zip.file("ort_config.json", JSON.stringify(ortConfig, null, 2));
    zip.file("onnx_model_manifest.json", JSON.stringify(manifestConfig, null, 2));

    if (owrPlatform === "web") {
      zip.file("web_init.js", webInitCode);
    } else {
      zip.file("mobile_init.kt", mobileInitCode);
    }

    const rawModelId = state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model";
    const modelName = rawModelId.split("/").pop() || "model";

    const readme = `ONNX Runtime Web/Mobile (OWR) Deployment Bundle
==================================================
Created: ${new Date().toLocaleString()}
Target Environment: ONNX Runtime ${owrPlatform === "web" ? "Web (WebGPU/WASM)" : "Mobile (Android/iOS)"}
Optimized Model: ${modelName}

Contents of this bundle:
1. onnx_model_manifest.json - Full optimization and pipeline conversion audit trail from MS Olive.
2. ort_config.json - Direct configuration rules for loading the model session dynamically.
3. ${owrPlatform === "web" ? "web_init.js" : "mobile_init.kt"} - Boilerplate initialization and execution patterns.

Deployment Steps:
${
  owrPlatform === "web"
    ? "- Place the optimized model file (model.onnx) in your public asset folder.\n- Install 'onnxruntime-web' dependency using npm.\n- Import and invoke your customized initializeOrtSession() function. "
    : "- Place the compiled ORT flatbuffer file (model.ort) under your Android App's 'src/main/assets' directory.\n- Implement 'ai.onnxruntime:onnxruntime-android' via gradle.\n- Wire up your OnnxModelExecutor wrapper inside Activities/Handlers."
}
`;
    zip.file("README.txt", readme);

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      const modelCleanName = modelName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      link.download = `owr_bundle_${owrPlatform}_${modelCleanName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ZIP Generation failed", e);
    }
  };

  const pipeline = buildRecipeFromState(state, { hardwareProbe });
  const { recipe, recipeJson, validation, schema, advisories, isRunnable } = pipeline;
  const validationLabel = !schema.valid
    ? `Schema invalid (${schema.errors.length} issue${schema.errors.length === 1 ? "" : "s"})`
    : validation.statusLabel;
  const validationTone = !schema.valid ? "error" : validation.statusTone;

  const handleQueueJob = () => {
    if (!isRunnable) {
      setExecutionLogs([
        schema.valid
          ? `[ERROR] Cannot queue batch job: ${validation.criticalCount} blocking compatibility issue(s). Resolve in the graph or passes panel.`
          : `[ERROR] Cannot queue batch job: recipe schema invalid.\n${schema.errors.map((e) => `[SCHEMA] ${e}`).join("\n")}`,
      ]);
      return;
    }

    const activePassesNames: string[] = [];
    if (state.passes.conversion)
      activePassesNames.push(
        `Conversion (${state.passes.conversionFormat === "onnx" ? "ONNX" : "OpenVINO"})`,
      );
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

    const recipeJsonForJob = buildRecipeJsonFromState(state);

    const newJob = {
      id: "job-" + Date.now(),
      name: jobName,
      modelSource: state.modelSource,
      modelIdentifier: mid,
      provider: state.ihvProvider,
      passes: activePassesNames,
      recipeJson: recipeJsonForJob,
      status: "queued" as const,
      progress: 0,
      progressKnown: true,
      logs: ["Job created from active template configuration. Awaiting queue start."],
    };

    const currentJobs = state.batchJobs || [];
    setState({ batchJobs: [...currentJobs, newJob] });
    setJustQueued(true);
    setTimeout(() => setJustQueued(false), 3000);
  };

  const handleExecuteLive = async () => {
    if (isRunning) return;

    if (!isRunnable) {
      setExecutionLogs([
        schema.valid
          ? `[ERROR] Cannot execute: ${validation.criticalCount} blocking compatibility issue(s).`
          : `[ERROR] Cannot execute: recipe schema invalid.`,
        ...(schema.valid
          ? validation.issues
              .filter((issue) => issue.severity === "critical")
              .map((issue) => `[BLOCK] ${issue.title}: ${issue.description}`)
          : schema.errors.map((e) => `[SCHEMA] ${e}`)),
      ]);
      setExecutionStatus("failed");
      return;
    }

    setIsRunning(true);
    onRunStateChange?.(true);
    setExecutionLogs(["[INFO] Initiating Olive run...\n"]);
    setExecutionStatus("running");
    setExecutionExitCode(null);

    try {
      const resp = await fetch("/api/olive/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeJson, cudaVersion: state.cudaVersion ?? "auto" }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setExecutionLogs((prev) => [...prev, `[ERROR] ${errData.error}`]);
        setExecutionStatus("failed");
        setIsRunning(false);
        onRunStateChange?.(false);
        return;
      }

      const { jobId } = await resp.json();
      setLiveJobId(jobId);
      setState({ activeJobId: jobId });

      // Close any existing SSE connection
      liveSourceRef.current?.close();

      // Open SSE connection
      const evtSource = new EventSource(`/api/olive/stream/${jobId}`);
      liveSourceRef.current = evtSource;

      // Standard message event (log lines)
      evtSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.line) {
            setExecutionLogs((prev) => [...prev, payload.line]);
          }
        } catch {
          /* ignore malformed */
        }
      };

      // Named 'done' event — fired when the Olive process exits
      evtSource.addEventListener("done", (e: MessageEvent) => {
        let exitCode = 0;
        try {
          exitCode = JSON.parse(e.data)?.exitCode ?? 0;
        } catch {
          exitCode = 0;
        }
        setExecutionStatus(exitCode === 0 ? "completed" : "failed");
        setExecutionExitCode(exitCode);
        setIsRunning(false);
        onRunStateChange?.(false);
        evtSource.close();
        liveSourceRef.current = null;
      });

      evtSource.onerror = () => {
        setExecutionLogs((prev) => [...prev, "[ERROR] SSE connection lost."]);
        setExecutionStatus("failed");
        setIsRunning(false);
        onRunStateChange?.(false);
        evtSource.close();
        liveSourceRef.current = null;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setExecutionLogs((prev) => [...prev, `[ERROR] ${err.message}`]);
      setExecutionStatus("failed");
      setIsRunning(false);
      onRunStateChange?.(false);
    }
  };

  const _handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleExportCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
    setIsExportCopied(true);
    setTimeout(() => setIsExportCopied(false), 2000);
  };

  const handleExportDownload = () => {
    const jsonString = JSON.stringify(recipe, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const modelCleanName = (state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase();
    link.href = url;
    link.download = `olive_recipe_${modelCleanName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 relative">
      {/* Export Recipe Overlay */}
      {isExportOpen && (
        <div className="absolute inset-0 z-55 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in overflow-y-auto">
          <Card className="w-full max-w-2xl border-electric-blue/30 flex flex-col max-h-[85vh]">
            <CardHeader
              title="Export Microsoft Olive Recipe"
              description="Download your dynamic JSON recipe configuration or copy the schema to run with the MS Olive CLI."
              badge={
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-slate-800"
                  onClick={() => setIsExportOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              }
            />
            <CardContent className="flex flex-col gap-4 overflow-hidden flex-1 p-6">
              <div className="flex-1 min-h-[300px] relative flex flex-col overflow-hidden bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-900/40">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-mono text-slate-300">olive_recipe.json</span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                    VALID OLIVE SCHEMA
                  </span>
                </div>
                <textarea
                  readOnly
                  className="w-full flex-1 bg-transparent p-4 font-mono text-xs text-emerald-400 focus-visible:outline-none resize-none overflow-y-auto cursor-text"
                  value={JSON.stringify(recipe, null, 2)}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>

              <div className="flex justify-between items-center gap-3 pt-2">
                <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                  Generated dynamic recipe mapping
                </span>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <Button variant="outline" className="text-xs h-9" onClick={() => setIsExportOpen(false)}>
                    Close
                  </Button>
                  <Button
                    variant="outline"
                    className="text-xs h-9 border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                    onClick={handleExportCopy}
                  >
                    {isExportCopied ? (
                      <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4 mr-1.5" />
                    )}
                    {isExportCopied ? "Copied!" : "Copy to Clipboard"}
                  </Button>
                  <Button
                    variant="default"
                    className="text-xs h-9 bg-electric-blue hover:bg-electric-blue/90 text-white"
                    onClick={handleExportDownload}
                  >
                    <Download className="h-4 w-4 mr-1.5" /> Save File (.json)
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* OWR Export Bundle Overlay */}
      {isOwrExportOpen &&
        (() => {
          const { ortConfig, manifestConfig, webInitCode, mobileInitCode } = getOwrConfigs();

          let fileTitle = "";
          let fileContent = "";
          if (owrSelectedFile === "ort_config.json") {
            fileTitle = "ort_config.json";
            fileContent = JSON.stringify(ortConfig, null, 2);
          } else if (owrSelectedFile === "onnx_model_manifest.json") {
            fileTitle = "onnx_model_manifest.json";
            fileContent = JSON.stringify(manifestConfig, null, 2);
          } else if (owrSelectedFile === "web_init.js") {
            fileTitle = "web_init.js";
            fileContent = webInitCode;
          } else {
            fileTitle = "mobile_init.kt";
            fileContent = mobileInitCode;
          }

          const handleCopyActiveCode = () => {
            navigator.clipboard.writeText(fileContent);
            setIsOwrCopied(true);
            setTimeout(() => setIsOwrCopied(false), 2000);
          };

          return (
            <div className="absolute inset-0 z-55 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in overflow-y-auto">
              <Card className="w-full max-w-4xl border-electric-blue/30 flex flex-col max-h-[90vh]">
                <CardHeader
                  title="Export for ONNX Runtime (Web/Mobile)"
                  description="Package specific metadata configurations, environment session maps, and code initializers for seamless OWR edge deployment."
                  badge={
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0 hover:bg-slate-800"
                      onClick={() => setIsOwrExportOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  }
                />
                <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 overflow-auto flex-1">
                  {/* Left Parameter Panel: Platform Config & Variables */}
                  <div className="md:col-span-4 flex flex-col gap-4 border-r border-slate-900/60 pr-4">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5 text-electric-blue" /> Target Platform Runtime
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${
                              owrPlatform === "web"
                                ? "bg-electric-blue/15 border-electric-blue/50 text-electric-blue font-semibold"
                                : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800"
                            }`}
                            onClick={() => {
                              setOwrPlatform("web");
                              if (owrSelectedFile === "mobile_init.kt") {
                                setOwrSelectedFile("web_init.js");
                              }
                            }}
                          >
                            <Laptop className="h-5 w-5" />
                            ORT Web
                          </button>
                          <button
                            type="button"
                            className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${
                              owrPlatform === "mobile"
                                ? "bg-electric-blue/15 border-electric-blue/50 text-electric-blue font-semibold"
                                : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800"
                            }`}
                            onClick={() => {
                              setOwrPlatform("mobile");
                              if (owrSelectedFile === "web_init.js") {
                                setOwrSelectedFile("mobile_init.kt");
                              }
                            }}
                          >
                            <Smartphone className="h-5 w-5" />
                            ORT Mobile
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <Label
                          htmlFor="owr-thread-allocation"
                          className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                        >
                          <Cpu className="h-3.5 w-3.5 text-electric-blue" /> Runtime Thread Allocation
                        </Label>
                        <select
                          id="owr-thread-allocation"
                          aria-label="Runtime thread allocation"
                          value={owrThreads}
                          onChange={(e) => setOwrThreads(e.target.value)}
                          className="w-full text-xs bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-sans justify-between text-slate-200 outline-none hover:border-slate-700 cursor-pointer"
                        >
                          <option value="1">1 Thread (Battery-safe)</option>
                          <option value="2">2 Threads (Optimized)</option>
                          <option value="4">4 Threads (Standard Core)</option>
                          <option value="8">8 Threads (Performance Rig)</option>
                        </select>
                        <span className="text-[10px] text-slate-500 block leading-tight">
                          Determines maximum browser/mobile parallel worker operations.
                        </span>
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <Label
                          htmlFor="owr-vram-mode"
                          className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                        >
                          <Sliders className="h-3.5 w-3.5 text-electric-blue" /> VRAM Optimizer Mode
                        </Label>
                        <select
                          id="owr-vram-mode"
                          aria-label="VRAM optimizer mode"
                          value={owrVramMode}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          onChange={(e) => setOwrVramMode(e.target.value as any)}
                          className="w-full text-xs bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-sans justify-between text-slate-200 outline-none hover:border-slate-700 cursor-pointer"
                        >
                          <option value="performance">Performance Focus (Accelerated)</option>
                          <option value="memory">Memory Conservative (Low-Memory)</option>
                        </select>
                        <span className="text-[10px] text-slate-500 block leading-tight">
                          Configured to leverage WebGPU execution providers or WASM pipelines.
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-slate-900/60 space-y-2">
                      <div className="p-3 rounded-lg bg-electric-blue/5 border border-electric-blue/10 text-[11px] text-slate-400 leading-relaxed font-sans">
                        <strong>Olive OWR Cross-compile:</strong> Generates structural session configs mapped
                        dynamically to the model's weight format, execution steps, and target drivers.
                      </div>
                    </div>
                  </div>

                  {/* Right Interactive Code Viewer */}
                  <div className="md:col-span-8 flex flex-col gap-4 overflow-hidden h-full">
                    <div className="flex bg-slate-950 p-1 border border-slate-850 rounded-lg overflow-x-auto shrink-0 gap-1 scrollbar-none">
                      <button
                        type="button"
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${
                          owrSelectedFile === "onnx_model_manifest.json"
                            ? "bg-electric-blue text-white font-medium"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                        onClick={() => setOwrSelectedFile("onnx_model_manifest.json")}
                      >
                        onnx_model_manifest.json
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${
                          owrSelectedFile === "ort_config.json"
                            ? "bg-electric-blue text-white font-medium"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                        onClick={() => setOwrSelectedFile("ort_config.json")}
                      >
                        ort_config.json
                      </button>
                      {owrPlatform === "web" ? (
                        <button
                          type="button"
                          className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${
                            owrSelectedFile === "web_init.js"
                              ? "bg-electric-blue text-white font-medium"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                          onClick={() => setOwrSelectedFile("web_init.js")}
                        >
                          web_init.js
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${
                            owrSelectedFile === "mobile_init.kt"
                              ? "bg-electric-blue text-white font-medium"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                          onClick={() => setOwrSelectedFile("mobile_init.kt")}
                        >
                          mobile_init.kt
                        </button>
                      )}
                    </div>

                    <div className="flex-1 min-h-[250px] relative flex flex-col overflow-hidden bg-slate-950 border border-slate-850 rounded-lg">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-900/40 shrink-0">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                          <FileCode className="h-4 w-4 text-electric-blue" />
                          <span>{fileTitle}</span>
                        </div>
                        <span className="text-[10px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono">
                          ORT export
                        </span>
                      </div>

                      <textarea
                        readOnly
                        className="w-full flex-1 bg-transparent p-4 font-mono text-xs text-electric-blue focus-visible:outline-none resize-none overflow-y-auto cursor-text whitespace-pre bg-transparent select-text"
                        value={fileContent}
                        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      />
                    </div>

                    <div className="flex justify-between items-center gap-3 pt-2 shrink-0">
                      <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                        Includes boilerplate loaders & execution environment configs
                      </span>
                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <Button
                          variant="outline"
                          className="text-xs h-9"
                          onClick={() => setIsOwrExportOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="outline"
                          className="text-xs h-9 border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                          onClick={handleCopyActiveCode}
                        >
                          {isOwrCopied ? (
                            <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4 mr-1.5" />
                          )}
                          {isOwrCopied ? "Copied!" : "Copy Active File"}
                        </Button>
                        <Button
                          variant="default"
                          className="text-xs h-9 bg-electric-blue hover:bg-electric-blue-dark text-white font-bold"
                          onClick={handleDownloadOwrBundle}
                        >
                          <Download className="h-4 w-4 mr-1.5" /> Download Bundle (.zip)
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

      {/* Recipe Preview */}
      <Card
        className={cn(
          "flex flex-col overflow-hidden",
          recipeView === "graph" ? "min-h-[520px]" : "min-h-[420px]",
        )}
      >
        <CardHeader
          title="Olive Recipe Definition"
          description={
            recipeView === "graph"
              ? "Interactive graph of the compilation and configuration pipeline."
              : "The exact JSON schema that will be sent to the Olive Engine."
          }
          badge={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-slate-900 border border-slate-800 rounded p-0.5">
                <button
                  type="button"
                  onClick={() => setRecipeView("graph")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${
                    recipeView === "graph"
                      ? "bg-electric-blue text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Workflow className="h-3 w-3" /> Graph Flow
                </button>
                <button
                  type="button"
                  onClick={() => setRecipeView("json")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${
                    recipeView === "json"
                      ? "bg-electric-blue text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Code className="h-3 w-3" /> JSON Code
                </button>
              </div>
              {recipeView === "graph" && (
                <button
                  type="button"
                  onClick={() => setShowGraphDot((v) => !v)}
                  title={showGraphDot ? "Hide flow dot" : "Show flow dot"}
                  className={`h-8 w-8 flex items-center justify-center rounded border transition-colors cursor-pointer ${
                    showGraphDot
                      ? "border-electric-blue/30 text-electric-blue hover:bg-electric-blue/10"
                      : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                  }`}
                >
                  <CircleDot className="h-3.5 w-3.5" />
                </button>
              )}
              <Button
                variant="outline"
                className="h-8 px-3 text-xs border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                onClick={() => setIsExportOpen(true)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Recipe
              </Button>
              <Button
                variant="outline"
                className="h-8 px-3 text-xs border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                onClick={() => setIsOwrExportOpen(true)}
              >
                <Globe className="h-3.5 w-3.5 mr-1.5" /> Export for OWR
              </Button>
            </div>
          }
        />
        {recipeView === "graph" ? (
          <CardContent className="flex-1 overflow-hidden p-0 min-h-[420px]">
            <RecipeGraphView state={state} setState={setState} showDot={showGraphDot} />
          </CardContent>
        ) : (
          <CardContent className="flex-1 overflow-auto bg-slate-950 p-4 m-6 mt-0 rounded-lg border border-slate-800 min-h-[360px]">
            <pre className="text-xs font-mono text-emerald-400">{JSON.stringify(recipe, null, 2)}</pre>
          </CardContent>
        )}
      </Card>

      {/* Active Draft — execution controls + live log in one card */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader
          title="Active Draft"
          description={
            executionStatus === "running"
              ? "Olive is running — streaming optimization logs."
              : executionStatus === "completed"
                ? `Run completed (exit 0)`
                : executionStatus === "failed"
                  ? `Run failed (exit ${executionExitCode ?? "?"})`
                  : "Review recipe above, then execute live or add to batch queue."
          }
          badge={
            <div className="flex items-center gap-2 flex-wrap">
              {executionStatus === "running" && (
                <span className="flex items-center gap-1.5 text-xs font-mono bg-electric-blue/10 text-electric-blue border border-electric-blue/30 px-2.5 py-1 rounded">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Running
                </span>
              )}
              {executionStatus === "completed" && (
                <span className="flex items-center gap-1.5 text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded">
                  <CheckCircle2 className="h-3 w-3" /> Done
                </span>
              )}
              {executionStatus === "failed" && (
                <span className="flex items-center gap-1.5 text-xs font-mono bg-red-500/10 text-red-400 border border-red-500/30 px-2.5 py-1 rounded">
                  <AlertCircle className="h-3 w-3" /> Failed
                </span>
              )}
              <Button
                variant="outline"
                className="h-8 px-2.5 text-xs border-slate-700 text-slate-300 hover:border-electric-blue/40 hover:text-electric-blue"
                onClick={() => onOpenAiAudit?.()}
              >
                Review
              </Button>
            </div>
          }
        />
        <CardContent className="flex flex-col gap-4 p-4">
          <VramEstimateBanner state={state} compact />
          {schema.errors.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
              {schema.errors.map((error) => (
                <div key={error} className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-rose-200 leading-relaxed">{error}</p>
                </div>
              ))}
            </div>
          )}
          {advisories.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              {advisories.map((issue) => (
                <div key={issue.id} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-300">{issue.title}</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{issue.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              {validationTone === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : validationTone === "warning" ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-400" />
              )}
              <span
                className={`text-xs sm:text-sm font-medium ${
                  validationTone === "success"
                    ? "text-emerald-400"
                    : validationTone === "warning"
                      ? "text-amber-300"
                      : "text-rose-300"
                }`}
              >
                {validationLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {justQueued ? (
                <span className="text-xs text-electric-blue font-semibold font-mono mr-2">Queued</span>
              ) : (
                <Button
                  variant="outline"
                  className="h-9 px-3 text-xs border-dashed border-slate-700 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40"
                  onClick={handleQueueJob}
                  disabled={!isRunnable}
                >
                  + Queue
                </Button>
              )}
              <Button
                variant="success"
                onClick={handleExecuteLive}
                disabled={isRunning || !isRunnable}
                className="h-9 text-xs"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Olive running...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" fill="currentColor" /> Execute Live
                  </>
                )}
              </Button>
            </div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-md p-4 font-mono text-xs text-emerald-400 space-y-0.5 h-[220px] overflow-y-auto">
            {executionLogs.length === 0 ? (
              <p className="text-slate-500 italic">
                Ready — click &quot;Execute Live&quot; to begin an Olive optimization run.
              </p>
            ) : (
              executionLogs.map((line, i) => (
                <p
                  key={i}
                  className={
                    line.includes("[ERROR]")
                      ? "text-red-400"
                      : line.includes("[SETUP]")
                        ? "text-amber-400"
                        : line.includes("[DONE]")
                          ? "text-emerald-300 font-bold"
                          : "text-emerald-400"
                  }
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
