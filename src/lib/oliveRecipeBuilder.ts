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
const NPU_PROVIDERS: IHVProvider[] = [
  "QNNExecutionProvider",
  "CoreMLExecutionProvider",
  "NNAPIExecutionProvider",
  "VitisAIExecutionProvider",
  "SNPEExecutionProvider",
];

/**
 * Ordered task-inference rules — first match wins. Order is significant
 * (embedding models must match before the generic `bert` substring), and
 * every rule is pinned by the inferHfTask test suite.
 */
const HF_TASK_RULES: ReadonlyArray<{ pattern: RegExp; task: string }> = [
  // Transformers pipeline / Olive HfModel expect this exact task id (not "speech-recognition").
  { pattern: /whisper/, task: "automatic-speech-recognition" },
  { pattern: /gte-|bge-|e5-|embedding|sentence-transformers/, task: "feature-extraction" },
  { pattern: /bert|roberta|deberta/, task: "fill-mask" },
  { pattern: /t5|bart/, task: "text2text-generation" },
  { pattern: /vit|clip|resnet|mobilenet/, task: "image-classification" },
];

/**
 * Infers the Hugging Face task associated with a model identifier.
 *
 * @param modelId - The Hugging Face model identifier to classify
 * @returns The corresponding Hugging Face task name
 */
