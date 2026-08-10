import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button, Label } from "@/components/ui";
import { cn, formatBytes } from "@/lib/utils";
import {
  Globe,
  Cpu,
  Play,
  RefreshCw,
  Clock,
  Zap,
  BarChart3,
  Info,
  FileUp,
  HardDrive,
  X,
  Layers,
  TrendingUp,
  Thermometer,
  CheckCircle2,
  AlertCircle,
  Box,
  Activity,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type RunStatus = "idle" | "loading" | "warming" | "running" | "done" | "error";

interface BenchmarkResult {
  latencies: number[];
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p99Ms: number;
  throughputPerSec: number;
  totalTimeMs: number;
  iterations: number;
  warmupIterations: number;
  inputShapes: string[];
  outputShapes: string[];
  epUsed: string;
  modelSizeKb: number;
  estimatedGpuMemMb: number;
}

interface AdapterInfo {
  name: string;
  vendor: string;
  architecture: string;
  features: string[];
  maxBufferSize: string;
  maxComputeWorkgroupsPerDimension: number;
  maxComputeInvocationsPerWorkgroup: number;
}

interface WebGpuStatus {
  available: boolean | null;
  adapterInfo: AdapterInfo | null;
  initError: string | null;
}

type BenchmarkPreset = "quick" | "standard" | "thorough" | "custom";

const PRESETS: Record<BenchmarkPreset, { iterations: number; warmup: number; batchSize: number }> = {
  quick: { iterations: 10, warmup: 2, batchSize: 1 },
  standard: { iterations: 50, warmup: 5, batchSize: 1 },
  thorough: { iterations: 200, warmup: 10, batchSize: 1 },
  custom: { iterations: 0, warmup: 0, batchSize: 1 },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatMs(ms: number): string {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

function formatThroughput(t: number): string {
  if (t > 1000) return `${(t / 1000).toFixed(1)}K`;
  return t.toFixed(1);
}

async function initWebGpuAdapter(): Promise<WebGpuStatus> {
  if (!("gpu" in navigator)) {
    return { available: false, adapterInfo: null, initError: "WebGPU not supported in this browser" };
  }
  try {
    const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
    if (!adapter) {
      return { available: false, adapterInfo: null, initError: "No WebGPU adapter found" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapterAny = adapter as any;
    const info: GPUAdapterInfo = adapterAny.info || (await adapterAny.requestAdapterInfo?.()) || {};
    const features = [...adapter.features].map((f) => f.toString());
    const limits = adapter.limits;

    return {
      available: true,
      adapterInfo: {
        name: info.description || info.vendor || "Unknown GPU",
        vendor: info.vendor || "Unknown",
        architecture: info.architecture || "",
        features,
        maxBufferSize: formatBytes(limits.maxBufferSize),
        maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
        maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
      },
      initError: null,
    };
  } catch (err) {
    return { available: false, adapterInfo: null, initError: String(err) };
  }
}

function calcP50(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcP99(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(0.99 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function WebGpuBenchmarkPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebGPU status
  const [webgpuStatus, setWebgpuStatus] = useState<WebGpuStatus>({
    available: null,
    adapterInfo: null,
    initError: null,
  });
  const [ortLoaded, setOrtLoaded] = useState(false);
  const [ortVersion, setOrtVersion] = useState("");

  // File
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Benchmark state
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [logOutput, setLogOutput] = useState<string[]>([]);
  const [preset, setPreset] = useState<BenchmarkPreset>("standard");
  const [customIterations, setCustomIterations] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);

  // Init WebGPU adapter info + TypeGPU + ORT on mount
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Step 1: Query WebGPU adapter info
      const status = await initWebGpuAdapter();
      if (cancelled) return;
      setWebgpuStatus(status);

      const ts = () => new Date().toLocaleTimeString();

      if (status.available) {
        setLogOutput((prev) => [
          ...prev,
          `[${ts()}] WebGPU adapter: ${status.adapterInfo?.name ?? "Unknown"}`,
        ]);
        setLogOutput((prev) => [...prev, `[${ts()}] Vendor: ${status.adapterInfo?.vendor ?? "Unknown"}`]);
        if (status.adapterInfo?.features?.length) {
          setLogOutput((prev) => [...prev, `[${ts()}] Features: ${status.adapterInfo?.features.join(", ")}`]);
        }

        // Step 2: Initialize TypeGPU to validate the full WebGPU pipeline
        if (!cancelled) {
          try {
            const tgpuMod = await import("typegpu");
            if (cancelled) return;
            const root = await tgpuMod.default.init();
            if (cancelled) {
              root.destroy();
              return;
            }
            setLogOutput((prev) => [...prev, `[${ts()}] TypeGPU initialized — compute pipeline ready`]);
            root.destroy();
          } catch (tgpuErr) {
            if (cancelled) return;
            setLogOutput((prev) => [...prev, `[${ts()}] TypeGPU init failed: ${tgpuErr}`]);
          }
        }
      } else {
        setLogOutput((prev) => [...prev, `[${ts()}] WebGPU: ${status.initError}`]);
      }

      // Step 3: Load ONNX Runtime Web
      if (!cancelled) {
        try {
          const ort = await import("onnxruntime-web");
          if (cancelled) return;
          setOrtLoaded(true);
          const ver = (ort as unknown as { env: { versions: { ort: string } } }).env?.versions?.ort || "1.x";
          setOrtVersion(ver);
          setLogOutput((prev) => [...prev, `[${ts()}] ONNX Runtime v${ver} loaded`]);
        } catch (err) {
          if (cancelled) return;
          setLogOutput((prev) => [...prev, `[${ts()}] ONNX Runtime failed to load: ${err}`]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogOutput((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setResult(null);
    setErrorMessage("");
    const ts = new Date().toLocaleTimeString();
    setLogOutput((prev) => [...prev, `[${ts}] Model: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const clearModel = useCallback(() => {
    setSelectedFile(null);
    setResult(null);
    setErrorMessage("");
    setLogOutput([]);
    setProgress(0);
  }, []);

  const runBenchmark = useCallback(async () => {
    if (!selectedFile) return;
    setErrorMessage("");
    setResult(null);
    setRunStatus("loading");
    setProgress(0);

    const cfg =
      preset === "custom"
        ? {
            iterations: customIterations,
            warmup: Math.max(2, Math.floor(customIterations / 5)),
            batchSize: 1,
          }
        : PRESETS[preset];

    const { iterations, warmup } = cfg;

    try {
      const ortMod = await import("onnxruntime-web");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ortAny = ortMod as any;
      ortAny.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

      appendLog("Reading model file...");
      const modelBuffer = await selectedFile.arrayBuffer();
      appendLog(`Loaded ${(modelBuffer.byteLength / 1024).toFixed(1)} KB`);

      const hasWebgpu = webgpuStatus.available;
      const eps: string[] = hasWebgpu ? ["webgpu", "wasm"] : ["wasm"];
      appendLog(`Creating session (EP: ${eps.join(", ")} )...`);

      const sessionStart = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session: any = await ortAny.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: eps,
        graphOptimizationLevel: "all",
      });
      const sessionCreateMs = performance.now() - sessionStart;
      appendLog(`Session created in ${formatMs(sessionCreateMs)}`);

      const inputNames: string[] = session.inputNames;
      const outputNames: string[] = session.outputNames;
      const ep = eps[0];
      appendLog(`Inputs: ${inputNames.length}, Outputs: ${outputNames.length}`);

      // Build input tensor
      const totalElements = cfg.batchSize * 128;
      const feeds: Record<string, unknown> = {};
      for (const name of inputNames) {
        const data = new Float32Array(totalElements);
        for (let i = 0; i < totalElements; i++) data[i] = Math.random() * 2 - 1;
        feeds[name] = new ortAny.Tensor("float32", data, [cfg.batchSize, 128]);
      }

      // Estimate GPU memory
      const modelSizeBytes = modelBuffer.byteLength;
      const tensorSizeBytes = totalElements * 4 * inputNames.length;
      const estimatedGpuMemMb = (modelSizeBytes * 1.5 + tensorSizeBytes * 2) / (1024 * 1024);

      // Warm-up
      setRunStatus("warming");
      appendLog(`Warm-up (${warmup} runs)...`);
      for (let w = 0; w < warmup; w++) {
        await session.run(feeds);
      }
      appendLog("Warm-up complete");

      // Benchmark
      setRunStatus("running");
      const latencies: number[] = [];
      const capturedInputShapes = [`[${cfg.batchSize}, 128] (x${inputNames.length})`];
      let capturedOutputShapes: string[] = [];

      for (let i = 0; i < iterations; i++) {
        const runStart = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results: Record<string, any> = await session.run(feeds);
        const elapsed = performance.now() - runStart;
        latencies.push(elapsed);

        const pct = ((i + 1) / iterations) * 100;
        setProgress(pct);

        // Capture output shapes from first run
        if (i === 0) {
          const shapes: string[] = [];
          for (const name of outputNames) {
            const t = results[name];
            if (t && t.dims) {
              shapes.push(`${name}: [${(t.dims as number[]).join(", ")}]`);
            } else {
              shapes.push(`${name}: (scalar)`);
            }
          }
          capturedOutputShapes = shapes;
        }
      }

      // Calculate stats
      const totalTimeMs = latencies.reduce((a, b) => a + b, 0);
      const avgMs = totalTimeMs / latencies.length;
      const minMs = Math.min(...latencies);
      const maxMs = Math.max(...latencies);
      const p50Ms = calcP50(latencies);
      const p99Ms = calcP99(latencies);
      const throughputPerSec = 1000 / avgMs;

      setResult({
        latencies,
        avgMs,
        minMs,
        maxMs,
        p50Ms,
        p99Ms,
        throughputPerSec,
        totalTimeMs,
        iterations,
        warmupIterations: warmup,
        inputShapes: capturedInputShapes,
        outputShapes: capturedOutputShapes,
        epUsed: ep,
        modelSizeKb: modelBuffer.byteLength / 1024,
        estimatedGpuMemMb,
      });

      appendLog(`Done — ${iterations} runs in ${formatMs(totalTimeMs)}`);
      appendLog(`Avg: ${formatMs(avgMs)} | p50: ${formatMs(p50Ms)} | p99: ${formatMs(p99Ms)}`);
      appendLog(`Throughput: ${formatThroughput(throughputPerSec)} it/s`);
      setRunStatus("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      appendLog(`ERROR: ${msg}`);
      setRunStatus("error");
    }
  }, [selectedFile, preset, customIterations, webgpuStatus.available, appendLog]);

  const latencyChartBars = result
    ? result.latencies.slice(0, Math.min(result.latencies.length, 100)).map((l, i) => ({
        index: i,
        value: l,
        pct: Math.min((l / result.maxMs) * 100, 100),
      }))
    : [];

  const inputShapeLabel = preset === "custom" ? `${customIterations} it` : `${PRESETS[preset].iterations} it`;

  return (
    <div className="flex flex-col gap-5 select-text">
      {/* WebGPU Adapter Info Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* WebGPU badge */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border p-3",
            webgpuStatus.available
              ? "border-emerald-500/30 bg-emerald-950/10"
              : webgpuStatus.available === null
                ? "border-slate-700 bg-slate-900/20"
                : "border-amber-500/30 bg-amber-950/10",
          )}
        >
          <Globe
            className={cn(
              "h-5 w-5 shrink-0",
              webgpuStatus.available
                ? "text-emerald-400"
                : webgpuStatus.available === null
                  ? "text-slate-500"
                  : "text-amber-400",
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200">WebGPU</p>
            <p className="text-xs font-mono text-slate-400 truncate">
              {webgpuStatus.available
                ? (webgpuStatus.adapterInfo?.name ?? "Available")
                : webgpuStatus.available === null
                  ? "Initializing..."
                  : "Unavailable"}
            </p>
          </div>
        </div>

        {/* ONNX Runtime badge */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border p-3",
            ortLoaded ? "border-emerald-500/30 bg-emerald-950/10" : "border-slate-700 bg-slate-900/20",
          )}
        >
          <Cpu className={cn("h-5 w-5 shrink-0", ortLoaded ? "text-emerald-400" : "text-slate-500")} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200">ONNX Runtime</p>
            <p className="text-xs font-mono text-slate-400 truncate">
              {ortLoaded ? `v${ortVersion} loaded` : "Loading..."}
            </p>
          </div>
        </div>
      </div>

      {/* Adapter details */}
      {webgpuStatus.available && webgpuStatus.adapterInfo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "GPU", value: webgpuStatus.adapterInfo.name, icon: Layers },
            { label: "Vendor", value: webgpuStatus.adapterInfo.vendor, icon: Info },
            {
              label: "Features",
              value:
                webgpuStatus.adapterInfo.features.length > 0
                  ? `${webgpuStatus.adapterInfo.features.length} available`
                  : "none",
              icon: Zap,
            },
            {
              label: "Max Buffer",
              value: webgpuStatus.adapterInfo.maxBufferSize,
              icon: HardDrive,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/20 px-2.5 py-1.5"
            >
              <Icon className="h-3 w-3 text-electric-blue shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-slate-600">{label}</p>
                <p className="text-xs font-mono text-slate-300 truncate">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      {!selectedFile ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
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
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <FileUp className={cn("h-8 w-8", isDragging ? "text-electric-blue" : "text-slate-600")} />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">Drop model to benchmark</p>
            <p className="text-sm text-slate-500 mt-1">
              <code className="text-electric-blue">.onnx</code> or{" "}
              <code className="text-electric-blue">.ort</code>
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/20 p-3">
          <div className="flex items-center gap-3 min-w-0">
            <Box className="h-5 w-5 text-electric-blue shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{selectedFile.name}</p>
              <p className="text-sm text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <Button variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={clearModel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Benchmark config */}
      {selectedFile && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/20 p-1">
            {(["quick", "standard", "thorough"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer",
                  preset === p ? "bg-electric-blue text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                {p === "quick" ? "10 it" : p === "standard" ? "50 it" : "200 it"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPreset("custom")}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer",
                preset === "custom" ? "bg-electric-blue text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              Custom
            </button>
          </div>

          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="custom-iters" className="text-sm text-slate-400">
                Iterations:
              </Label>
              <input
                id="custom-iters"
                type="number"
                min={5}
                max={1000}
                value={customIterations}
                onChange={(e) =>
                  setCustomIterations(Math.max(5, Math.min(1000, Number(e.target.value) || 5)))
                }
                className="w-20 h-8 rounded border border-slate-700 bg-slate-950 px-2 text-sm font-mono text-slate-200 outline-none focus:border-electric-blue"
              />
            </div>
          )}

          <div className="flex items-center gap-3 ml-auto">
            {runStatus === "done" && (
              <span className="text-sm text-emerald-400 font-mono flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Last: {result ? formatMs(result.avgMs) : ""}
              </span>
            )}
            <Button
              variant={runStatus === "done" ? "success" : "default"}
              onClick={runBenchmark}
              disabled={runStatus === "loading" || runStatus === "warming" || runStatus === "running"}
              className="h-9 px-4 text-sm"
            >
              {runStatus === "loading" || runStatus === "warming" ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Warming...
                </>
              ) : runStatus === "running" ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {Math.round(progress)}%
                </>
              ) : runStatus === "done" ? (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5" fill="currentColor" /> Re-run
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5" fill="currentColor" /> Run {inputShapeLabel}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {(runStatus === "running" || runStatus === "warming") && (
        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-200",
              runStatus === "warming" ? "bg-amber-500" : "bg-electric-blue",
            )}
            style={{ width: `${Math.max(1, progress)}%` }}
          />
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200 leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Results grid */}
      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Avg Latency",
                value: formatMs(result.avgMs),
                icon: Clock,
                color: "text-emerald-300",
              },
              {
                label: "p50 / p99",
                value: `${formatMs(result.p50Ms)} / ${formatMs(result.p99Ms)}`,
                icon: BarChart3,
                color: "text-blue-300",
              },
              {
                label: "Throughput",
                value: `${formatThroughput(result.throughputPerSec)} it/s`,
                icon: TrendingUp,
                color: "text-electric-blue",
              },
              {
                label: "Min / Max",
                value: `${formatMs(result.minMs)} / ${formatMs(result.maxMs)}`,
                icon: Thermometer,
                color: "text-amber-300",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-lg border border-slate-700 bg-slate-900/20 p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                  <Icon className="h-3 w-3" />
                  {label}
                </div>
                <p className={cn("text-base font-semibold font-mono tabular-nums", color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* Mini latency chart */}
          {latencyChartBars.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                <Activity className="h-3 w-3" />
                Latency per iteration (first {latencyChartBars.length})
              </p>
              <div className="flex items-end gap-[2px] h-16">
                {latencyChartBars.map((bar) => (
                  <div
                    key={bar.index}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${Math.max(2, bar.pct)}%`,
                      backgroundColor:
                        bar.value > result.p99Ms
                          ? "rgb(239 68 68 / 0.6)"
                          : bar.value > result.p50Ms
                            ? "rgb(234 179 8 / 0.5)"
                            : "rgb(52 211 153 / 0.5)",
                    }}
                    title={`#${bar.index + 1}: ${formatMs(bar.value)}`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-slate-600 mt-1">
                <span>1</span>
                <span>p50: {formatMs(result.p50Ms)}</span>
                <span>{latencyChartBars.length}</span>
              </div>
            </div>
          )}

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Execution Provider", value: result.epUsed },
              { label: "Model Size", value: `${result.modelSizeKb.toFixed(1)} KB` },
              { label: "Est. GPU Memory", value: `${result.estimatedGpuMemMb.toFixed(1)} MB` },
              { label: "Total Time", value: formatMs(result.totalTimeMs) },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-2"
              >
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-xs font-mono text-slate-300">{value}</span>
              </div>
            ))}
          </div>

          {/* Run details */}
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
            <p className="text-xs font-semibold text-slate-500">Run Details</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <p className="text-xs text-slate-400">
                <span className="text-slate-600">Iterations:</span>{" "}
                <span className="font-mono">{result.iterations}</span>
              </p>
              <p className="text-xs text-slate-400">
                <span className="text-slate-600">Warm-up:</span>{" "}
                <span className="font-mono">{result.warmupIterations}</span>
              </p>
              {result.inputShapes.map((s, i) => (
                <p key={`in-${i}`} className="text-xs text-slate-400 col-span-2 truncate">
                  <span className="text-slate-600">Input shape:</span>{" "}
                  <span className="font-mono text-blue-300">{s}</span>
                </p>
              ))}
              {result.outputShapes.map((s, i) => (
                <p key={`out-${i}`} className="text-xs text-slate-400 col-span-2 truncate">
                  <span className="text-slate-600">Output shape:</span>{" "}
                  <span className="font-mono text-emerald-300">{s}</span>
                </p>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Session log */}
      {logOutput.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-500 font-mono">Log</span>
            <button
              type="button"
              onClick={() => setLogOutput([])}
              className="text-[11px] text-slate-600 hover:text-slate-400 cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[160px] overflow-y-auto p-3 space-y-0.5">
            {logOutput.map((line, i) => (
              <p
                key={i}
                className={cn(
                  "text-xs font-mono leading-relaxed",
                  line.includes("ERROR")
                    ? "text-red-400"
                    : line.includes("Done")
                      ? "text-emerald-300"
                      : "text-emerald-400/80",
                )}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* TypeGPU compute pipeline hint */}
      {webgpuStatus.available && result && (
        <div className="rounded-lg bg-electric-blue/5 border border-electric-blue/10 p-3">
          <p className="text-sm text-slate-400 leading-relaxed flex items-start gap-2">
            <Zap className="h-4 w-4 text-electric-blue shrink-0 mt-0.5" />
            <span>
              TypeGPU is ready and available for GPU compute post-processing. The adapter{" "}
              <code className="text-electric-blue font-mono">{webgpuStatus.adapterInfo?.name}</code> supports{" "}
              <code className="text-electric-blue font-mono">
                {webgpuStatus.adapterInfo?.maxComputeInvocationsPerWorkgroup.toLocaleString()}
              </code>{" "}
              invocations per workgroup. Use compute shaders to post-process inference results at GPU speed.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
