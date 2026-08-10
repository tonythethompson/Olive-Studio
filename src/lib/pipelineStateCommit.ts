/**
 * Lightweight pipeline state commit logic.
 *
 * Extracted from pipelineValidation.ts so the zustand store (pipelineStore.ts)
 * can commit state updates WITHOUT pulling in the heavy validation dependency
 * tree (oliveRecipeBuilder, qnnReadiness, schemaEngine, hardwareProbe).
 *
 * This module contains ONLY the state merge, pass coercion, and cross-pass
 * autofix logic — everything needed to enforce invariants on every state
 * mutation. The full getPipelineValidation() is lazy-loaded only by panels
 * that display validation results.
 */
import type { IHVProvider, UIState } from "@/types";
import { REPLACEMENT_PIPELINE_SUPPRESSED_PASSES, isReplacementExportPipeline } from "@/lib/replacementExportPipeline";

// ─── Provider Constant Sets ───────────────────────────────────────────────────

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider" as IHVProvider,
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider" as IHVProvider,
  "WebGpuExecutionProvider",
];

const TENSOR_CORE_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "DmlExecutionProvider",
];

// ─── Inlined Helpers (avoid pulling in vramEstimate/hardwareProbe chain) ──────

/** GPU providers that support memory offload (mirrors memoryOffload.ts). */
const OFFLOAD_GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider" as IHVProvider,
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider" as IHVProvider,
  "DmlExecutionProvider",
];

function isMemoryOffloadAvailable(state: UIState): boolean {
  return (
    state.modelSource === "huggingface" &&
    Boolean(state.hfModelId.trim()) &&
    OFFLOAD_GPU_PROVIDERS.includes(state.ihvProvider)
  );
}

// ─── Pass Field Predicates ────────────────────────────────────────────────────

export function isQuantMethodAllowed(
  method: UIState["passes"]["quantMethod"],
  provider: IHVProvider,
): boolean {
  if (method === "awq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "gptq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "qat") {
    return provider !== "QNNExecutionProvider" && provider !== "QnnAbiExecutionProvider";
  }
  if (method === "hqq" || method === "rtn" || method === "kquant") {
    // OnnxHqqQuantization, OnnxBlockWiseRtnQuantization, and KQuant/OnnxKquantQuantization only support CPU/CUDA.
    return provider === "CPUExecutionProvider" || provider === "CUDAExecutionProvider";
  }
  if (method === "spinquant" || method === "quarot") {
    return GPU_PROVIDERS.includes(provider);
  }
  return true;
}

export function isConversionFormatAllowed(
  format: UIState["passes"]["conversionFormat"],
  provider: IHVProvider,
): boolean {
  if (format === "openvino") return provider === "OpenVINOExecutionProvider";
  return true;
}

export function isStructuredPruningAllowed(provider: IHVProvider): boolean {
  return TENSOR_CORE_PROVIDERS.includes(provider);
}

export function isPeftAllowed(provider: IHVProvider): boolean {
  return !["QNNExecutionProvider", "QnnAbiExecutionProvider", "OpenVINOExecutionProvider"].includes(provider);
}

export function isPeftMethodAllowed(method: UIState["passes"]["peftMethod"], provider: IHVProvider): boolean {
  if (method === "qlora") return GPU_PROVIDERS.includes(provider);
  return true;
}

// ─── Cross-Pass Coercion Rules ────────────────────────────────────────────────

interface CrossPassCoercion {
  applies: (passes: UIState["passes"], provider: IHVProvider) => boolean;
  fix: Partial<UIState["passes"]>;
}

/**
 * Auto-coercion rules: applied silently on every state commit to prevent
 * impossible pass combinations. These mirror the `autoCoerce: true` entries
 * from CROSS_PASS_RULES in pipelineValidation.ts.
 */