export function inferHfTask(modelId: string): string {
  const id = modelId.toLowerCase();
  for (const rule of HF_TASK_RULES) {
    if (rule.pattern.test(id)) return rule.task;
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
 * Ordered model-type rules — first match wins (e.g. "codellama" → llama,
 * "mixtral" → mistral). Behavior pinned by the inferModelType test suite.
 */
const MODEL_TYPE_RULES: ReadonlyArray<{ pattern: RegExp; modelType: string }> = [
  { pattern: /llama/, modelType: "llama" },
  { pattern: /phi/, modelType: "phi" },
  { pattern: /whisper/, modelType: "whisper" },
  { pattern: /bert|roberta/, modelType: "bert" },
  { pattern: /qwen/, modelType: "qwen" },
  { pattern: /mistral|mixtral/, modelType: "mistral" },
  { pattern: /falcon/, modelType: "falcon" },
  { pattern: /t5/, modelType: "t5" },
  { pattern: /gpt2|gpt-2/, modelType: "gpt2" },
];

/**
 * Infers the model type from a model identifier.
 *
 * @returns The recognized model type, or `gpt2` when no supported type is identified.
 */
export function inferModelType(modelId: string): string {
  const id = modelId.toLowerCase();
  for (const rule of MODEL_TYPE_RULES) {
    if (rule.pattern.test(id)) return rule.modelType;
  }
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
    return [
      "peft", "pruning", "quantization", "conversion", "transformer_opt",
      "mobius_builder", "quantize_embedding_int8", "share_embedding_lm_head",
      "simplified_layer_norm_to_rms_norm", "float16", "splitting",
      "qairt_pipeline", "onnx_discrepancy_check",
    ];
  }
  return [
    "peft", "pruning", "conversion", "transformer_opt", "quantization",
    "mobius_builder", "quantize_embedding_int8", "share_embedding_lm_head",
    "simplified_layer_norm_to_rms_norm", "float16", "splitting",
    "qairt_pipeline", "onnx_discrepancy_check",
  ];
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

// ─── Per-pass builders ────────────────────────────────────────────────

/** A single Olive pass as written into recipe.passes[<key>]. */
type PassSpec = { type: string; config: Record<string, unknown> };

type ConversionFormat = UIState["passes"]["conversionFormat"];
type QuantMethod = UIState["passes"]["quantMethod"];
type PruningMethod = UIState["passes"]["pruningMethod"];

/** Effective pipeline family derived from conversion format + provider (first match wins). */
type FormatFamily = "openvino" | "qnn" | "tensorrt" | "onnx";

/** Shared per-recipe values computed once in buildOliveRecipe. */
type RecipeBuildContext = {
  torchQuantActive: boolean;
  useMemoryOffload: boolean;
};

type PassBuilder = (state: UIState, ctx: RecipeBuildContext) => PassSpec | undefined;

type IntQuantPrecision = Extract<UIState["passes"]["quantPrecision"], "int4" | "int8">;

/** Builders that only distinguish int4 vs wider int quant collapse fp16 onto int8. */
function asIntQuantPrecision(precision: UIState["passes"]["quantPrecision"]): IntQuantPrecision {
  return precision === "int4" ? "int4" : "int8";
}

const INT_QUANT_SPECS = {
  int4: {
    bits: 4,
    precision: "int4",
    openVinoPassType: "OpenVINOWeightCompression",
    tensorRtPassType: "Nvfp4Quantizer",
  },
  int8: {
    bits: 8,
    precision: "int8",
    openVinoPassType: "OpenVINOQuantization",
    tensorRtPassType: "OnnxQuantization",
  },
} as const satisfies Record<
  IntQuantPrecision,
  {
    bits: 4 | 8;
    precision: IntQuantPrecision;
    openVinoPassType: string;
    tensorRtPassType: string;
  }
>;

function intQuantSpec(precision: UIState["passes"]["quantPrecision"]) {
  return INT_QUANT_SPECS[asIntQuantPrecision(precision)];
}

type QuantMethodBuilder = {
  gate?: (state: UIState) => boolean;
  build: (state: UIState) => PassSpec;
};

function effectiveFormatFamily(state: UIState): FormatFamily {
  if (state.passes.conversionFormat === "openvino" || state.ihvProvider === "OpenVINOExecutionProvider") {
    return "openvino";
  }
  if (state.passes.conversionFormat === "qnn" || state.ihvProvider === "QNNExecutionProvider") {
    return "qnn";
  }
  if (state.passes.conversionFormat === "tensorrt" || state.ihvProvider === "TensorrtExecutionProvider") {
    return "tensorrt";
  }
  // ROCM / DirectML / WebGPU (and other ONNX EPs) share the default ONNX quant path;
  // there is no EP-specific Olive quant pass for those providers.
  return "onnx";
}

const isCpuOrCuda = (state: UIState): boolean =>
  state.ihvProvider === "CPUExecutionProvider" || state.ihvProvider === "CUDAExecutionProvider";

/** Calibration datasets and custom scripts are shared by every quantization branch. */
function withCalibrationData(
  base: Record<string, unknown>,
  state: UIState,
): Record<string, unknown> {
  const config = { ...base };
  if (state.hfDataset) {
    config.data_config = { data_dir: state.hfDataset, batch_size: 1 };
  }
  if (state.userScript) {
    config.user_script = state.userScript;
  }
  return config;
}

// ─── Conversion ───────────────────────────────────────────────────────

function buildOpenVinoConversion(_state: UIState): PassSpec {
  return { type: "OpenVINOConversion", config: {} };
}

function buildOnnxConversion(state: UIState): PassSpec {
  return {
    type: "OnnxConversion",
    config: {
      target_opset: state.passes.conversionOpset,
      input_model_dtype: state.passes.conversionInputTargetTypes,
      source_format: state.passes.conversionSourceFormat,
    },
  };
}

const CONVERSION_BUILDERS: Record<ConversionFormat, (state: UIState) => PassSpec> = {
  onnx: buildOnnxConversion,
  qnn: () => ({ type: "QNNConversion", config: {} }),
  tensorrt: () => ({ type: "TensorRTConversion", config: {} }),
  openvino: buildOpenVinoConversion,
};

function buildConversionPass(state: UIState): PassSpec | undefined {
  // Alternative builders consume Torch/HF input directly, not ONNX output.
  if (!state.passes.conversion || state.passes.mobiusBuilder || state.passes.qairtPipeline) return undefined;
  return CONVERSION_BUILDERS[state.passes.conversionFormat](state);
}

// ─── Quantization ─────────────────────────────────────────────────────

function buildAwqQuantizer(state: UIState): PassSpec {
  const quant = intQuantSpec(state.passes.quantPrecision);
  return {
    type: "AutoAWQQuantizer",
    config: withCalibrationData(
      {
        bits: quant.bits,
        input_model_dtype: state.passes.conversionInputTargetTypes || "fp16",
        group_size: state.passes.awqGroupSize,
        damp_percent: state.passes.awqDampPercent,
        sym: state.passes.awqSym,
      },
      state,
    ),
  };
}

function buildGptqQuantizer(state: UIState): PassSpec {
  const quant = intQuantSpec(state.passes.quantPrecision);
  return {
    type: "GptqQuantizer",
    config: withCalibrationData(
      {
        bits: quant.bits,
        input_model_dtype: state.passes.conversionInputTargetTypes || "fp16",
        block_size: state.passes.gptqBlockSize,
        group_size: state.passes.gptqGroupSize,
        desc_act: state.passes.gptqDescAct,
      },
      state,
    ),
  };
}

function buildQatQuantizer(state: UIState): PassSpec {
  return {
    type: "QATQuantizer",
    config: withCalibrationData(
      {
        precision: state.passes.qatQuantPrecision,
        calibrate_method: state.passes.qatCalibrateMethod,
        calibrate_steps: state.passes.qatCalibrateSteps,
      },
      state,
    ),
  };
}

// Docs: https://microsoft.github.io/Olive/0.13.0/reference/options.html -> OnnxHqqQuantization
function buildHqqQuantizer(state: UIState): PassSpec {
  const quant = intQuantSpec(state.passes.quantPrecision);
  return {
    type: "OnnxHqqQuantization",
    config: withCalibrationData(
      { precision: quant.precision },
      state,
    ),
  };
}

// Docs: https://microsoft.github.io/Olive/0.13.0/reference/options.html -> OnnxBlockWiseRtnQuantization
function buildRtnQuantizer(state: UIState): PassSpec {
  const quant = intQuantSpec(state.passes.quantPrecision);
  return {
    type: "OnnxBlockWiseRtnQuantization",
    config: withCalibrationData(
      {
        bits: quant.bits,
        block_size: 128,
        is_symmetric: true,
      },
      state,
    ),
  };
}

function buildSpinQuantQuantizer(state: UIState): PassSpec {
  return {
    type: "SpinQuant",
    config: withCalibrationData({ rotate_mode: "hadamard" }, state),
  };
}

function buildQuaRotQuantizer(state: UIState): PassSpec {
  return {
    type: "QuaRot",
    config: withCalibrationData({ rotate_mode: "hadamard" }, state),
  };
}

/**
 * ggml-style K-Quant: dispatches to PyTorch KQuant or OnnxKquantQuantization
 * depending on whether ONNX conversion is active (ONNX input available).
 */
function buildKquantQuantizer(state: UIState): PassSpec {
  const bits = state.passes.quantPrecision === "int4" ? 4 : 8;
  const passType = state.passes.conversion ? "OnnxKquantQuantization" : "KQuant";
  return {
    type: passType,
    config: withCalibrationData(
      {
        bits,
        symmetric: true,
        group_size: 128,
      },
      state,
    ),
  };
}

/**
 * First-match-wins quant dispatch: PyTorch-native method builders first,
 * then provider/format-family builders (hqq/rtn fall through when their
 * provider gate fails, exactly as the original branch chain did).
 */
const QUANT_METHOD_BUILDERS: Partial<Record<QuantMethod, QuantMethodBuilder>> = {
  awq: { build: buildAwqQuantizer },
  gptq: { build: buildGptqQuantizer },
  qat: { build: buildQatQuantizer },
  hqq: { gate: isCpuOrCuda, build: buildHqqQuantizer },
  rtn: { gate: isCpuOrCuda, build: buildRtnQuantizer },
  kquant: { gate: isCpuOrCuda, build: buildKquantQuantizer },
  spinquant: { build: buildSpinQuantQuantizer },
  quarot: { build: buildQuaRotQuantizer },
};

function buildOpenVinoQuantization(state: UIState): PassSpec {
  return {
    type: intQuantSpec(state.passes.quantPrecision).openVinoPassType,
    config: withCalibrationData({}, state),
  };
}

function buildQnnQuantization(state: UIState): PassSpec {
  return { type: "QNNQuantization", config: withCalibrationData({}, state) };
}

function buildTensorRtQuantization(state: UIState): PassSpec {
  return {
    type: intQuantSpec(state.passes.quantPrecision).tensorRtPassType,
    config: withCalibrationData({}, state),
  };
}

function buildDefaultOnnxQuantization(state: UIState): PassSpec {
  return {
    type: "OnnxQuantization",
    config: withCalibrationData(
      {
        quant_mode: "static",
        precision: state.passes.quantPrecision,
        quant_preprocess: true,
      },
      state,
    ),
  };
}

const FORMAT_QUANT_BUILDERS: Record<FormatFamily, (state: UIState) => PassSpec> = {
  openvino: buildOpenVinoQuantization,
  qnn: buildQnnQuantization,
  tensorrt: buildTensorRtQuantization,
  onnx: buildDefaultOnnxQuantization,
};

function buildQuantizationPass(state: UIState): PassSpec | undefined {
  if (!state.passes.quantization) return undefined;
  const methodBuilder = QUANT_METHOD_BUILDERS[state.passes.quantMethod];
  if (methodBuilder && (!methodBuilder.gate || methodBuilder.gate(state))) {
    return methodBuilder.build(state);
  }
  return FORMAT_QUANT_BUILDERS[effectiveFormatFamily(state)](state);
}

// ─── Transformer optimization ─────────────────────────────────────────

function buildOrtTransformersOptimization(state: UIState): PassSpec {
  const config: Record<string, unknown> = {
    model_type: inferModelType(state.hfModelId || ""),
    use_gpu: GPU_PROVIDERS.includes(state.ihvProvider),
  };
  if (state.userScript) {
    config.user_script = state.userScript;
  }
  return { type: "OrtTransformersOptimization", config };
}

const FORMAT_TRANSFORM_BUILDERS: Record<FormatFamily, (state: UIState) => PassSpec> = {
  openvino: () => ({ type: "OpenVINOIoUpdate", config: {} }),
  qnn: () => ({ type: "QNNPreprocess", config: {} }),
  tensorrt: () => ({ type: "NVModelOptGraphSurgery", config: { surgeries: ["replace-gqa"] } }),
  onnx: buildOrtTransformersOptimization,
};

// ONNX graph passes cannot follow a torch-native quantizer without an ONNX conversion.
function buildTransformerOptPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.onnxTransforms || (ctx.torchQuantActive && !state.passes.conversion)) {
    return undefined;
  }
  return FORMAT_TRANSFORM_BUILDERS[effectiveFormatFamily(state)](state);
}

