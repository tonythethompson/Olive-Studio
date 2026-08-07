export type ModelSource = "huggingface" | "local" | "azure";

export interface OliveRecipe {
  input_model: {
    type: string;
    config: {
      model_path?: string;
      hf_config?: {
        model_name: string;
        task: string;
        dataset: string;
      };
    };
  };
  systems: Record<string, unknown>;
  evaluators?: Record<string, unknown>;
  passes: Record<string, PassConfig>;
  engine: {
    search_strategy: false | Record<string, unknown>;
    evaluator?: string;
    host: string;
    target: string;
    cache_dir: string;
    output_dir: string;
  };
}

export interface PassConfig {
  type: string;
  config: Record<string, unknown>;
}

export type IHVProvider =
  | "CPUExecutionProvider"
  | "CUDAExecutionProvider"
  | "TensorrtExecutionProvider"
  | "NvTensorRTRTXExecutionProvider"
  | "DmlExecutionProvider"
  | "OpenVINOExecutionProvider"
  | "QNNExecutionProvider"
  | "ROCMExecutionProvider"
  | "WebGpuExecutionProvider"
  | "CoreMLExecutionProvider"
  | "NNAPIExecutionProvider"
  | "VitisAIExecutionProvider"
  | "SNPEExecutionProvider"
  | "TensorflowLiteExecutionProvider"
  | "XnnpackExecutionProvider"
  | "WasmExecutionProvider";

/** OpenVINOExecutionProvider silicon target (maps to Olive accelerator.device). */
export type OpenVinoTargetDevice = "CPU" | "GPU" | "NPU";

/**
 * Extra fields applied to a generated Olive pass when building a recipe.
 * Populated by MCP "Apply Fix" from nested `updated_config.passes` entries.
 * Keyed by Olive pass type name (e.g. `OnnxConversion`, `OnnxQuantization`).
 */
export interface PassRecipeOverride {
  /** Olive pass-level output_name (unique intermediate artifact name). */
  output_name?: string;
  /** Merged into the pass `config` object. */
  config?: Record<string, unknown>;
}

export interface BatchJob {
  id: string;
  name: string;
  modelSource: ModelSource;
  modelIdentifier: string;
  provider: IHVProvider;
  passes: string[];
  /** recipe JSON string used to launch this job */
  recipeJson?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  /** null = indeterminate progress */
  progressKnown: boolean;
  logs: string[];
  /** olive backend job ID once started */
  oliveJobId?: string;
  metrics?: {
    latency: string;
    throughput: string;
    memory: string;
    compression: string;
  };
}

// Define strict UI state interfaces
export interface UIState {
  modelSource: ModelSource;
  localFiles: { name: string; size: number }[];
  azureModelPath: string;
  hfModelId: string;
  hfDataset: string;
  /** Explicit HF pipeline task; empty/omitted means infer from model id. */
  hfTask?: string;
  ihvProvider: IHVProvider;
  /**
   * OpenVINOExecutionProvider silicon target (CPU / Intel GPU / NPU).
   * Ignored unless `ihvProvider` is OpenVINOExecutionProvider.
   */
  openvinoTargetDevice: OpenVinoTargetDevice;
  /** Hugging Face load_kwargs device_map — GPU + host RAM when auto. */
  memoryOffload: "gpu_only" | "auto";
  /**
   * Includes driver-identification tags (cu130/cu132) alongside fully
   * resolvable ones. Package resolution (torch index + ORT 1.26 + cu12
   * runtime) must check `RESOLVABLE_CUDA_TAGS` / `isResolvableCudaTag` in
   * `lib/oliveGpuRuntime.ts` — cu130/cu132 have no pins yet and surface an
   * "unsupported CUDA tag" error at recipe-build time.
   */
  cudaVersion: "auto" | "cpu" | "cu118" | "cu121" | "cu124" | "cu126" | "cu128" | "cu130" | "cu132";
  cacheDir: string;
  azureStr: string;
  distributedCaching: boolean;
  /** Path to a user-provided Python script for calibration, evaluation, or training. */
  userScript?: string;
  batchJobs?: BatchJob[];
  /** Active olive job ID for the Execute Live button */
  activeJobId?: string | null;
  /**
   * MCP / advanced pass-level recipe overrides (output_name, extra config keys).
   * Applied by `buildOliveRecipe` onto matching pass types.
   */
  passRecipeOverrides?: Record<string, PassRecipeOverride>;
  passes: {
    conversion: boolean;
    conversionSourceFormat: "pytorch" | "tensorflow" | "jax";
    conversionFormat: "onnx" | "openvino" | "qnn" | "tensorrt";
    conversionOpset: number;
    conversionInputTargetTypes: string;
    quantization: boolean;
    quantMethod: "ptq" | "awq" | "qat" | "gptq" | "hqq" | "rtn" | "spinquant" | "quarot";
    quantPrecision: "int4" | "int8" | "fp16";
    /** GPTQ block size for weight grouping (e.g. 128, 32). Only applies when quantMethod === "gptq". */
    gptqBlockSize: number;
    /** GPTQ activation ordering — improves accuracy at the cost of slower calibration. Only applies when quantMethod === "gptq". */
    gptqDescAct: boolean;
    /** GPTQ group size for quantization (e.g. 128, 64, 32). Only applies when quantMethod === "gptq". */
    gptqGroupSize: number;
    /** AWQ group size for weight quantization (e.g. 128, 64, 32). Only applies when quantMethod === "awq". */
    awqGroupSize: number;
    /** AWQ dampening factor for calibration (e.g. 0.01). Only applies when quantMethod === "awq". */
    awqDampPercent: number;
    /** AWQ symmetric quantization — constrains zero-point to 0 for faster inference. Only applies when quantMethod === "awq". */
    awqSym: boolean;
    /** QAT target precision (e.g. "int4" or "int8"). Only applies when quantMethod === "qat". */
    qatQuantPrecision: "int4" | "int8";
    /** QAT calibration method. Only applies when quantMethod === "qat". */
    qatCalibrateMethod: "minmax" | "percentile" | "entropy";
    /** QAT calibration steps. Only applies when quantMethod === "qat". */
    qatCalibrateSteps: number;
    /** Name of the last applied quantization preset, or empty string if custom/manual. */
    quantPreset: string;
    pruning: boolean;
    pruningSparsity: number;
    pruningType: "structured" | "unstructured";
    pruningMethod: "magnitude" | "sparsegpt" | "wanda";
    pruningCriteria: "l1_norm" | "l2_norm";
    splitting: boolean;
    onnxTransforms: boolean;
    peft: boolean;
    peftMethod: "lora" | "qlora";
    diffusionLora: boolean;
  };
}

