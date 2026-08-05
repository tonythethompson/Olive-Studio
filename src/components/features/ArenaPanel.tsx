import { useState, useCallback, useRef, useEffect } from "react";
import { Button, Input, Label } from "@/components/ui";
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
import { usePlaygroundStore, type ArenaSlotConfig } from "@/lib/stores/playgroundStore";
import { ARENA_CLOUD_TIMEOUT_MS } from "@/lib/arenaConstants";
import {
  buildArenaLocalFeeds,
  DEFAULT_ARENA_TOKENIZER_ID,
} from "@/lib/arenaLocalInference";
import { FromOliveOutputs, UseAssistantProviderButton } from "./ArenaConvenience";

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

/**
 * Determines whether a prompt contains no non-whitespace characters.
 *
 * @param prompt - The prompt to check
 * @returns `true` if the prompt is empty or whitespace-only, `false` otherwise.
 */
export function isArenaPromptBlank(prompt: string): boolean {
  return prompt.trim() === "";
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

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    },
    [openPicker],
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
      role="button"
      tabIndex={0}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue",
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
  tokenizerId: string;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
  onTypeChange: (type: "local" | "cloud") => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
  onTokenizerIdChange: (val: string) => void;
  onEndpointChange: (val: string) => void;
  onApiKeyChange: (val: string) => void;
  onModelIdChange: (val: string) => void;
  /** Apply a cloud snapshot as one store patch (Req 18). */
  onCloudPatch: (
    patch: Pick<ArenaSlotConfig, "type" | "endpointUrl" | "apiKey" | "modelId">,
  ) => void;
}