// ─── Splitting ────────────────────────────────────────────────────────

function buildSplittingPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.splitting || (ctx.torchQuantActive && !state.passes.conversion)) {
    return undefined;
  }
  return { type: "SplitModel", config: {} };
}

// ─── PEFT ─────────────────────────────────────────────────────────────

function buildPeftPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.peft) return undefined;
  const peftType = state.passes.peftMethod === "qlora" ? "QLoRA" : "LoRA";
  const config: Record<string, unknown> = { r: 8, alpha: 16 };
  if (state.passes.diffusionLora) {
    config.diffusion_lora = true;
  }
  if (ctx.useMemoryOffload) {
    Object.assign(config, buildPeftOffloadConfig());
  }
  return { type: peftType, config };
}

// ─── Pruning ──────────────────────────────────────────────────────────

const PRUNING_TYPE_BY_METHOD: Record<PruningMethod, string> = {
  magnitude: "Prune",
  sparsegpt: "SparseGPT",
  wanda: "Wanda",
};

function buildPruningPass(state: UIState): PassSpec | undefined {
  if (!state.passes.pruning) return undefined;
  const passType = PRUNING_TYPE_BY_METHOD[state.passes.pruningMethod] ?? "Prune";
  const sparsityKey = passType === "Prune" ? "target_sparsity" : "sparsity_ratio";
  const config: Record<string, unknown> = {
    [sparsityKey]: state.passes.pruningSparsity,
    // Preserve legacy key for older recipe-hub round-trip until hub reads the new keys.
    sparsity: state.passes.pruningSparsity,
    pruning_criteria: state.passes.pruningCriteria,
  };
  if (state.userScript) {
    config.user_script = state.userScript;
  }
  return { type: passType, config };
}

