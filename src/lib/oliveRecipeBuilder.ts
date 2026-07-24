import { IHVProvider, UIState } from "@/types";
import { buildHfLoadKwargs, buildPeftOffloadConfig, isMemoryOffloadActive } from "@/lib/memoryOffload";

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
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

export function providerToAccelerator(provider: IHVProvider): {
  device: string;
  execution_providers: string[];
} {
  const device = GPU_PROVIDERS.includes(provider) ? "gpu" : NPU_PROVIDERS.includes(provider) ? "npu" : "cpu";
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
      // Fixed pipeline order from the graph — no pass search (would require evaluators).
      search_strategy: false,
      host: "local_system",
      target: "local_system",
      cache_dir:
        state.distributedCaching && state.azureStr ? state.azureStr : state.cacheDir || "~/.cache/olive",
      output_dir: "./models/optimized",
    },
  };

  const inputConfig = (recipe.input_model as { config: Record<string, unknown> }).config;
  const useMemoryOffload = isMemoryOffloadActive(state);

  if (state.modelSource === "huggingface") {
    if (useMemoryOffload) {
      (recipe.input_model as { type: string }).type = "HfModel";
      inputConfig.model_path = state.hfModelId || "unspecified";
      inputConfig.task = inferHfTask(state.hfModelId || "");
      if (state.hfDataset) {
        inputConfig.dataset = state.hfDataset;
      }
      inputConfig.load_kwargs = buildHfLoadKwargs(state.ihvProvider, null);
    } else {
      inputConfig.hf_config = {
        model_name: state.hfModelId || "unspecified",
        task: inferHfTask(state.hfModelId || ""),
        ...(state.hfDataset ? { dataset: state.hfDataset } : {}),
      };
    }
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
          input_model_dtype: state.passes.conversionInputTargetTypes,
          source_format: state.passes.conversionSourceFormat,
        },
      };
    } else {
      passes.conversion = { type: "OpenVINOConversion", config: {} };
    }
  }

  if (state.passes.quantization) {
    if (state.passes.quantMethod === "awq") {
      const awqConfig: Record<string, unknown> = {
        bits: state.passes.quantPrecision === "int4" ? 4 : 8,
        input_model_dtype: state.passes.conversionInputTargetTypes || "fp16",
        group_size: state.passes.awqGroupSize,
        damp_percent: state.passes.awqDampPercent,
        sym: state.passes.awqSym,
      };
      if (state.hfDataset) {
        awqConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        awqConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "AutoAWQQuantizer",
        config: awqConfig,
      };
    } else if (state.passes.quantMethod === "gptq") {
      const gptqConfig: Record<string, unknown> = {
        bits: state.passes.quantPrecision === "int4" ? 4 : 8,
        input_model_dtype: state.passes.conversionInputTargetTypes || "fp16",
        block_size: state.passes.gptqBlockSize,
        group_size: state.passes.gptqGroupSize,
        desc_act: state.passes.gptqDescAct,
      };
      if (state.hfDataset) {
        gptqConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        gptqConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "GptqQuantizer",
        config: gptqConfig,
      };
    } else if (state.passes.quantMethod === "qat") {
      const qatConfig: Record<string, unknown> = {
        precision: state.passes.qatQuantPrecision,
        calibrate_method: state.passes.qatCalibrateMethod,
        calibrate_steps: state.passes.qatCalibrateSteps,
      };
      if (state.hfDataset) {
        qatConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        qatConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "QATQuantizer",
        config: qatConfig,
      };
    } else if (state.passes.quantMethod === "hqq") {
      // Docs: https://microsoft.github.io/Olive/0.12.1/reference/options.html -> OnnxHqqQuantization
      const hqqConfig: Record<string, unknown> = {
        precision: state.passes.quantPrecision === "int4" ? "int4" : "int8",
      };
      if (state.hfDataset) {
        hqqConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        hqqConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "OnnxHqqQuantization",
        config: hqqConfig,
      };
    } else if (state.passes.quantMethod === "rtn") {
      // Docs: https://microsoft.github.io/Olive/0.12.1/reference/options.html -> OnnxBlockWiseRtnQuantization
      const rtnConfig: Record<string, unknown> = {
        bits: state.passes.quantPrecision === "int4" ? 4 : 8,
        block_size: 128,
        is_symmetric: true,
      };
      if (state.hfDataset) {
        rtnConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        rtnConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "OnnxBlockWiseRtnQuantization",
        config: rtnConfig,
      };
    } else if (state.passes.quantMethod === "spinquant") {
      // Docs: https://microsoft.github.io/Olive/0.12.1/features/quantization.html -> SpinQuant
      // Only supports HuggingFace transformer PyTorch models.
      const spinConfig: Record<string, unknown> = {
        rotate_mode: "hadamard",
      };
      if (state.hfDataset) {
        spinConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        spinConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "SpinQuant",
        config: spinConfig,
      };
    } else if (state.passes.quantMethod === "quarot") {
      // Docs: https://microsoft.github.io/Olive/0.12.1/features/quantization.html -> QuaRot
      // Only supports HuggingFace transformer PyTorch models.
      const quarotConfig: Record<string, unknown> = {
        rotate_mode: "hadamard",
      };
      if (state.hfDataset) {
        quarotConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        quarotConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "QuaRot",
        config: quarotConfig,
      };
    } else {
      const quantConfig: Record<string, unknown> = {
        quant_mode: "static",
        precision: state.passes.quantPrecision,
        quant_preprocess: true,
      };
      if (state.hfDataset) {
        quantConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        quantConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "OnnxQuantization",
        config: quantConfig,
      };
    }
  }

  if (state.passes.onnxTransforms) {
    const ortConfig: Record<string, unknown> = {
      model_type: inferModelType(state.hfModelId || ""),
      use_gpu: GPU_PROVIDERS.includes(state.ihvProvider),
    };
    if (state.userScript) {
      ortConfig.user_script = state.userScript;
    }
    passes.transformer_opt = {
      type: "OrtTransformersOptimization",
      config: ortConfig,
    };
  }

  if (state.passes.splitting) {
    passes.splitting = { type: "SplitModel", config: {} };
  }

  if (state.passes.peft) {
    const peftType = state.passes.peftMethod === "qlora" ? "QLoRA" : "LoRA";
    const peftConfig: Record<string, unknown> = { r: 8, alpha: 16 };
    if (state.passes.diffusionLora) {
      peftConfig.diffusion_lora = true;
    }
    if (useMemoryOffload) {
      Object.assign(peftConfig, buildPeftOffloadConfig());
    }
    passes.peft = { type: peftType, config: peftConfig };
  }

  if (state.passes.pruning) {
    const pType =
      state.passes.pruningMethod === "sparsegpt"
        ? "SparseGPT"
        : state.passes.pruningMethod === "wanda"
          ? "Wanda"
          : "Prune";
    const config: Record<string, unknown> = { sparsity: state.passes.pruningSparsity };

    if (state.userScript) {
      config.user_script = state.userScript;
    }

    passes.pruning = { type: pType, config };
  }

  // Evaluators block for custom metrics (required for accuracy evaluation).
  if (state.userScript && state.hfDataset) {
    (recipe as Record<string, unknown>).data_configs = [
      {
        name: "eval_data_config",
        user_script: state.userScript,
        data_dir: state.hfDataset,
      },
    ];
    (recipe as Record<string, unknown>).evaluators = {
      common_evaluator: {
        metrics: [
          {
            name: "accuracy",
            type: "accuracy",
            data_config: "eval_data_config",
            sub_types: [{ name: "accuracy_score", priority: 1 }],
          },
        ],
      },
    };
  }

  return recipe;
}