function SlotConfig({
  label,
  slotType,
  file,
  tokenizerId,
  endpointUrl,
  apiKey,
  modelId,
  onTypeChange,
  onFile,
  onClearFile,
  onTokenizerIdChange,
  onEndpointChange,
  onApiKeyChange,
  onModelIdChange,
  onCloudPatch,
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
        <div className="flex flex-col gap-3">
          <SlotDropZone file={file} onFile={onFile} onClear={onClearFile} />
          <FromOliveOutputs slotLabel={label} onFile={onFile} />
          <div className="space-y-1.5">
            <Label
              htmlFor={`${label.replace(" ", "-").toLowerCase()}-tokenizer`}
              className="text-[11px] text-slate-400 flex items-center gap-1"
            >
              <Cpu className="h-3 w-3" />
              Tokenizer (HF id)
              <span className="text-slate-600 ml-0.5 text-[10px]">(NLP local)</span>
            </Label>
            <Input
              id={`${label.replace(" ", "-").toLowerCase()}-tokenizer`}
              type="text"
              placeholder={DEFAULT_ARENA_TOKENIZER_ID}
              value={tokenizerId}
              onChange={(e) => onTokenizerIdChange(e.target.value)}
              className="h-9 text-xs font-mono"
            />
            <p className="text-[10px] text-slate-600 leading-relaxed">
              Used when the ONNX graph looks like NLP (<code className="text-slate-500">input_ids</code>
              ). Loads via transformers.js; falls back to a prompt-derived encoding offline.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <UseAssistantProviderButton slotLabel={label} onApply={onCloudPatch} />
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

export interface SlotResultPanelProps {
  label: "Slot A" | "Slot B";
  result: ArenaRunResult;
  isWinner?: boolean;
}

/**
 * Displays the inference status, output, timing, and errors for an arena slot.
 *
 * @param label - The slot label shown in the panel.
 * @param result - The slot's current inference result.
 * @param isWinner - Whether to highlight the slot as the faster completed result.
 */
export function SlotResultPanel({ label, result, isWinner }: SlotResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
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
        <p
          data-testid={`${label.toLowerCase().replace(" ", "-")}-error`}
          className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2 max-h-24 overflow-y-auto"
        >
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

function formatTensorPreview(data: ArrayLike<number | bigint | string>): string {
  const preview = Array.from(data as ArrayLike<number | bigint | string>)
    .slice(0, 8)
    .map((v) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(4);
      return String(v);
    })
    .join(", ");
  return `[${preview}${(data as { length: number }).length > 8 ? ", …" : ""}]`;
}

/**
 * Runs inference on a local ONNX file using onnxruntime-web (dynamically imported).
 * NLP graphs + prompt → transformers.js tokenization (per-slot tokenizerId).
 */
async function runLocalInference(
  file: File,
  opts: { prompt: string; seedKey: string; tokenizerId?: string },
): Promise<{ output: string; elapsedMs: number }> {
  const ort = await import("onnxruntime-web");
  const ortAny = ort as unknown as { env?: { wasm?: { wasmPaths?: string } } };
  if (ortAny.env?.wasm) {
    ortAny.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";
  }

  const objectUrl = URL.createObjectURL(file);
  let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | undefined;
  try {
    session = await ort.InferenceSession.create(objectUrl);
    const { feeds, kind, tokenize } = await buildArenaLocalFeeds(ort, session.inputNames, {
      prompt: opts.prompt,
      seedKey: opts.seedKey,
      tokenizerId: opts.tokenizerId,
    });

    const startTime = performance.now();
    const outputMap = await session.run(
      feeds as Parameters<typeof session.run>[0],
    );
    const endTime = performance.now();
    const elapsedMs = computeElapsed(startTime, endTime);

    const firstOutputKey = session.outputNames[0];
    const firstOutput = firstOutputKey ? outputMap[firstOutputKey] : undefined;
    let output = "";
    if (firstOutput) {
      const data = firstOutput.data as ArrayLike<number | bigint | string>;
      output = `${formatTensorPreview(data)} (shape: [${firstOutput.dims.join(", ")}])`;
    }
    const meta =
      kind === "nlp" && tokenize
        ? ` · ${tokenize.source}${tokenize.tokenizerId ? `:${tokenize.tokenizerId}` : ""}`
        : ` · ${kind}`;
    if (output) output = `${output}${meta}`;

    return { output, elapsedMs };
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (session) await session.release();
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
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
      detail?: string;
    };
    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    const base = body.error ?? `HTTP ${res.status}`;
    throw new Error(detail ? `${base}: ${detail.slice(0, 300)}` : base);
  }

  const data = (await res.json()) as { output?: string; error?: string };
  if (data.error) throw new Error(data.error);

  return { output: data.output ?? "", elapsedMs };
}

/* ------------------------------------------------------------------ */
/*  Shared slot runner                                                 */
/* ------------------------------------------------------------------ */

type LocalInferenceOpts = { prompt: string; seedKey: string; tokenizerId?: string };

/** Per-slot local opts: shared seed/prompt, slot-owned tokenizer vocabulary. */
export function localOptsForArenaSlot(
  slot: ArenaSlotConfig,
  prompt: string,
  seedKey: string,
): LocalInferenceOpts {
  return {
    prompt,
    seedKey,
    tokenizerId:
      slot.type === "local" && slot.tokenizerId.trim()
        ? slot.tokenizerId.trim()
        : undefined,
  };
}

/**
 * Runs one Arena slot (local or cloud). Shared by the parallel and sequential
 * handleRun paths so guards / error strings / stale-run checks stay in sync.
 * @returns true when inference completed successfully on the current run.
 */
async function runArenaSlot(opts: {
  slot: ArenaSlotConfig;
  label: string;
  setResult: (result: ArenaRunResult) => void;
  isCurrent: () => boolean;
  prompt: string;
  localOpts: LocalInferenceOpts;
}): Promise<boolean> {
  const { slot, label, setResult, isCurrent, prompt, localOpts } = opts;

  if (slot.type === "local") {
    if (!slot.file) {
      if (isCurrent()) {
        setResult({
          output: "",
          elapsedMs: 0,
          status: "error",
          error: `No file loaded in ${label}`,
        });
      }
      return false;
    }
    try {
      const { output, elapsedMs } = await runLocalInference(slot.file, localOpts);
      if (isCurrent()) setResult({ output, elapsedMs, status: "done" });
      return isCurrent();
    } catch (err) {
      if (!isCurrent()) return false;
      const message = err instanceof Error ? err.message : String(err);
      setResult({ output: "", elapsedMs: 0, status: "error", error: message });
      return false;
    }
  }

  if (!slot.endpointUrl) {
    if (isCurrent()) {
      setResult({
        output: "",
        elapsedMs: 0,
        status: "error",
        error: `No endpoint URL configured for ${label}`,
      });
    }
    return false;
  }
  try {
    const { output, elapsedMs } = await runCloudInference(slot, prompt);
    if (isCurrent()) setResult({ output, elapsedMs, status: "done" });
    return isCurrent();
  } catch (err) {
    if (!isCurrent()) return false;
    const message = err instanceof Error ? err.message : String(err);
    setResult({ output: "", elapsedMs: 0, status: "error", error: message });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  ArenaPanel                                                         */
/**
 * Renders the Arena interface for configuring, running, and comparing two inference slots.
 */

export function ArenaPanel() {
  const slotA = usePlaygroundStore((s) => s.slotA);
  const slotB = usePlaygroundStore((s) => s.slotB);
  const setSlotA = usePlaygroundStore((s) => s.setSlotA);
  const setSlotB = usePlaygroundStore((s) => s.setSlotB);

  // Prompt state
  const [prompt, setPrompt] = useState<string>("");
  const [promptError, setPromptError] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState(false);
  const runIdRef = useRef(0);

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

  const needsPrompt = slotA.type === "cloud" || slotB.type === "cloud";
  // Shared seed / prompt so both local slots compare the same request.
  const localSeedKey = isArenaPromptBlank(prompt) ? "arena-local-default" : prompt.trim();

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPrompt(value);
    if (!isArenaPromptBlank(value)) {
      setPromptError(false);
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (isRunning) return;

    if (needsPrompt && isArenaPromptBlank(prompt)) {
      setPromptError(true);
      return;
    }

    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;
    setIsRunning(true);

    const bothLocal = slotA.type === "local" && slotB.type === "local";

    try {
      if (bothLocal) {
        // Sequential execution path — Task 6.3
        const cleared = clearRunResults();
        setResultA({ ...cleared.resultA, status: "running" });
        setResultB({ ...cleared.resultB, status: "idle" });

        const slotASuccess = await runArenaSlot({
          slot: slotA,
          label: "Slot A",
          setResult: setResultA,
          isCurrent,
          prompt,
          localOpts: localOptsForArenaSlot(slotA, prompt, localSeedKey),
        });
        if (!isCurrent()) return;

        if (slotASuccess) {
          setResultB((prev) => ({ ...prev, status: "running" }));
          await runArenaSlot({
            slot: slotB,
            label: "Slot B",
            setResult: setResultB,
            isCurrent,
            prompt,
            localOpts: localOptsForArenaSlot(slotB, prompt, localSeedKey),
          });
        } else {
          // Don't leave Slot B stranded on "Waiting…" after Slot A fails
          setResultB({
            output: "",
            elapsedMs: 0,
            status: "error",
            error: "Skipped because Slot A failed",
          });
        }
      } else {
        const cleared = clearRunResults();
        setResultA({ ...cleared.resultA, status: "running" });
        setResultB({ ...cleared.resultB, status: "running" });

        await Promise.allSettled([
          runArenaSlot({
            slot: slotA,
            label: "Slot A",
            setResult: setResultA,
            isCurrent,
            prompt,
            localOpts: localOptsForArenaSlot(slotA, prompt, localSeedKey),
          }),
          runArenaSlot({
            slot: slotB,
            label: "Slot B",
            setResult: setResultB,
            isCurrent,
            prompt,
            localOpts: localOptsForArenaSlot(slotB, prompt, localSeedKey),
          }),
        ]);
      }
    } finally {
      if (isCurrent()) setIsRunning(false);
    }
  }, [isRunning, needsPrompt, prompt, localSeedKey, slotA, slotB]);

  const comparable =
    slotA.type === slotB.type && resultA.status === "done" && resultB.status === "done";
  const faster = comparable ? getFasterSlot(resultA.elapsedMs, resultB.elapsedMs) : null;

  return (
    <div className="flex flex-col gap-6 select-text">
      {/* Two-column slot configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Slot A */}
        <SlotConfig
          label="Slot A"
          slotType={slotA.type}
          file={slotA.file}
          tokenizerId={slotA.tokenizerId}
          endpointUrl={slotA.endpointUrl}
          apiKey={slotA.apiKey}
          modelId={slotA.modelId}
          onTypeChange={(type) => setSlotA({ type })}
          onFile={(file) => setSlotA({ file })}
          onClearFile={() => setSlotA({ file: null })}
          onTokenizerIdChange={(tokenizerId) => setSlotA({ tokenizerId })}
          onEndpointChange={(endpointUrl) => setSlotA({ endpointUrl })}
          onApiKeyChange={(apiKey) => setSlotA({ apiKey })}
          onModelIdChange={(modelId) => setSlotA({ modelId })}
          onCloudPatch={(patch) => setSlotA(patch)}
        />

        {/* Slot B */}
        <SlotConfig
          label="Slot B"
          slotType={slotB.type}
          file={slotB.file}
          tokenizerId={slotB.tokenizerId}
          endpointUrl={slotB.endpointUrl}
          apiKey={slotB.apiKey}
          modelId={slotB.modelId}
          onTypeChange={(type) => setSlotB({ type })}
          onFile={(file) => setSlotB({ file })}
          onClearFile={() => setSlotB({ file: null })}
          onTokenizerIdChange={(tokenizerId) => setSlotB({ tokenizerId })}
          onEndpointChange={(endpointUrl) => setSlotB({ endpointUrl })}
          onApiKeyChange={(apiKey) => setSlotB({ apiKey })}
          onModelIdChange={(modelId) => setSlotB({ modelId })}
          onCloudPatch={(patch) => setSlotB(patch)}
        />
      </div>

      {/* Shared prompt input and Run Arena button — Task 6.2 */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="space-y-1.5">
          <Label
            htmlFor="arena-prompt"
            className="text-xs font-semibold text-slate-300"
          >
            Prompt{needsPrompt ? "" : " (optional seed for local)"}
          </Label>
          <textarea
            id="arena-prompt"
            value={prompt}
            onChange={handlePromptChange}
            placeholder={
              needsPrompt
                ? "Enter a prompt to run against cloud slot(s)…"
                : "Optional: used as a seed so both local models share the same synthetic inputs…"
            }
            rows={4}
            aria-invalid={promptError}
            aria-describedby={
              promptError ? "arena-prompt-error" : "arena-prompt-hint"
            }
            className={cn(
              "w-full resize-y rounded-lg border bg-slate-950/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 transition-colors",
              promptError
                ? "border-red-500 focus:ring-red-500"
                : "border-slate-700 focus:ring-electric-blue hover:border-slate-600",
            )}
          />
          {promptError && (
            <p id="arena-prompt-error" className="text-[11px] text-red-400" role="alert">
              Prompt cannot be empty or whitespace only when a cloud slot is configured.
            </p>
          )}
          {!promptError && (
            <p id="arena-prompt-hint" className="text-[11px] text-slate-500">
              {needsPrompt
                ? "Cloud slots send this prompt to the chat API. Local NLP models tokenize the same prompt (transformers.js or prompt-derived fallback)."
                : "Local NLP models tokenize this prompt into input_ids/attention_mask for both slots. Other models use seeded synthetic tensors."}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end">
          <Button
            onClick={handleRun}
            disabled={isRunning || (needsPrompt && isArenaPromptBlank(prompt))}
            className="flex items-center gap-2"
          >
            {isRunning ? (
              <span className="animate-spin">
                <Loader2 className="h-3.5 w-3.5" />
              </span>
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning ? "Running…" : "Run Arena"}
          </Button>
        </div>
      </div>

      {/* Result display columns — Tasks 6.2-6.4.
          "Faster" only when both slots share a type so we don't compare pure
          local ONNX latency against cloud wall-clock (includes network). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SlotResultPanel label="Slot A" result={resultA} isWinner={faster === "a"} />
        <SlotResultPanel label="Slot B" result={resultB} isWinner={faster === "b"} />
      </div>
    </div>
  );
}