// ─── Pass registry ────────────────────────────────────────────────────

// ─── 0.13.0 New Passes ────────────────────────────────────────────────

/** MobiusBuilder: ONNX export via Mobius; produces ORT GenAI composite packages. */
function buildMobiusBuilder(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.mobiusBuilder) return undefined;
  return {
    type: "MobiusBuilder",
    config: {
      model_name: _state.hfModelId || "unspecified",
      cache_model: true,
    },
  };
}

/** QairtPipeline: Single-pass QAIRT LLM pipeline (QNN-only). */
function buildQairtPipeline(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.qairtPipeline) return undefined;
  return {
    type: "QairtPipeline",
    config: {},
  };
}

/** QuantizeEmbeddingInt8: Graph surgery for INT8 embedding quantization. */
function buildQuantizeEmbeddingInt8(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.quantizeEmbeddingInt8) return undefined;
  return { type: "QuantizeEmbeddingInt8", config: {} };
}

/** ShareEmbeddingLmHead: Graph surgery to share embedding/LM-head weights. */
function buildShareEmbeddingLmHead(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.shareEmbeddingLmHead) return undefined;
  return { type: "ShareEmbeddingLmHead", config: {} };
}

/** SimplifiedLayerNormToRMSNorm: Graph surgery converting SimplifiedLayerNorm to RMSNorm. */
function buildSimplifiedLayerNormToRMSNorm(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.simplifiedLayerNormToRMSNorm) return undefined;
  return { type: "SimplifiedLayerNormToRMSNorm", config: {} };
}

