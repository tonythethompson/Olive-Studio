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
import {
  REPLACEMENT_PIPELINE_SUPPRESSED_PASSES,
  isReplacementExportPipeline,
} from "@/lib/replacementExportPipeline";
import { PEFT_UNSUPPORTED_PROVIDERS } from "@/lib/providerRuntimeKind";

// ─── Provider Constant Sets ───────────────────────────────────────────────────

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
];

// Canonical set — shared with pipelineValidation.ts via import. Structured
// sparsity requires NVIDIA CUDA or TensorRT tensor-core hardware.
const TENSOR_CORE_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
];

// ─── Inlined Helpers (avoid pulling in vramEstimate/hardwareProbe chain) ──────

/** GPU providers that support memory offload (mirrors memoryOffload.ts). */
const OFFLOAD_GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
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
    // OnnxHqqQuantization, OnnxBlockWiseRtnQuantization, and KQuant/OnnxKquantQuantization support CPU, CUDA, and CoreML (Apple CPU/ANE path).
    return (
      provider === "CPUExecutionProvider" ||
      provider === "CUDAExecutionProvider" ||
      provider === "CoreMLExecutionProvider"
    );
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
  return !PEFT_UNSUPPORTED_PROVIDERS.includes(provider);
}

export function isPeftMethodAllowed(method: UIState["passes"]["peftMethod"], provider: IHVProvider): boolean {
  if (method === "qlora") return GPU_PROVIDERS.includes(provider);
  return true;
}

// ─── Cross-Pass Coercion Rules ────────────────────────────────────────────────

export interface CrossPassCoercion {
  /** Matches the `CrossPassRule.id` of the matching CROSS_PASS_RULES entry. */
  id: string;
  applies: (passes: UIState["passes"], provider: IHVProvider) => boolean;
  fix: Partial<UIState["passes"]>;
}

/**
 * Auto-coercion rules: applied silently on every state commit to prevent
 * impossible pass combinations. This is the single source of truth for the
 * `autoCoerce: true` behavior of CROSS_PASS_RULES in pipelineValidation.ts —
 * that table spreads these entries (by id) so coercion and validation cannot
 * drift. Rule order matches CROSS_PASS_RULES and is significant.
 */
export const AUTO_COERCE_RULES: CrossPassCoercion[] = [
  {
    // LoRA + base quant cannot become QLoRA on inference-only providers.
    // Preserve LoRA and drop the incompatible base-quantization pass instead.
    id: "peft-lora-quant-no-qlora",
    applies: (passes, provider) =>
      passes.peft &&
      passes.quantization &&
      passes.quantPrecision !== "fp16" &&
      passes.peftMethod === "lora" &&
      !isPeftMethodAllowed("qlora", provider),
    fix: { quantization: false },
  },
  {
    // LoRA + base quant → switch to QLoRA
    id: "peft-lora-quant",
    applies: (passes, provider) =>
      passes.peft &&
      passes.quantization &&
      passes.quantPrecision !== "fp16" &&
      passes.peftMethod === "lora" &&
      isPeftMethodAllowed("qlora", provider),
    fix: { peftMethod: "qlora" },
  },
  {
    // INT4 + pruning double compression → upgrade to INT8
    id: "pruning-int4-collapse",
    applies: (passes) => passes.pruning && passes.quantization && passes.quantPrecision === "int4",
    fix: { quantPrecision: "int8" },
  },
  {
    // OpenVINO conversion + ONNX transforms clash → disable transforms
    id: "openvino-onnx-transforms-clash",
    applies: (passes) => passes.conversion && passes.conversionFormat === "openvino" && passes.onnxTransforms,
    fix: { onnxTransforms: false },
  },
  {
    // Splitting + QAT incompatibility → disable splitting
    id: "splitting-qat-conflict",
    applies: (passes) => passes.splitting && passes.quantization && passes.quantMethod === "qat",
    fix: { splitting: false },
  },
  {
    // QairtPipeline produces no ONNX graph → disable discrepancy check
    id: "qairt-discrepancy-incompatible",
    applies: (passes, provider) =>
      passes.onnxDiscrepancyCheck &&
      passes.qairtPipeline &&
      (provider === "QNNExecutionProvider" || provider === "QnnAbiExecutionProvider"),
    fix: { onnxDiscrepancyCheck: false },
  },
  {
    // QairtPipeline only runs on QNN providers
    id: "qairt-pipeline-requires-qnn",
    applies: (passes, provider) =>
      passes.qairtPipeline && provider !== "QNNExecutionProvider" && provider !== "QnnAbiExecutionProvider",
    fix: { qairtPipeline: false },
  },
  {
    // SimplifiedLayerNormToRMSNorm targets QNN only
    id: "simplified-layernorm-requires-qnn",
    applies: (passes, provider) =>
      passes.simplifiedLayerNormToRMSNorm &&
      provider !== "QNNExecutionProvider" &&
      provider !== "QnnAbiExecutionProvider",
    fix: { simplifiedLayerNormToRMSNorm: false },
  },
  {
    // MobiusBuilder targets CPU/CUDA, never QNN
    id: "mobius-builder-incompatible-qnn",
    applies: (passes, provider) =>
      passes.mobiusBuilder && (provider === "QNNExecutionProvider" || provider === "QnnAbiExecutionProvider"),
    fix: { mobiusBuilder: false },
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

  // Persisted state may carry non-boolean values; consent is boolean-only.
  next.trustRemoteCode = next.trustRemoteCode === true;

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
  // Replace (do not deep-merge) when the key is present so recipe loads can
  // clear stale MCP overrides with `passRecipeOverrides: {}`. Callers that need
  // incremental accumulation (MCP Apply Fix) must merge onto current overrides
  // before setState.
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
export function sanitizePipelineStateShallow(state: UIState): UIState {
  const openvinoTargetDevice =
    state.openvinoTargetDevice === "CPU" ||
    state.openvinoTargetDevice === "GPU" ||
    state.openvinoTargetDevice === "NPU"
      ? state.openvinoTargetDevice
      : "CPU";

  return {
    ...state,
    openvinoTargetDevice,
    memoryOffload:
      state.memoryOffload === "auto" && !isMemoryOffloadAvailable(state) ? "gpu_only" : state.memoryOffload,
    passes: coercePassFields(state.passes, state.ihvProvider),
  };
}

/**
 * Shallow merge + sanitize. `commitUiStateUpdate` in pipelineValidation.ts stays
 * the state-mutation entry point used by pipelineStore.ts.
 */
export function commitUiStateUpdateShallow(prev: UIState, partial: Partial<UIState>): UIState {
  return sanitizePipelineStateShallow(mergeUiState(prev, partial));
}
