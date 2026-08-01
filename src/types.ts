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
  /* eslint-disable @typescript-eslint/no-explicit-any */
  systems: Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}

export type IHVProvider =
  | "CPUExecutionProvider"
  | "CUDAExecutionProvider"
  | "TensorrtExecutionProvider"
  | "NvTensorRTRTXExecutionProvider"
  | "OpenVINOExecutionProvider"
  | "QNNExecutionProvider"
  | "ROCMExecutionProvider"
  | "WebGpuExecutionProvider";

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
  status: "queued" | "running" | "completed" | "failed";
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
  /** Hugging Face load_kwargs device_map — GPU + host RAM when auto. */
  memoryOffload: "gpu_only" | "auto";
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

/** MCP diagnostic response from troubleshoot_olive_error tool. */
export interface McpDiagnostic {
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
}