/** OnnxDiscrepancyCheck: Validation pass measuring numerical discrepancies. */
function buildOnnxDiscrepancyCheck(_state: UIState, _ctx: RecipeBuildContext): PassSpec | undefined {
  if (!_state.passes.onnxDiscrepancyCheck) return undefined;
  const config: Record<string, unknown> = {};
  // Test data is a directory; calibration/evaluation scripts are unrelated.
  return { type: "OnnxDiscrepancyCheck", config };
}

// ─── Pass builder registry ────────────────────────────────────────────

/**
 * Per-pass builder registry. buildOliveRecipe invokes every builder with the
 * shared context; a builder returns undefined when its pass is inactive.
 * Registering a new pass type is a single entry in this object.
 */
const PASS_BUILDERS = {
  conversion: buildConversionPass,
  transformer_opt: buildTransformerOptPass,
  quantization: buildQuantizationPass,
  splitting: buildSplittingPass,
  peft: buildPeftPass,
  pruning: buildPruningPass,
  mobius_builder: buildMobiusBuilder,
  qairt_pipeline: buildQairtPipeline,
  quantize_embedding_int8: buildQuantizeEmbeddingInt8,
  share_embedding_lm_head: buildShareEmbeddingLmHead,
  simplified_layer_norm_to_rms_norm: buildSimplifiedLayerNormToRMSNorm,
  onnx_discrepancy_check: buildOnnxDiscrepancyCheck,
} satisfies Record<string, PassBuilder>;

type PassKey = keyof typeof PASS_BUILDERS;

/**
 * Reference-equality memo: UIState objects are immutable (each store commit
 * creates a fresh object), so the sanitize loop, buildRecipeFromState, and the
 * panels that all validate the same commit would otherwise rebuild the recipe
 * many times over. Callers must treat the returned recipe as read-only.
 */
let memoState: UIState | undefined;
let memoRecipe: Record<string, unknown> | undefined;

/**
 * Builds an Olive optimization recipe from the configured model, execution provider, passes, and evaluation settings.
 *
 * @param state - The UI configuration used to construct the recipe
 * @returns The configured Olive recipe
 */
export function buildOliveRecipe(state: UIState): Record<string, unknown> {
  if (state === memoState && memoRecipe) return memoRecipe;
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
    // Olive 0.13.0 flipped trust_remote_code default to false; emit explicitly
    // so HF models requiring custom code (Phi, Mistral, etc.) still load.
    if (state.passes.trustRemoteCode !== false) {
      inputConfig.trust_remote_code = true;
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

  const ctx: RecipeBuildContext = { torchQuantActive, useMemoryOffload };
  for (const passKey of Object.keys(PASS_BUILDERS) as PassKey[]) {
    const pass = PASS_BUILDERS[passKey](state, ctx);
    if (pass) passes[passKey] = pass;
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

  memoState = state;
  memoRecipe = recipe;
  return recipe;
}
