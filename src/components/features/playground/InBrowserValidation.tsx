import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  Globe,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Play,
  RefreshCw,
  BarChart3,
  Info,
  FileUp,
  Gauge,
  Clock,
  Zap,
  Box,
  HardDrive,
  X,
  FileCode,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type BrowserStatus = "untested" | "available" | "unavailable";
type RunStatus = "idle" | "loading-ort" | "loading-model" | "running" | "done" | "error";

interface InferenceMetrics {
  sessionCreateMs: number;
  inferenceMs: number;
  outputShapes: string[];
  inputNames: string[];
  outputNames: string[];
  epUsed: string;
}

type FormatVersion = "onnx" | "ort";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function checkWebGpu(): Promise<boolean> {
  if (!("gpu" in navigator)) return false;
  try {
    const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function InBrowserValidation({ recipeJson }: { recipeJson?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webgpuStatus, setWebgpuStatus] = useState<BrowserStatus>("untested");
  const [ortStatus, setOrtStatus] = useState<BrowserStatus>("untested");
  const [ortVersion, setOrtVersion] = useState<string>("");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [metrics, setMetrics] = useState<InferenceMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [modelFormat, setModelFormat] = useState<FormatVersion>("onnx");
  const [batchSize, setBatchSize] = useState(1);
  const [seqLen, setSeqLen] = useState(128);
  const [logOutput, setLogOutput] = useState<string[]>([]);
  const [sessionInfo, setSessionInfo] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  // Check WebGPU + ORT on mount
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const hasWebgpu = await checkWebGpu();
      if (cancelled) return;
      setWebgpuStatus(hasWebgpu ? "available" : "unavailable");

      setRunStatus("loading-ort");
      try {
        const ort = await import("onnxruntime-web");
        if (cancelled) return;
        setOrtStatus("available");
        const ver = (ort as unknown as { env: { versions: { ort: string } } }).env?.versions?.ort || "1.x";
        setOrtVersion(ver);
        setLogOutput((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] onnxruntime-web v${ver} loaded`,
        ]);
      } catch (err) {
        if (cancelled) return;
        setOrtStatus("unavailable");
        setLogOutput((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] Failed to load onnxruntime-web: ${err}`,
        ]);
      } finally {
        if (!cancelled) setRunStatus("idle");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const appendLog = useCallback((msg: string) => {
    setLogOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) return;
      setSelectedFile(file);
      setMetrics(null);
      setErrorMessage("");
      setSessionInfo("");
      const ext = file.name.split(".").pop()?.toLowerCase();
      setModelFormat(ext === "ort" ? "ort" : "onnx");
      appendLog(`Model file selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    },
    [appendLog],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileSelect(e.target.files?.[0] ?? null);
    },
    [handleFileSelect],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearModel = useCallback(() => {
    setSelectedFile(null);
    setMetrics(null);
    setErrorMessage("");
    setSessionInfo("");
    setLogOutput([]);
  }, []);

  const runInference = useCallback(async () => {
    if (!selectedFile) return;
    setErrorMessage("");
    setMetrics(null);
    setRunStatus("loading-model");

    try {
      const ortMod = await import("onnxruntime-web");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ortMod.env as any).wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

      appendLog("Reading model file...");
      const modelBuffer = await selectedFile.arrayBuffer();
      appendLog(`Loaded ${(modelBuffer.byteLength / 1024).toFixed(1)} KB into memory`);

      const hasWebgpu = await checkWebGpu();
      const eps: string[] = hasWebgpu ? ["webgpu", "wasm"] : ["wasm"];
      appendLog(`Creating session with EPs: [${eps.join(", ")}]...`);

      // Create session
      const sessionStart = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session: any = await ortMod.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: eps,
        graphOptimizationLevel: "all",
      });
      const sessionCreateMs = performance.now() - sessionStart;

      const inputs: string[] = session.inputNames;
      const outputs: string[] = session.outputNames;
      const ep = eps[0];
      setSessionInfo(`Inputs: ${inputs.join(", ")} | Outputs: ${outputs.join(", ")} | EP: ${ep}`);

      appendLog(`Session ready in ${formatMs(sessionCreateMs)}`);
      appendLog(`Provider: ${ep}`);
      appendLog(`Inputs: ${inputs.length}, Outputs: ${outputs.length}`);

      setRunStatus("running");

      // Build dummy input tensors
      const totalElements = batchSize * seqLen;
      const feeds: Record<string, unknown> = {};
      for (const name of inputs) {
        const data = new Float32Array(totalElements);
        for (let i = 0; i < totalElements; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        feeds[name] = new (ortMod as typeof import("onnxruntime-web")).Tensor("float32", data, [
          batchSize,
          seqLen,
        ]);
      }

      // Warm-up run
      appendLog("Warm-up pass...");
      await session.run(feeds);

      // Timed run
      appendLog("Running inference (timed)...");
      const runStart = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: Record<string, any> = await session.run(feeds);
      const inferenceMs = performance.now() - runStart;

      // Collect output shapes
      const outputShapes: string[] = [];
      for (const name of outputs) {
        const tensor = results[name];
        if (tensor) {
          outputShapes.push(`${name}: [${(tensor.dims as number[]).join(", ")}]`);
        }
      }

      setMetrics({
        sessionCreateMs,
        inferenceMs,
        outputShapes,
        inputNames: [...inputs],
        outputNames: [...outputs],
        epUsed: ep,
      });

      appendLog(`Inference complete in ${formatMs(inferenceMs)}`);
      appendLog(`Output shapes: ${outputShapes.join("; ")}`);
      setRunStatus("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      appendLog(`ERROR: ${msg}`);
      setRunStatus("error");
    }
  }, [selectedFile, batchSize, seqLen, appendLog]);

  return (
    <div className="flex flex-col gap-5 select-text">
      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-mono border",
            webgpuStatus === "available"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : webgpuStatus === "unavailable"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-slate-800 border-slate-700 text-slate-500",
          )}
        >
          <Globe className="h-3 w-3" />
          WebGPU{" "}
          {webgpuStatus === "available"
            ? "Available"
            : webgpuStatus === "unavailable"
              ? "Unavailable"
              : "Checking..."}
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-mono border",
            ortStatus === "available"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : ortStatus === "unavailable"
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : "bg-slate-800 border-slate-700 text-slate-500",
          )}
        >
          <Cpu className="h-3 w-3" />
          ONNX Runtime{ortVersion ? ` v${ortVersion}` : ""}{" "}
          {ortStatus === "available" ? "Loaded" : ortStatus === "unavailable" ? "Not loaded" : "Loading..."}
        </div>

        {modelFormat === "ort" && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-mono border border-blue-500/30 bg-blue-500/10 text-blue-400">
            <FileCode className="h-3 w-3" />
            ORT Flatbuffer
          </div>
        )}
      </div>

      {/* Model file upload */}
      {!selectedFile ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleBrowseClick}
          className={cn(
            "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors cursor-pointer",
            isDragging
              ? "border-electric-blue bg-electric-blue/5"
              : "border-slate-700 hover:border-slate-600 bg-slate-900/20",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".onnx,.ort"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <FileUp
            className={cn(
              "h-10 w-10 transition-colors",
              isDragging ? "text-electric-blue" : "text-slate-600",
            )}
          />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">
              Drop an ONNX model file here, or click to browse
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Supports <code className="text-electric-blue">.onnx</code> and{" "}
              <code className="text-electric-blue">.ort</code> (ORT flatbuffer) formats
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/20 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <Box className="h-5 w-5 text-electric-blue shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{selectedFile.name}</p>
              <p className="text-sm text-slate-500">
                {(selectedFile.size / 1024).toFixed(1)} KB &middot; {modelFormat.toUpperCase()} format
              </p>
            </div>
          </div>
          <Button variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={clearModel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Config + Controls row */}
      {selectedFile && (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
          <div className="sm:col-span-4 space-y-3 rounded-lg border border-slate-800 bg-slate-900/20 p-4">
            <Label className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-electric-blue" />
              Input Configuration
            </Label>
            <div className="space-y-1.5">
              <Label htmlFor="batch-size" className="text-xs text-slate-400">
                Batch size
              </Label>
              <input
                id="batch-size"
                type="number"
                min={1}
                max={64}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(1, Math.min(64, Number(e.target.value) || 1)))}
                className="w-full h-9 rounded border border-slate-700 bg-slate-950 px-2.5 text-sm text-slate-200 font-mono outline-none focus:border-electric-blue"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-len" className="text-xs text-slate-400">
                Sequence length
              </Label>
              <input
                id="seq-len"
                type="number"
                min={1}
                max={4096}
                value={seqLen}
                onChange={(e) => setSeqLen(Math.max(1, Math.min(4096, Number(e.target.value) || 1)))}
                className="w-full h-9 rounded border border-slate-700 bg-slate-950 px-2.5 text-sm text-slate-200 font-mono outline-none focus:border-electric-blue"
              />
            </div>
            <p className="text-[11px] text-slate-600 leading-tight">
              Random float32 input tensor of shape [{batchSize}, {seqLen}] will be fed to each model input.
            </p>
          </div>

          <div className="sm:col-span-8 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button
                variant={runStatus === "done" ? "success" : "default"}
                onClick={runInference}
                disabled={
                  runStatus === "loading-ort" || runStatus === "loading-model" || runStatus === "running"
                }
                className="h-10 px-5 text-sm"
              >
                {runStatus === "loading-ort" || runStatus === "loading-model" ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : runStatus === "running" ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : runStatus === "done" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Run Again
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" fill="currentColor" />
                    Run Inference
                  </>
                )}
              </Button>
              {metrics && (
                <span className="text-sm text-emerald-400 font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Last run: {formatMs(metrics.inferenceMs)}
                </span>
              )}
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200 leading-relaxed">{errorMessage}</p>
              </div>
            )}

            {sessionInfo && (
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-950/10 p-2.5">
                <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300 font-mono leading-relaxed">{sessionInfo}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results grid */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-1">
              <Clock className="h-3 w-3" />
              Inference Time
            </div>
            <p className="text-lg font-semibold text-emerald-300 font-mono tabular-nums">
              {formatMs(metrics.inferenceMs)}
            </p>
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-950/10 p-3">
            <div className="flex items-center gap-1.5 text-xs text-blue-400 mb-1">
              <HardDrive className="h-3 w-3" />
              Session Init
            </div>
            <p className="text-lg font-semibold text-blue-300 font-mono tabular-nums">
              {formatMs(metrics.sessionCreateMs)}
            </p>
          </div>
          <div className="rounded-lg border border-electric-blue/20 bg-electric-blue/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-electric-blue mb-1">
              <Zap className="h-3 w-3" />
              Execution Provider
            </div>
            <p className="text-lg font-semibold text-electric-blue font-mono tabular-nums truncate">
              {metrics.epUsed}
            </p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/20 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <BarChart3 className="h-3 w-3" />
              Outputs
            </div>
            <p className="text-lg font-semibold text-slate-200 font-mono tabular-nums">
              {metrics.outputNames.length}
            </p>
          </div>
        </div>
      )}

      {/* Output shapes detail */}
      {metrics && metrics.outputShapes.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
            <Box className="h-3 w-3" />
            Output Tensor Shapes
          </p>
          <div className="space-y-1">
            {metrics.outputShapes.map((shape, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/50 px-3 py-2"
              >
                <span className="text-sm text-slate-500 font-mono">{shape}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session log */}
      {logOutput.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-500 font-mono">Session Log</span>
            <button
              type="button"
              onClick={() => setLogOutput([])}
              className="text-[11px] text-slate-600 hover:text-slate-400 cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[180px] overflow-y-auto p-3 space-y-0.5">
            {logOutput.map((line, i) => (
              <p
                key={i}
                className={cn(
                  "text-xs font-mono leading-relaxed",
                  line.includes("ERROR") ? "text-red-400" : "text-emerald-400/80",
                )}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Recipe integration hint */}
      {recipeJson && (
        <div className="rounded-lg bg-electric-blue/5 border border-electric-blue/10 p-3">
          <p className="text-sm text-slate-400 leading-relaxed">
            <Info className="h-3.5 w-3.5 inline mr-1 text-electric-blue" />
            This inference test runs against the model in your browser. The execution provider selection above
            matches the <code className="text-electric-blue font-mono">WebGpuExecutionProvider</code>{" "}
            configured in the recipe. Upload a model exported from an Olive optimization run to verify real
            browser performance.
          </p>
        </div>
      )}
    </div>
  );
}