const AUTO_COERCE_RULES: CrossPassCoercion[] = [
  {
    // LoRA + base quant → switch to QLoRA
    applies: (passes) =>
      passes.peft && passes.quantization && passes.quantPrecision !== "fp16" && passes.peftMethod === "lora",
    fix: { peftMethod: "qlora" },
  },
  {
    // INT4 + pruning double compression → upgrade to INT8
    applies: (passes) => passes.pruning && passes.quantization && passes.quantPrecision === "int4",
    fix: { quantPrecision: "int8" },
  },
  {
    // OpenVINO conversion + ONNX transforms clash → disable transforms
    applies: (passes) => passes.conversion && passes.conversionFormat === "openvino" && passes.onnxTransforms,
    fix: { onnxTransforms: false },
  },
  {
    // Splitting + QAT incompatibility → disable splitting
    applies: (passes) => passes.splitting && passes.quantization && passes.quantMethod === "qat",
    fix: { splitting: false },
  },
];

// ─── Core Functions ───────────────────────────────────────────────────────────

/** Strip pass/EP combinations that cannot run — applied on every state commit. */
export function coercePassFields(passes: UIState["passes"], provider: IHVProvider): UIState["passes"] {
  const next: UIState["passes"] = { ...passes };

  if (next.conversion && !isConversionFormatAllowed(next.conversionFormat, provider)) {
    next.conversionFormat = "onnx";
  }
  if (next.quantization && !isQuantMethodAllowed(next.quantMethod, provider)) {
    next.quantMethod = "ptq";
  }
  if (next.pruning && next.pruningType === "structured" && !isStructuredPruningAllowed(provider)) {
    next.pruningType = "unstructured";
  }
  if (next.peft && !isPeftAllowed(provider)) {
    next.peft = false;
  }
  if (next.peft && !isPeftMethodAllowed(next.peftMethod, provider)) {
    next.peftMethod = "lora";
  }

  if (next.trustRemoteCode === undefined) {
    next.trustRemoteCode = false;
  }

  if (isReplacementExportPipeline(next)) {
    Object.assign(next, REPLACEMENT_PIPELINE_SUPPRESSED_PASSES);
  }

  // Apply cross-pass auto-coercion rules
  for (const rule of AUTO_COERCE_RULES) {
    if (rule.applies(next, provider)) {
      Object.assign(next, rule.fix);
    }
  }

  return next;
}

/** Partial UIState merge patch; nested `passes` keys are shallow-merged at runtime. */
export type UiStatePatch = Partial<Omit<UIState, "passes">> & { passes?: Partial<UIState["passes"]> };

export function mergeUiState(state: UIState, patch: UiStatePatch): UIState {
  const passRecipeOverrides =
    patch.passRecipeOverrides !== undefined ? patch.passRecipeOverrides : state.passRecipeOverrides;

  return {
    ...state,
    ...patch,
    passes: patch.passes ? { ...state.passes, ...patch.passes } : state.passes,
    passRecipeOverrides,
  };
}

/**
 * Sanitize pipeline state: enforce structural invariants without requiring
 * the heavy validation pipeline. Applies EP coercion + cross-pass auto-fixes.
 */
export function sanitizePipelineState(state: UIState): UIState {
  const openvinoTargetDevice =
    state.openvinoTargetDevice === "CPU" ||
      state.openvinoTargetDevice === "GPU" ||
      state.openvinoTargetDevice === "NPU"
      ? state.openvinoTargetDevice
      : "CPU";

  const current: UIState = {
    ...state,
    openvinoTargetDevice,
    memoryOffload:
      state.memoryOffload === "auto" && !isMemoryOffloadAvailable(state) ? "gpu_only" : state.memoryOffload,
    passes: coercePassFields(state.passes, state.ihvProvider),
  };

  return current;
}

/**
 * The single state-commit entry point: merge + sanitize.
 * Used by pipelineStore.ts on every setState/replaceState/resetState.
 */
export function commitUiStateUpdate(prev: UIState, partial: Partial<UIState>): UIState {
  return sanitizePipelineState(mergeUiState(prev, partial));
}
