import { useState, useCallback, useRef } from "react";
import * as ort from "onnxruntime-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FileUp,
  Box,
  X,
  Cloud,
  HardDrive,
  KeyRound,
  Link,
  Cpu,
  Swords,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
} from "lucide-react";
import { usePipelineStore } from "@/lib/stores/pipelineStore";
import { ARENA_CLOUD_TIMEOUT_MS } from "@/lib/arenaConstants";

/* ------------------------------------------------------------------ */
/*  Exported types                                                     */
/* ------------------------------------------------------------------ */

export interface ArenaRunResult {
  output: string;
  elapsedMs: number;
  status: "idle" | "running" | "done" | "error";
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Exported pure helpers (needed for tasks 6.2-6.4 and PBT tests)   */
/* ------------------------------------------------------------------ */

/** Returns the elapsed time between two performance.now() timestamps. */
export function computeElapsed(startTime: number, endTime: number): number {
  return endTime - startTime;
}

/**
 * Returns which slot is faster ("a", "b") or "tie" if equal.
 * Lower elapsedMs is faster.
 */
export function getFasterSlot(a: number, b: number): "a" | "b" | "tie" {
  if (a < b) return "a";
  if (b < a) return "b";
  return "tie";
}

/** Returns a fresh cleared state for both run results. */
export function clearRunResults(): { resultA: ArenaRunResult; resultB: ArenaRunResult } {
  return {
    resultA: { output: "", elapsedMs: 0, status: "idle" },
    resultB: { output: "", elapsedMs: 0, status: "idle" },
  };
}

/* ------------------------------------------------------------------ */
/*  File size formatter                                                */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ */
/*  SlotDropZone                                                       */
/* ------------------------------------------------------------------ */

interface SlotDropZoneProps {
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
}

function SlotDropZone({ file, onFile, onClear }: SlotDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) onFile(dropped);
    },
    [onFile],
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
      const f = e.target.files?.[0];
      if (f) onFile(f);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [onFile],
  );

  if (file) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/20 p-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Box className="h-4 w-4 text-electric-blue shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">{file.name}</p>
            <p className="text-[11px] text-slate-500">{formatFileSize(file.size)}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-7 w-7 p-0 shrink-0"
          onClick={onClear}
          aria-label="Remove file"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => fileInputRef.current?.click()}
      className={cn(
        "relative flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
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
        aria-label="Select ONNX model file"
      />
      <FileUp
        className={cn(
          "h-8 w-8 transition-colors",
          isDragging ? "text-electric-blue" : "text-slate-600",
        )}
      />
      <div className="text-center">
        <p className="text-xs font-medium text-slate-300">
          Drop a model here, or click to browse
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Accepts{" "}
          <code className="text-electric-blue">.onnx</code> and{" "}
          <code className="text-electric-blue">.ort</code>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SlotConfig — renders local or cloud configuration for one slot    */
/* ------------------------------------------------------------------ */

interface SlotConfigProps {
  label: "Slot A" | "Slot B";
  slotType: "local" | "cloud";
  file: File | null;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
  onTypeChange: (type: "local" | "cloud") => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
  onEndpointChange: (val: string) => void;
  onApiKeyChange: (val: string) => void;
  onModelIdChange: (val: string) => void;
}

function SlotConfig({
  label,
  slotType,
  file,
  endpointUrl,
  apiKey,
  modelId,
  onTypeChange,
  onFile,
  onClearFile,
  onEndpointChange,
  onApiKeyChange,
  onModelIdChange,
}: SlotConfigProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      {/* Slot header: label + type toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-electric-blue shrink-0" />
          <span className="text-sm font-semibold text-slate-200">{label}</span>
          {slotType === "local" && file && (
            <span className="text-[11px] text-slate-400 font-mono truncate max-w-[140px]">
              · {file.name} ({formatFileSize(file.size)})
            </span>
          )}
        </div>

        {/* Local / Cloud toggle */}
        <div
          className="flex bg-slate-950 border border-slate-800 rounded p-0.5"
          role="group"
          aria-label={`${label} source type`}
        >
          <button
            type="button"
            aria-pressed={slotType === "local"}
            onClick={() => onTypeChange("local")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-semibold rounded transition-all flex items-center gap-1 cursor-pointer",
              slotType === "local"
                ? "bg-electric-blue text-slate-950"
                : "text-slate-400 hover:text-slate-200",
            )}
          >
            <HardDrive className="h-3 w-3" />
            Local file
          </button>
          <button
            type="button"
            aria-pressed={slotType === "cloud"}
            onClick={() => onTypeChange("cloud")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-semibold rounded transition-all flex items-center gap-1 cursor-pointer",
              slotType === "cloud"
                ? "bg-electric-blue text-slate-950"
                : "text-slate-400 hover:text-slate-200",
            )}
          >
            <Cloud className="h-3 w-3" />
            Cloud / API
          </button>
        </div>
      </div>

      {/* Content area */}
      {slotType === "local" ? (
        <SlotDropZone file={file} onFile={onFile} onClear={onClearFile} />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Endpoint URL — required */}
          <div className="space-y-1.5">
            <Label
              htmlFor={`${label.replace(" ", "-").toLowerCase()}-endpoint`}
              className="text-[11px] text-slate-400 flex items-center gap-1"
            >
              <Link className="h-3 w-3" />
              Endpoint URL
              <span className="text-red-400 ml-0.5" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id={`${label.replace(" ", "-").toLowerCase()}-endpoint`}
              type="url"
              placeholder="https://api.example.com/v1"
              value={endpointUrl}
              onChange={(e) => onEndpointChange(e.target.value)}
              className="h-9 text-xs font-mono"
              aria-required="true"
            />
          </div>

          {/* API Key — optional */}
          <div className="space-y-1.5">
            <Label
              htmlFor={`${label.replace(" ", "-").toLowerCase()}-apikey`}
              className="text-[11px] text-slate-400 flex items-center gap-1"
            >
              <KeyRound className="h-3 w-3" />
              API Key
              <span className="text-slate-600 ml-0.5 text-[10px]">(optional)</span>
            </Label>
            <Input
              id={`${label.replace(" ", "-").toLowerCase()}-apikey`}
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="h-9 text-xs font-mono"
              autoComplete="off"
            />
          </div>

          {/* Model ID — optional */}
          <div className="space-y-1.5">
            <Label
              htmlFor={`${label.replace(" ", "-").toLowerCase()}-modelid`}
              className="text-[11px] text-slate-400 flex items-center gap-1"
            >
              <Cpu className="h-3 w-3" />
              Model ID
              <span className="text-slate-600 ml-0.5 text-[10px]">(optional)</span>
            </Label>
            <Input
              id={`${label.replace(" ", "-").toLowerCase()}-modelid`}
              type="text"
              placeholder="gpt-4o-mini"
              value={modelId}
              onChange={(e) => onModelIdChange(e.target.value)}
              className="h-9 text-xs font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SlotResultPanel — displays status/output for one result slot      */
/* ------------------------------------------------------------------ */

interface SlotResultPanelProps {
  label: "Slot A" | "Slot B";
  result: ArenaRunResult;
  isWinner?: boolean;
}

function SlotResultPanel({ label, result, isWinner }: SlotResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed silently
    }
  }, [result.output]);

  const statusBadge = () => {
    switch (result.status) {
      case "idle":
        return (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-800 text-slate-400">
            idle
          </span>
        );
      case "running":
        return (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-electric-blue/10 text-electric-blue">
            <span className="animate-spin"><Loader2 className="h-2.5 w-2.5" /></span>
            running
          </span>
        );
      case "done":
        return (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">
            <CheckCircle className="h-2.5 w-2.5" />
            done
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-400">
            <XCircle className="h-2.5 w-2.5" />
            error
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-300">{label} Result</span>
        {statusBadge()}
      </div>

      {result.status === "error" && result.error && (
        <p className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2">
          {result.error}
        </p>
      )}

      {result.status === "done" && (
        <>
          <pre className="text-[11px] text-slate-300 bg-slate-950/60 border border-slate-800 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words">
            {result.output || "(empty output)"}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[11px]">
              <Clock className="h-3 w-3 shrink-0" />
              <span
                className={cn(
                  isWinner === true
                    ? "text-emerald-400 font-semibold"
                    : "text-slate-500",
                )}
              >
                {result.elapsedMs.toFixed(1)} ms
              </span>
              {isWinner === true && (
                <span className="ml-1 text-[10px] font-semibold text-emerald-400">
                  · faster
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              className="h-6 px-2 text-[10px] text-slate-400 hover:text-slate-200 shrink-0"
              onClick={handleCopy}
              aria-label={`Copy ${label} output`}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </>
      )}

      {result.status === "idle" && (
        <p className="text-[11px] text-slate-600 italic">Waiting…</p>
      )}

      {result.status === "running" && (
        <p className="text-[11px] text-slate-500 italic">Running inference…</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Local ONNX inference helper                                        */
/* ------------------------------------------------------------------ */

/**
 * Runs inference on a local ONNX file using onnxruntime-web.
 * Creates synthetic Float32 [1, 128] feeds for each input.
 * Returns { output, elapsedMs }.
 */
async function runLocalInference(file: File): Promise<{ output: string; elapsedMs: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const session = await ort.InferenceSession.create(objectUrl);
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of session.inputNames) {
      const data = new Float32Array(128);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      feeds[name] = new ort.Tensor("float32", data, [1, 128]);
    }

    const startTime = performance.now();
    const outputMap = await session.run(feeds);
    const endTime = performance.now();

    const elapsedMs = computeElapsed(startTime, endTime);

    // Convert first output to a string representation
    const firstOutputKey = session.outputNames[0];
    const firstOutput = firstOutputKey ? outputMap[firstOutputKey] : undefined;
    let output = "";
    if (firstOutput) {
      const data = firstOutput.data as Float32Array | Int32Array | BigInt64Array;
      const preview = Array.from(data as ArrayLike<number | bigint>)
        .slice(0, 8)
        .map((v) => (typeof v === "bigint" ? v.toString() : (v as number).toFixed(4)))
        .join(", ");
      output = `[${preview}${data.length > 8 ? ", …" : ""}] (shape: [${firstOutput.dims.join(", ")}])`;
    }

    return { output, elapsedMs };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/* ------------------------------------------------------------------ */
/*  Cloud inference helper                                             */
/* ------------------------------------------------------------------ */

interface CloudSlotConfig {
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}

async function runCloudInference(
  slot: CloudSlotConfig,
  prompt: string,
): Promise<{ output: string; elapsedMs: number }> {
  const startTime = performance.now();
  const res = await fetch("/api/arena/cloud-inference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpointUrl: slot.endpointUrl,
      apiKey: slot.apiKey,
      modelId: slot.modelId,
      prompt,
      timeoutMs: ARENA_CLOUD_TIMEOUT_MS,
    }),
  });
  const endTime = performance.now();
  const elapsedMs = computeElapsed(startTime, endTime);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }

  const data = (await res.json()) as { output?: string; error?: string };
  if (data.error) throw new Error(data.error);

  return { output: data.output ?? "", elapsedMs };
}

/* ------------------------------------------------------------------ */
/*  ArenaPanel                                                         */
/* ------------------------------------------------------------------ */

export function ArenaPanel() {
  const slotA = usePipelineStore((s) => s.slotA);
  const slotB = usePipelineStore((s) => s.slotB);
  const setSlotA = usePipelineStore((s) => s.setSlotA);
  const setSlotB = usePipelineStore((s) => s.setSlotB);

  // Prompt state
  const [prompt, setPrompt] = useState<string>("");
  const [promptError, setPromptError] = useState<boolean>(false);

  // Run result state
  const [resultA, setResultA] = useState<ArenaRunResult>({
    output: "",
    elapsedMs: 0,
    status: "idle",
  });
  const [resultB, setResultB] = useState<ArenaRunResult>({
    output: "",
    elapsedMs: 0,
    status: "idle",
  });

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPrompt(value);
    // Clear error as soon as the user types any non-whitespace character
    if (value.trim() !== "") {
      setPromptError(false);
    }
  }, []);

  const handleRun = useCallback(async () => {
    // Validate prompt
    if (prompt.trim() === "") {
      setPromptError(true);
      return;
    }

    const bothLocal = slotA.type === "local" && slotB.type === "local";

    if (bothLocal) {
      // Sequential execution path — Task 6.3
      const cleared = clearRunResults();
      setResultA({ ...cleared.resultA, status: "running" });
      setResultB({ ...cleared.resultB, status: "idle" });

      // Run Slot A
      let slotASuccess = false;
      if (slotA.file) {
        try {
          const { output, elapsedMs } = await runLocalInference(slotA.file);
          setResultA({ output, elapsedMs, status: "done" });
          slotASuccess = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setResultA({ output: "", elapsedMs: 0, status: "error", error: message });
        }
      } else {
        setResultA({
          output: "",
          elapsedMs: 0,
          status: "error",
          error: "No file loaded in Slot A",
        });
      }

      // Run Slot B only if Slot A succeeded
      if (slotASuccess) {
        setResultB((prev) => ({ ...prev, status: "running" }));
        if (slotB.file) {
          try {
            const { output, elapsedMs } = await runLocalInference(slotB.file);
            setResultB({ output, elapsedMs, status: "done" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setResultB({ output: "", elapsedMs: 0, status: "error", error: message });
          }
        } else {
          setResultB({
            output: "",
            elapsedMs: 0,
            status: "error",
            error: "No file loaded in Slot B",
          });
        }
      }
    } else {
      // Concurrent execution path — both cloud or mixed local+cloud
      const cleared = clearRunResults();
      setResultA({ ...cleared.resultA, status: "running" });
      setResultB({ ...cleared.resultB, status: "running" });

      // Build promises for each slot, updating independently as they settle
      const runSlotA = async () => {
        if (slotA.type === "local") {
          if (!slotA.file) {
            setResultA({ output: "", elapsedMs: 0, status: "error", error: "No file loaded in Slot A" });
            return;
          }
          try {
            const { output, elapsedMs } = await runLocalInference(slotA.file);
            setResultA({ output, elapsedMs, status: "done" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setResultA({ output: "", elapsedMs: 0, status: "error", error: message });
          }
        } else {
          // cloud
          if (!slotA.endpointUrl) {
            setResultA({ output: "", elapsedMs: 0, status: "error", error: "No endpoint URL configured for Slot A" });
            return;
          }
          try {
            const { output, elapsedMs } = await runCloudInference(slotA, prompt);
            setResultA({ output, elapsedMs, status: "done" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setResultA({ output: "", elapsedMs: 0, status: "error", error: message });
          }
        }
      };

      const runSlotB = async () => {
        if (slotB.type === "local") {
          if (!slotB.file) {
            setResultB({ output: "", elapsedMs: 0, status: "error", error: "No file loaded in Slot B" });
            return;
          }
          try {
            const { output, elapsedMs } = await runLocalInference(slotB.file);
            setResultB({ output, elapsedMs, status: "done" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setResultB({ output: "", elapsedMs: 0, status: "error", error: message });
          }
        } else {
          // cloud
          if (!slotB.endpointUrl) {
            setResultB({ output: "", elapsedMs: 0, status: "error", error: "No endpoint URL configured for Slot B" });
            return;
          }
          try {
            const { output, elapsedMs } = await runCloudInference(slotB, prompt);
            setResultB({ output, elapsedMs, status: "done" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setResultB({ output: "", elapsedMs: 0, status: "error", error: message });
          }
        }
      };

      // Fire both concurrently — each updates its own slot independently.
      // allSettled, not all: Promise.all rejects on the first failure and
      // would abandon the other slot's result (Requirement 7.4).
      await Promise.allSettled([runSlotA(), runSlotB()]);
    }
  }, [prompt, slotA, slotB]);

  return (
    <div className="flex flex-col gap-6 select-text">
      {/* Two-column slot configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Slot A */}
        <SlotConfig
          label="Slot A"
          slotType={slotA.type}
          file={slotA.file}
          endpointUrl={slotA.endpointUrl}
          apiKey={slotA.apiKey}
          modelId={slotA.modelId}
          onTypeChange={(type) => setSlotA({ type })}
          onFile={(file) => setSlotA({ file })}
          onClearFile={() => setSlotA({ file: null })}
          onEndpointChange={(endpointUrl) => setSlotA({ endpointUrl })}
          onApiKeyChange={(apiKey) => setSlotA({ apiKey })}
          onModelIdChange={(modelId) => setSlotA({ modelId })}
        />

        {/* Slot B */}
        <SlotConfig
          label="Slot B"
          slotType={slotB.type}
          file={slotB.file}
          endpointUrl={slotB.endpointUrl}
          apiKey={slotB.apiKey}
          modelId={slotB.modelId}
          onTypeChange={(type) => setSlotB({ type })}
          onFile={(file) => setSlotB({ file })}
          onClearFile={() => setSlotB({ file: null })}
          onEndpointChange={(endpointUrl) => setSlotB({ endpointUrl })}
          onApiKeyChange={(apiKey) => setSlotB({ apiKey })}
          onModelIdChange={(modelId) => setSlotB({ modelId })}
        />
      </div>

      {/* Shared prompt input and Run Arena button — Task 6.2 */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="space-y-1.5">
          <Label
            htmlFor="arena-prompt"
            className="text-xs font-semibold text-slate-300"
          >
            Prompt
          </Label>
          <textarea
            id="arena-prompt"
            value={prompt}
            onChange={handlePromptChange}
            placeholder="Enter a prompt to run against both slots…"
            rows={4}
            aria-invalid={promptError}
            aria-describedby={promptError ? "arena-prompt-error" : undefined}
            className={cn(
              "w-full resize-y rounded-lg border bg-slate-950/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 transition-colors",
              promptError
                ? "border-red-500 focus:ring-red-500"
                : "border-slate-700 focus:ring-electric-blue hover:border-slate-600",
            )}
          />
          {promptError && (
            <p id="arena-prompt-error" className="text-[11px] text-red-400" role="alert">
              Prompt cannot be empty or whitespace only.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end">
          <Button
            onClick={handleRun}
            disabled={prompt.trim() === ""}
            className="flex items-center gap-2"
          >
            <Play className="h-3.5 w-3.5" />
            Run Arena
          </Button>
        </div>
      </div>

      {/* Result display columns — Tasks 6.2-6.4 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SlotResultPanel
          label="Slot A"
          result={resultA}
          isWinner={
            resultA.status === "done" &&
            resultB.status === "done" &&
            getFasterSlot(resultA.elapsedMs, resultB.elapsedMs) === "a"
          }
        />
        <SlotResultPanel
          label="Slot B"
          result={resultB}
          isWinner={
            resultA.status === "done" &&
            resultB.status === "done" &&
            getFasterSlot(resultA.elapsedMs, resultB.elapsedMs) === "b"
          }
        />
      </div>
    </div>
  );
}
