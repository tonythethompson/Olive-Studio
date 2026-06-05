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
  systems: Record<string, any>;
  evaluators: Record<string, any>;
  passes: Record<string, PassConfig>;
  engine: {
    search_strategy: any;
    evaluator: string;
    host: string;
    target: string;
    cache_dir: string;
    output_dir: string;
  };
}

export interface PassConfig {
  type: string;
  config: Record<string, any>;
}

export type IHVProvider = "CPUExecutionProvider" | "CUDAExecutionProvider" | "TensorrtExecutionProvider" | "OpenVINOExecutionProvider" | "QNNExecutionProvider" | "ROCMExecutionProvider";

export interface BatchJob {
  id: string;
  name: string;
  modelSource: ModelSource;
  modelIdentifier: string;
  provider: IHVProvider;
  passes: string[];
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  logs: string[];
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
  ihvProvider: IHVProvider;
  cacheDir: string;
  azureStr: string;
  batchJobs?: BatchJob[];
  passes: {
    conversion: boolean;
    conversionSourceFormat: "pytorch" | "tensorflow" | "jax";
    conversionFormat: "onnx" | "openvino";
    conversionOpset: number;
    conversionInputTargetTypes: string;
    quantization: boolean;
    quantMethod: "ptq" | "awq" | "qat";
    quantPrecision: "int4" | "int8" | "fp16";
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
  }
}
