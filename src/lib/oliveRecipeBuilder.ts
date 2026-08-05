import { IHVProvider, UIState, OpenVinoTargetDevice } from "@/types";
import { buildHfLoadKwargs, buildPeftOffloadConfig, isMemoryOffloadActive } from "@/lib/memoryOffload";
import { openvinoTargetToOliveDevice } from "@/lib/openvinoDeps";

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
  "DmlExecutionProvider",
];
const NPU_PROVIDERS: IHVProvider[] = ["QNNExecutionProvider"];

/**
 * Infers the Hugging Face task associated with a model identifier.
 *
 * @param modelId - The Hugging Face model identifier to classify
 * @returns The corresponding Hugging Face task name
 */
export function inferHfTask(modelId: string): string {
  const id = modelId.toLowerCase();
  // Transformers pipeline / Olive HfModel expect this exact task id (not "speech-recognition").
  if (id.includes("whisper")) return "automatic-speech-recognition";
  if (
    id.includes("gte-") ||
    id.includes("bge-") ||
    id.includes("e5-") ||
    id.includes("embedding") ||
    id.includes("sentence-transformers")
  ) {
    return "feature-extraction";
  }
  if (id.includes("bert") || id.includes("roberta") || id.includes("deberta")) return "fill-mask";
  if (id.includes("t5") || id.includes("bart")) return "text2text-generation";
  if (id.includes("vit") || id.includes("clip") || id.includes("resnet") || id.includes("mobilenet")) {
    return "image-classification";
  }
  return "text-generation";
}

/**
 * Resolves the Hugging Face task from the configured task or model ID.
 *
 * @param state - UI state containing the optional explicit task and model ID
 * @returns The configured task, normalized speech-recognition task, or inferred task
 */
export function resolveHfTask(state: Pick<UIState, "hfTask" | "hfModelId">): string {
  const explicit = (state.hfTask || "").trim();
  if (explicit) {
    if (explicit === "speech-recognition") return "automatic-speech-recognition";
    return explicit;
  }
  return inferHfTask(state.hfModelId || "");
}

/**
 * Infers the model type from a model identifier.
 *
 * @returns The recognized model type, or `gpt2` when no supported type is identified.
 */
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
  provider: IHVProvider,
  openvinoTargetDevice: OpenVinoTargetDevice = "CPU",
): {
  device: string;
  execution_providers: string[];
} {
  if (provider === "OpenVINOExecutionProvider") {
    return {
      device: openvinoTargetToOliveDevice(openvinoTargetDevice),
      execution_providers: [provider],
    };
  }
  const device = GPU_PROVIDERS.includes(provider) ? "gpu" : NPU_PROVIDERS.includes(provider) ? "npu" : "cpu";
  return { device, execution_providers: [provider] };
}

const PYTORCH_NATIVE_QUANT_METHODS = new Set(["awq", "gptq", "qat", "spinquant", "quarot"]);

export function isPyTorchNativeQuantMethod(method: UIState["passes"]["quantMethod"]): boolean {
  return PYTORCH_NATIVE_QUANT_METHODS.has(method);
}

/**
 * Merge MCP/UI pass recipe overrides (output_name + extra config) onto a pass object.
 * Matches by Olive pass `type` string (e.g. OnnxConversion).
 */
export function applyPassRecipeOverride(
  passObj: Record<string, unknown>,
  overrides: UIState["passRecipeOverrides"] | undefined,
): Record<string, unknown> {
  if (!overrides) return passObj;
  const typeName = typeof passObj.type === "string" ? passObj.type : "";
  if (!typeName) return passObj;
  const ov = overrides[typeName];
  if (!ov) return passObj;

  const next: Record<string, unknown> = { ...passObj };
  if (ov.output_name?.trim()) {
    next.output_name = ov.output_name.trim();
  }
  if (ov.config && Object.keys(ov.config).length > 0) {
    const existing =
      next.config && typeof next.config === "object" && !Array.isArray(next.config)
        ? (next.config as Record<string, unknown>)
        : {};
    next.config = { ...existing, ...ov.config };
  }
  return next;
}

/**
 * Canonical Olive pass order (dict insertion order = run order for fixed pipelines).
 * ONNX: Convert → Optimize → Quantize → (optional FP16) → Split
 * Torch-native quant (AWQ/GPTQ/…): PEFT/Prune → Quant → then ONNX stages if present
 */
function preferredPassOrder(torchQuantActive: boolean): string[] {
  if (torchQuantActive) {
    return ["peft", "pruning", "quantization", "conversion", "transformer_opt", "float16", "splitting"];
  }
  return ["peft", "pruning", "conversion", "transformer_opt", "quantization", "float16", "splitting"];
}