/**
 * MCP diagnostic response from `troubleshoot_olive_error`.
 *
 * Display fields (`title`, `root_cause`, `workaround`, …) are unchanged for
 * existing cards/history. Feedback (thumbs up/down) is keyed only by
 * {@link McpDiagnostic.matched_entry} — never by log text.
 */
export interface McpDiagnostic {
  /**
   * Stable knowledge-base entry id when a match is found; `null` when unmatched.
   * Required on the type so callers always read a defined value; local Studio
   * matchers and MCP both set it. Use a non-empty string as the feedback key
   * for `record_troubleshoot_feedback`; omit feedback UI when null/empty.
   */
  matched_entry: string | null;
  title: string;
  root_cause: string;
  workaround: string;
  updated_config?: Record<string, unknown>;
  relevant_quirks?: string[];
  /** olive | studio when matched; null/omitted when no match. */
  domain?: "olive" | "studio" | null;
  /** When false, Apply Fix stays disabled even if updated_config is present. */
  applyable?: boolean;
  related_olive_entry?: string | null;
  /**
   * Optional occurrence metadata from the MCP server (forwarded when present).
   * Not required for feedback; safe to omit on local/unmatched diagnoses.
   */
  frequency?: McpDiagnosticFrequency | null;
}

/** Occurrence stats attached to some MCP diagnosis payloads. */
export interface McpDiagnosticFrequency {
  occurrence_count?: number;
  first_seen?: string | null;
  last_seen?: string | null;
  label?: string | null;
}

/**
 * Thumbs rating for local aggregate troubleshoot feedback.
 * Must match olive-mcp-server `ALLOWED_RATINGS` (`thumbs-up` | `thumbs-down`).
 */
export type McpTroubleshootFeedbackRating = "thumbs-up" | "thumbs-down";

/**
 * Allowlisted reason codes for `record_troubleshoot_feedback`.
 * Must match olive-mcp-server `ALLOWED_REASON_CODES` — never free-form text.
 */
export type McpTroubleshootFeedbackReasonCode =
  | "accurate"
  | "clear_fix"
  | "fixed_issue"
  | "wrong_match"
  | "outdated"
  | "incomplete"
  | "incorrect_fix";

/** Runtime allowlist for feedback ratings (mirrors MCP server). */
export const MCP_TROUBLESHOOT_FEEDBACK_RATINGS: readonly McpTroubleshootFeedbackRating[] = [
  "thumbs-up",
  "thumbs-down",
] as const;

/** Runtime allowlist for feedback reason codes (mirrors MCP server). */
export const MCP_TROUBLESHOOT_FEEDBACK_REASON_CODES: readonly McpTroubleshootFeedbackReasonCode[] = [
  "accurate",
  "clear_fix",
  "fixed_issue",
  "wrong_match",
  "outdated",
  "incomplete",
  "incorrect_fix",
] as const;

/**
 * Args for MCP tool `record_troubleshoot_feedback`.
 * Aggregate-only: entry id + rating (+ optional bounded reason code).
 * Never includes logs, tracebacks, or free-form diagnostic text.
 */
export interface McpTroubleshootFeedbackArgs {
  /** Must be a non-empty {@link McpDiagnostic.matched_entry} known to the KB. */
  matched_entry: string;
  rating: McpTroubleshootFeedbackRating;
  /** Optional allowlisted reason code — not free-form user prose. */
  reason_code?: McpTroubleshootFeedbackReasonCode;
}

/** Successful aggregate acknowledgement from `record_troubleshoot_feedback`. */
export interface McpTroubleshootFeedbackResult {
  status: "ok";
  matched_entry: string;
  rating: McpTroubleshootFeedbackRating;
  reason_code: McpTroubleshootFeedbackReasonCode | null;
  thumbs_up: number;
  thumbs_down: number;
  total: number;
  score_delta?: number;
}

/** Structured error from `record_troubleshoot_feedback` or the proxy. */
export interface McpTroubleshootFeedbackError {
  status: "error";
  error: string;
  message?: string;
}
