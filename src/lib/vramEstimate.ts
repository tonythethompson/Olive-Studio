import { IHVProvider, UIState } from "@/types";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

export type VramConfidence = "high" | "medium" | "low";
export type VramFit = "fits" | "tight" | "insufficient" | "unknown";

export interface VramEstimate {
  peakRunGb: number;
  inferenceGb: number;
  sourceWeightGb: number;
  confidence: VramConfidence;
  usesGpu: boolean;
  notes: string[];
}

const WHISPER_PARAMS_B: Record<string, number> = {
  tiny: 0.039,
  base: 0.074,
  small: 0.244,
  medium: 0.769,
  large: 1.55,
  "large-v3": 1.55,
};

function inferParamBillions(identifier: string): { paramsB: number; confidence: VramConfidence } {
  const id = identifier.toLowerCase();

  // Prefer the *smallest* explicit size token (e.g. "…-Qwen-1.5B" not a false 7B default).
  // Matches 1.5B, 7b, 70B, 0.5B, etc. anywhere in the id.
  const allSizeMatches = [...id.matchAll(/(?:^|[/\-_\s])(\d+(?:\.\d+)?)\s*b(?:illion)?(?=[^a-z]|$)/gi)];
  if (allSizeMatches.length > 0) {
    const sizes = allSizeMatches
      .map((m) => parseFloat(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 1000);
    if (sizes.length > 0) {
      return { paramsB: Math.min(...sizes), confidence: "medium" };
    }
  }

  for (const [key, params] of Object.entries(WHISPER_PARAMS_B)) {
    if (id.includes(`whisper-${key}`) || id.includes(`whisper_${key}`)) {
      return { paramsB: params, confidence: "medium" };
    }
  }
  if (id.includes("whisper")) return { paramsB: 0.244, confidence: "low" };

  // Known distill / small models before broad family defaults
  if (id.includes("deepseek") && id.includes("distill") && id.includes("1.5")) {
    return { paramsB: 1.5, confidence: "medium" };
  }

  if (id.includes("phi-3.5") || id.includes("phi3.5")) return { paramsB: 3.8, confidence: "low" };
  if (id.includes("phi-3") || id.includes("phi3")) return { paramsB: 3.8, confidence: "low" };
  if (id.includes("phi-2")) return { paramsB: 2.7, confidence: "low" };
  if (id.includes("llama-3.2") || id.includes("llama3.2")) return { paramsB: 1, confidence: "low" };
  if (id.includes("llama-3") || id.includes("llama3")) return { paramsB: 8, confidence: "low" };
  if (id.includes("llama-2") || id.includes("llama2")) return { paramsB: 7, confidence: "low" };
  if (id.includes("mistral") || id.includes("mixtral")) return { paramsB: 7, confidence: "low" };
  if (id.includes("qwen2.5") || id.includes("qwen2")) return { paramsB: 7, confidence: "medium" };
  if (id.includes("qwen")) return { paramsB: 7, confidence: "low" };
  if (id.includes("sdxl") || id.includes("stable-diffusion-xl")) return { paramsB: 2.6, confidence: "low" };
  if (id.includes("stable-diffusion") || id.includes("sd15")) return { paramsB: 0.9, confidence: "low" };
  if (id.includes("bert-base")) return { paramsB: 0.11, confidence: "medium" };
  if (id.includes("resnet")) return { paramsB: 0.025, confidence: "low" };
  if (id.includes("mobilenet")) return { paramsB: 0.004, confidence: "low" };

  return { paramsB: 7, confidence: "low" };
}

export type EffectiveModelSource = ModelSource;

/**
 * Resolves which model source actually has a model configured, preferring
 * the active `modelSource` tab but falling back to any other source that
 * already has a model. This keeps the loaded model "active" while the user
 * browses a different source tab without yet providing input — e.g. switching
 * to "Local" right after loading a Hugging Face recipe should not discard
 * the loaded model from the VRAM panel or lock downstream pipeline sections.
 *
 * Returns `null` when no source has any model configured at all.
 */
export function getEffectiveModelSource(state: UIState): EffectiveModelSource | null {
  // Defensive against partial / loosely-typed states (some callers pass a
  // minimal snapshot): coerce missing fields to their empty equivalents so
  // the checks never throw on `undefined`.
  const hfModelId = state.hfModelId ?? "";
  const azureModelPath = state.azureModelPath ?? "";
  const localFiles = state.localFiles ?? [];

  const active = state.modelSource;
  if (active === "huggingface" && hfModelId.trim() !== "") return active;
  if (active === "local" && localFiles.length > 0) return active;
  if (active === "azure" && azureModelPath.trim() !== "") return active;

  // Active tab has no model yet — fall back to any source that does, so the
  // previously loaded model stays in effect until the user provides new input.
  if (hfModelId.trim() !== "") return "huggingface";
  if (localFiles.length > 0) return "local";
  if (azureModelPath.trim() !== "") return "azure";
  return null;
}

/** Short label for VRAM UI — full HF id or local filename. */
export function getVramModelLabel(state: UIState): string {
  const source = getEffectiveModelSource(state);
  if (source === "huggingface") return (state.hfModelId ?? "").trim();
  if (source === "azure") return (state.azureModelPath ?? "").trim();
  if (source === "local") return state.localFiles[0].name;
  return "No model selected";
}

/** Display name (repo tail) for compact UI. */
export function getVramModelShortName(state: UIState): string {
  const label = getVramModelLabel(state);
  if (label === "No model selected") return label;
  if (label.includes("/")) return label.split("/").pop() ?? label;
  if (label.includes("\\")) return label.split("\\").pop() ?? label;
  return label;
}

function resolveSourceWeightGb(state: UIState): {
  weightGb: number;
  paramBillions: number;
  confidence: VramConfidence;
  notes: string[];
} {
  const source = getEffectiveModelSource(state);

  if (source === "local") {
    const totalBytes = state.localFiles.reduce((sum, file) => sum + file.size, 0);
    return {
      weightGb: totalBytes / 1024 ** 3,
      paramBillions: 0,
      confidence: "high",
      notes: ["Based on total uploaded weight file size."],
    };
  }

  const identifier =
    source === "huggingface"
      ? state.hfModelId
      : source === "azure"
        ? state.azureModelPath
        : "";

  if (!identifier.trim()) {
    const weightGb = paramsToGb(7, 2);
    return {
      weightGb,
      paramBillions: 7,
      confidence: "low",
      notes: ["No model selected — using a generic ~7B FP16 placeholder."],
    };
  }

  const { paramsB, confidence } = inferParamBillions(identifier);
  const bytesPerParam = sourceBytesPerParam(state);
  return {
    weightGb: paramsToGb(paramsB, bytesPerParam),
    paramBillions: paramsB,
    confidence,
    notes: [`Inferred ~${paramsB}B parameters from model id.`],
  };
}

function paramsToGb(paramBillions: number, bytesPerParam: number): number {
  return (paramBillions * 1e9 * bytesPerParam) / 1024 ** 3;
}

/** Precision of weights as loaded / before optimization passes. */
function sourceBytesPerParam(state: UIState): number {
  const dtype = state.passes.conversionInputTargetTypes.toLowerCase();
  if (dtype.includes("int8")) return 1;
  if (dtype.includes("float16") || dtype.includes("bfloat16")) return 2;
  if (dtype.includes("float32") || dtype.includes("float64")) return 4;
  return 2;
}

/** Deployed artifact precision after active optimization passes. */
function deployedBytesPerParam(state: UIState): number {
  if (state.passes.quantization) {
    switch (state.passes.quantPrecision) {
      case "int4":
        return 0.5;
      case "int8":
        return 1;
      case "fp16":
        return 2;
      default: {
        const _exhaustive: never = state.passes.quantPrecision;
        return _exhaustive;
      }
    }
  }
  return sourceBytesPerParam(state);
}

function effectiveParamBillions(state: UIState, paramBillions: number): number {
  if (paramBillions <= 0) {
    return 0;
  }
  if (state.passes.pruning) {
    return paramBillions * (1 - state.passes.pruningSparsity);
  }
  return paramBillions;
}

/**
 * Peak memory during Olive is higher than deployed inference weights, but not
 * "full VRAM card size" for small models. Keep multipliers modest for non-training paths.
 */
function peakRunMultiplier(state: UIState): number {
  // Training / adapter paths dominate peak memory.
  if (state.passes.peft) {
    return state.passes.peftMethod === "qlora" ? 2.4 : 2.8;
  }
  if (state.passes.quantization) {
    // Calibration buffers — not 2× full FP16 weights forever
    let m = state.passes.quantMethod === "awq" ? 1.55 : state.passes.quantMethod === "qat" ? 2.0 : 1.45;
    if (state.passes.pruning) m += 0.1;
    return m;
  }
  // Convert / optimize only
  return state.passes.pruning ? 1.35 : 1.25;
}

export function isGpuProvider(provider: IHVProvider): boolean {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
    case "TensorrtExecutionProvider":
    case "ROCMExecutionProvider":
    case "MIGraphXExecutionProvider":
    case "WebGpuExecutionProvider":
    case "DmlExecutionProvider":
      return true;
    case "CPUExecutionProvider":
    case "DnnlExecutionProvider":
    case "OpenVINOExecutionProvider":
    case "QNNExecutionProvider":
    case "QnnAbiExecutionProvider":
    case "CoreMLExecutionProvider":
    case "NNAPIExecutionProvider":
    case "VitisAIExecutionProvider":
    case "SNPEExecutionProvider":
    case "TensorflowLiteExecutionProvider":
    case "XnnpackExecutionProvider":
    case "WasmExecutionProvider":
      return false;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function formatMemoryGb(gb: number): string {
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(gb * 1024)} MB`;
}

export function estimateVramRequirement(state: UIState): VramEstimate {
  const source = resolveSourceWeightGb(state);
  const paramBillions =
    source.paramBillions > 0
      ? source.paramBillions
      : source.weightGb / paramsToGb(1, sourceBytesPerParam(state));

  const effectiveParams = effectiveParamBillions(state, paramBillions);
  const inferenceGb =
    source.paramBillions > 0 ? paramsToGb(effectiveParams, deployedBytesPerParam(state)) : source.weightGb;
  // Peak uses the larger of FP source weights vs current deployed size, times a pass-aware multiplier.
  // Floor: never show peak below optimized inference size.
  const baseForPeak = Math.max(source.weightGb, inferenceGb);
  const peakRunGb = Math.max(inferenceGb, baseForPeak * peakRunMultiplier(state));
  const usesGpu = isGpuProvider(state.ihvProvider);

  const passNotes: string[] = [];
  if (state.passes.peft) {
    passNotes.push(
      state.passes.peftMethod === "qlora"
        ? "QLoRA tuning raises peak memory."
        : "LoRA tuning raises peak memory.",
    );
  }
  if (state.passes.quantization) {
    passNotes.push(
      `Quantization (${state.passes.quantMethod.toUpperCase()}) needs calibration buffers during the run.`,
    );
  }

  return {
    peakRunGb,
    inferenceGb,
    sourceWeightGb: source.weightGb,
    confidence: source.confidence,
    usesGpu,
    notes: [
      ...source.notes,
      usesGpu
        ? "Peak GPU memory during Olive optimization (heuristic)."
        : "Peak host RAM during optimization (heuristic).",
      ...passNotes,
    ],
  };
}

/**
 * Determines the available VRAM for the selected execution provider.
 *
 * @param probe - Hardware information containing GPU details
 * @param provider - Execution provider whose GPUs should be evaluated
 * @returns The largest reported GPU VRAM in GiB, or `null` when no valid matching GPU data is available
 */
export function getSelectedGpuVramGb(
  probe: HardwareProbeResult | null | undefined,
  provider: IHVProvider,
): number | null {
  if (!probe) return null;

  const gpus =
    provider === "ROCMExecutionProvider"
      ? (probe.rocm?.gpus ?? [])
      : provider === "CUDAExecutionProvider" ||
        provider === "NvTensorRTRTXExecutionProvider" ||
        provider === "TensorrtExecutionProvider"
        ? (probe.nvidia?.gpus ?? [])
        : provider === "DmlExecutionProvider" || provider === "WebGpuExecutionProvider"
        ? [...(probe.nvidia?.gpus ?? []), ...(probe.rocm?.gpus ?? [])]
        : [];

  const vramMb = gpus.map((gpu) => gpu.vramMb).filter((value): value is number => value != null && value > 0);

  if (!vramMb.length) {
    if (provider === "DmlExecutionProvider" || provider === "WebGpuExecutionProvider") {
      return getPrimaryGpuVramGb(probe);
    }
    return null;
  }
  return Math.max(...vramMb) / 1024;
}

/**
 * Determines the largest discrete GPU memory capacity reported by the hardware probe.
 *
 * @param probe - Hardware information used to identify available GPU memory
 * @returns The largest GPU VRAM capacity in GiB, or `null` when no valid GPU data is available
 */
export function getPrimaryGpuVramGb(probe: HardwareProbeResult | null | undefined): number | null {
  if (!probe) return null;
  const vramMb = [...(probe.nvidia?.gpus ?? []), ...(probe.rocm?.gpus ?? [])]
    .map((gpu) => gpu.vramMb)
    .filter((value): value is number => value != null && value > 0);
  if (!vramMb.length) return null;
  return Math.max(...vramMb) / 1024;
}

/**
 * Classifies whether available memory can accommodate a VRAM requirement.
 *
 * @param neededGb - Required memory in GiB
 * @param availableGb - Available memory in GiB
 * @returns `"fits"` when usage is at most 85%, `"tight"` when usage is above 85% and at most 105%, or `"insufficient"` when usage exceeds 105%
 */
export function compareVramFit(neededGb: number, availableGb: number): VramFit {
  if (neededGb <= availableGb * 0.85) return "fits";
  if (neededGb <= availableGb * 1.05) return "tight";
  return "insufficient";
}

/** Combined GPU VRAM + host RAM budget when HF device_map offload is enabled. */
export function getHybridMemoryPoolGb(gpuVramGb: number, systemRamGb: number): number {
  return gpuVramGb * 0.9 + systemRamGb * 0.75;
}
