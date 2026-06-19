import { IHVProvider, UIState } from "@/types";

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
];
const NPU_PROVIDERS: IHVProvider[] = ["QNNExecutionProvider"];

export function inferHfTask(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes("whisper")) return "speech-recognition";
  if (id.includes("bert") || id.includes("roberta") || id.includes("deberta")) return "fill-mask";
  if (id.includes("t5") || id.includes("bart")) return "text2text-generation";
  if (id.includes("vit") || id.includes("clip") || id.includes("resnet") || id.includes("mobilenet")) {
    return "image-classification";
  }
  return "text-generation";
}

export function inferModelType(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes("llama")) return "llama";
  if (id.includes("phi")) return "phi";
  if (id.includes("whisper")) return "whisper";
  if (id.includes("bert") || id.includes("roberta")) return "bert";
  if (id.includes("qwen")) return "qwen";
  if (id.includes("mistral") || id.includes("mixtral")) return "mistral";
  if (id.includes("falcon")) return "falcon";
  if (id.includes("t5")) return "t5";
  if (id.includes("gpt2") || id.includes("gpt-2")) return "gpt2";
  return "gpt2";
}

export function providerToAccelerator(
  provider: IHVProvider
): { device: string; execution_providers: string[] } {
  const device = GPU_PROVIDERS.includes(provider)
    ? "gpu"
    : NPU_PROVIDERS.includes(provider)
      ? "npu"
      : "cpu";
  return { device, execution_providers: [provider] };
}

export function buildOliveRecipe(state: UIState): Record<string, unknown> {
  const recipe: Record<string, unknown> = {
    input_model: {
      type: "PyTorchModel",
      config: {} as Record<string, unknown>,
    },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: {
          accelerators: [providerToAccelerator(state.ihvProvider)],
        },
      },
    },
    passes: {} as Record<string, unknown>,
    engine: {
      search_strategy: { execution_order: "joint", search_algorithm: "exhaustive" },
      host: "local_system",
      target: "local_system",
      cache_dir:
        state.distributedCaching && state.azureStr ? state.azureStr : state.cacheDir || "~/.cache/olive",
      output_dir: "./models/optimized",
    },
  };

  const inputConfig = (recipe.input_model as { config: Record<string, unknown> }).config;

  if (state.modelSource === "huggingface") {
    inputConfig.hf_config = {
      model_name: state.hfModelId || "unspecified",
      task: inferHfTask(state.hfModelId || ""),
      ...(state.hfDataset ? { dataset: state.hfDataset } : {}),
    };
  } else if (state.modelSource === "local") {
    inputConfig.model_path = "./local_models";
    if (state.localFiles.length > 0) {
      inputConfig.local_files = state.localFiles.map((f) => f.name);
    }
  } else if (state.modelSource === "azure") {
    inputConfig.model_path = state.azureModelPath || "azureml://...";
  }

  const passes = recipe.passes as Record<string, unknown>;

  if (state.passes.conversion) {
    if (state.passes.conversionFormat === "onnx") {
      passes.conversion = {
        type: "OnnxConversion",
        config: {
          target_opset: state.passes.conversionOpset,
          precision: state.passes.conversionInputTargetTypes,
        },
      };
    } else {
      passes.conversion = { type: "OpenVINOConversion", config: {} };
    }
  }

  if (state.passes.quantization) {
    const quantConfig: Record<string, unknown> = {
      weight_type: state.passes.quantPrecision,
      optimize_model: true,
    };
    if (state.passes.quantMethod === "awq") {
      quantConfig.algorithm = "awq";
    } else if (state.passes.quantMethod === "qat") {
      quantConfig.quant_mode = "QLinearOps";
    }
    passes.quantization = { type: "OnnxQuantization", config: quantConfig };
  }

  if (state.passes.onnxTransforms) {
    passes.transformer_opt = {
      type: "OrtTransformersOptimization",
      config: {
        model_type: inferModelType(state.hfModelId || ""),
        use_gpu: GPU_PROVIDERS.includes(state.ihvProvider),
      },
    };
  }

  if (state.passes.splitting) {
    passes.splitting = { type: "ModelSplitting", config: {} };
  }

  if (state.passes.peft) {
    const peftType = state.passes.peftMethod === "qlora" ? "QLoRA" : "LoRA";
    passes.peft = { type: peftType, config: { r: 8, lora_alpha: 16 } };
  }

  if (state.passes.pruning) {
    const pType =
      state.passes.pruningMethod === "sparsegpt"
        ? "SparseGPT"
        : state.passes.pruningMethod === "wanda"
          ? "Wanda"
          : "Prune";
    const config: Record<string, unknown> = { sparsity: state.passes.pruningSparsity };

    if (state.passes.pruningType === "structured") {
      config.semi_sparse_acc = true;
    }

    if (pType === "Prune") {
      config.pruning_criteria = state.passes.pruningCriteria;
    }

    passes.pruning = { type: pType, config };
  }

  return recipe;
}