function orderPasses(passes: Record<string, unknown>, torchQuantActive: boolean): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of preferredPassOrder(torchQuantActive)) {
    if (passes[key] !== undefined) ordered[key] = passes[key];
  }
  for (const [key, value] of Object.entries(passes)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

function finalizePasses(
  passes: Record<string, unknown>,
  overrides: UIState["passRecipeOverrides"] | undefined,
  torchQuantActive: boolean,
): Record<string, unknown> {
  const ordered = orderPasses(passes, torchQuantActive);
  if (!overrides || Object.keys(overrides).length === 0) return ordered;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ordered)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = applyPassRecipeOverride(value as Record<string, unknown>, overrides);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Builds an Olive optimization recipe from the configured model, execution provider, passes, and evaluation settings.
 *
 * @param state - The UI configuration used to construct the recipe
 * @returns The configured Olive recipe
 */
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
          accelerators: [providerToAccelerator(state.ihvProvider, state.openvinoTargetDevice)],
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
    // Olive 0.13+ PyTorchModelHandler rejects hf_config; always use HfModel.
    (recipe.input_model as { type: string }).type = "HfModel";
    inputConfig.model_path = state.hfModelId || "unspecified";
    inputConfig.task = resolveHfTask(state);
    if (state.hfDataset) {
      inputConfig.dataset = state.hfDataset;
    }
    if (useMemoryOffload) {
      inputConfig.load_kwargs = buildHfLoadKwargs(state.ihvProvider, null);
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

  // PyTorch-native quantizers consume a torch/HF model, so ONNX conversion and
  // ONNX-only passes cannot precede them in the fixed pipeline order.
  const torchQuantActive = state.passes.quantization && isPyTorchNativeQuantMethod(state.passes.quantMethod);

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
    } else if (state.passes.conversionFormat === "qnn") {
      passes.conversion = { type: "QNNConversion", config: {} };
    } else if (state.passes.conversionFormat === "tensorrt") {
      passes.conversion = { type: "TensorRTConversion", config: {} };
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
    } else if (
      state.passes.quantMethod === "hqq" &&
      (state.ihvProvider === "CPUExecutionProvider" || state.ihvProvider === "CUDAExecutionProvider")
    ) {
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
    } else if (
      state.passes.quantMethod === "rtn" &&
      (state.ihvProvider === "CPUExecutionProvider" || state.ihvProvider === "CUDAExecutionProvider")
    ) {
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
      const spinConfig: Record<string, unknown> = { rotate_mode: "hadamard" };
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
      const quarotConfig: Record<string, unknown> = { rotate_mode: "hadamard" };
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
    } else if (
      state.passes.conversionFormat === "openvino" ||
      state.ihvProvider === "OpenVINOExecutionProvider"
    ) {
      const ovQuantConfig: Record<string, unknown> = {};
      if (state.hfDataset) {
        ovQuantConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        ovQuantConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: state.passes.quantPrecision === "int4" ? "OpenVINOWeightCompression" : "OpenVINOQuantization",
        config: ovQuantConfig,
      };
    } else if (state.passes.conversionFormat === "qnn" || state.ihvProvider === "QNNExecutionProvider") {
      const qnnQuantConfig: Record<string, unknown> = {};
      if (state.hfDataset) {
        qnnQuantConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        qnnQuantConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: "QNNQuantization",
        config: qnnQuantConfig,
      };
    } else if (
      state.passes.conversionFormat === "tensorrt" ||
      state.ihvProvider === "TensorrtExecutionProvider"
    ) {
      const trtQuantConfig: Record<string, unknown> = {};
      if (state.hfDataset) {
        trtQuantConfig.data_config = { data_dir: state.hfDataset, batch_size: 1 };
      }
      if (state.userScript) {
        trtQuantConfig.user_script = state.userScript;
      }
      passes.quantization = {
        type: state.passes.quantPrecision === "int4" ? "Nvfp4Quantizer" : "OnnxQuantization",
        config: trtQuantConfig,
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

  // ONNX graph passes cannot follow a torch-native quantizer without an ONNX conversion.
  if (state.passes.onnxTransforms && (!torchQuantActive || state.passes.conversion)) {
    if (state.passes.conversionFormat === "openvino" || state.ihvProvider === "OpenVINOExecutionProvider") {
      passes.transformer_opt = {
        type: "OpenVINOIoUpdate",
        config: {},
      };
    } else if (state.passes.conversionFormat === "qnn" || state.ihvProvider === "QNNExecutionProvider") {
      passes.transformer_opt = {
        type: "QNNPreprocess",
        config: {},
      };
    } else if (
      state.passes.conversionFormat === "tensorrt" ||
      state.ihvProvider === "TensorrtExecutionProvider"
    ) {
      passes.transformer_opt = {
        type: "NVModelOptGraphSurgery",
        config: { surgeries: ["replace-gqa"] },
      };
    } else {
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
  }

  if (state.passes.splitting && (!torchQuantActive || state.passes.conversion)) {
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
    const sparsityKey = pType === "Prune" ? "target_sparsity" : "sparsity_ratio";
    const config: Record<string, unknown> = {
      [sparsityKey]: state.passes.pruningSparsity,
      // Preserve legacy key for older recipe-hub round-trip until hub reads the new keys.
      sparsity: state.passes.pruningSparsity,
      pruning_criteria: state.passes.pruningCriteria,
    };

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

  // Order: Convert → Optimize → Quantize (ONNX path), then MCP pass overrides
  recipe.passes = finalizePasses(passes, state.passRecipeOverrides, torchQuantActive);

  return recipe;
}
