/**
 * Olive 0.13.0 Official Pass Catalog
 *
 * Compiled from the pass reference page:
 * https://microsoft.github.io/Olive/0.13.0/reference/pass.html
 *
 * `olive run-pass --list-passes` prints all names available at runtime.
 * Keep this list in sync with the 0.13.0 docs.
 */

/** Centralized Olive version — update this when upgrading the supported Olive release. */
export const OLIVE_VERSION = "0.13.0";

export type PassCategory =
  "onnx" | "pytorch" | "intel" | "nvidia" | "openvino" | "qnn" | "pruning" | "peft" | "splitting" | "validation" | "other";

export interface PassCatalogEntry {
  /** Exact pass type name used in recipe JSON (`type` field) */
  name: string;
  category: PassCategory;
  description: string;
  /** Input model handler types */
  inputs: string[];
  /** Output model handler types */
  outputs: string[];
}

/**
 * All Olive 0.13.0 passes extracted from the official pass reference page.
 *
 * The reference page is organised by category (ONNX, PyTorch, Intel, NVIDIA,
 * OpenVINO, etc).  Passes under each category are listed in the order they
 * appear in the docs.
 */
export const PASS_CATALOG: PassCatalogEntry[] = [
  // ── ONNX passes (from docs) ──────────────────────────────────
  {
    name: "OnnxConversion",
    category: "onnx",
    description: "Convert a PyTorch model to ONNX model using torch.onnx.export on CPU.",
    inputs: [
      "handler.hf.DistributedHfModelHandler",
      "handler.hf.HfModelHandler",
      "handler.pytorch.PyTorchModelHandler",
    ],
    outputs: ["handler.onnx.DistributedOnnxModelHandler", "handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxOpVersionConversion",
    category: "onnx",
    description: "Convert ONNX model opset version to a target version.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxScriptFusion",
    category: "onnx",
    description: "Fuse Ops using onnxscript.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxPeepholeOptimizer",
    category: "onnx",
    description: "Optimize ONNX model by fusing nodes with onnxscript and onnxoptimizer.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OrtTransformersOptimization",
    category: "onnx",
    description: "Use ONNX Transformer Optimizer to optimize transformer based models.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxModelOptimizer",
    category: "onnx",
    description: "General ONNX graph optimization (constant folding, dead code elimination).",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OrtSessionParamsTuning",
    category: "onnx",
    description: "Optimize ONNX Runtime inference settings.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxFloatToFloat16",
    category: "onnx",
    description: "Converts a model to float16 using onnxruntime float16 converter.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxIODataTypeConverter",
    category: "onnx",
    description:
      "Converts model inputs/outputs from a source dtype to a target dtype based on a name pattern.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OrtMixedPrecision",
    category: "onnx",
    description: "Convert model to mixed precision.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxQuantizationPreprocess",
    category: "onnx",
    description: "ONNX Quantization Preprocess Pass. Same as OnnxQuantization quant_preprocess.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "MixedPrecisionOverrides",
    category: "onnx",
    description: "QNN mixed precision overrides pass. Pre-processes model for mixed precision quantization.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxDynamicQuantization",
    category: "onnx",
    description: "ONNX Dynamic Quantization Pass.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxStaticQuantization",
    category: "onnx",
    description: "ONNX Static Quantization Pass.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxQuantization",
    category: "onnx",
    description: "Quantize ONNX model with static/dynamic quantization techniques.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxBlockWiseRtnQuantization",
    category: "onnx",
    description: "Quantize ONNX models with weight-only block-wise RTN algorithm.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxKquantQuantization",
    category: "onnx",
    description: "K-quant quantization for ONNX models using ggml-style block quantization.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "QNNPreprocess",
    category: "qnn",
    description: "Preprocess ONNX model for quantization targeting QNN Execution Provider.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Per-algorithm PyTorch quantisation passes (from docs) ──
  {
    name: "AutoAWQQuantizer",
    category: "pytorch",
    description: "AWQ (Activation-aware Weight Quantization) for PyTorch models.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "GptqQuantizer",
    category: "pytorch",
    description: "GPTQ quantization pass on PyTorch model.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "QATQuantizer",
    category: "pytorch",
    description: "Quantization-Aware Training pass — fine-tunes with fake-quant nodes.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "Nvfp4Quantizer",
    category: "pytorch",
    description: "NVIDIA FP4 quantization using blocked scale formats (E4M3 / E2M1).",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "QuaRot",
    category: "pytorch",
    description:
      "Rotate model weights using Hadamard transforms to reduce outliers before quantization. HuggingFace PyTorch models only.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "SpinQuant",
    category: "pytorch",
    description:
      "Learns orthogonal rotation matrices on calibration data to eliminate outliers. HuggingFace PyTorch models only.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "NVModelOptQuantization",
    category: "nvidia",
    description:
      "NVIDIA TensorRT Model Optimizer quantization — supports AWQ and RTN algorithms with mixed precision.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── ONNX quantization passes (weight-only / block-wise) ────
  {
    name: "OnnxHqqQuantization",
    category: "onnx",
    description: "Half-Quadratic Quantization for ONNX MatMul weight-only 4-bit compression.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Intel Neural Compressor passes ──────────────────────────
  {
    name: "IncQuantization",
    category: "intel",
    description:
      "Intel Neural Compressor quantization — supports dynamic/static modes with algorithm config (GPTQ, etc).",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "IncDynamicQuantization",
    category: "intel",
    description: "Intel Neural Compressor dynamic quantization pass.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "IncStaticQuantization",
    category: "intel",
    description: "Intel Neural Compressor static quantization pass.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "IncPruning",
    category: "intel",
    description: "Intel Neural Compressor magnitude/structured pruning.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "IncSparsityFineTuning",
    category: "intel",
    description: "Fine-tune after Intel Neural Compressor pruning.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "IncDistillation",
    category: "intel",
    description: "Knowledge distillation using Intel Neural Compressor.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── Qualcomm AIMET ──────────────────────────────────────────
  {
    name: "AimetQuantization",
    category: "qnn",
    description: "Qualcomm AIMET quantization — supports LPBQ, SeqMSE, AdaRound techniques.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "VitisAIQuantization",
    category: "other",
    description: "Xilinx Vitis AI quantization with power-of-2 scales.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "AzureMLQuantization",
    category: "other",
    description: "Quantization pass running on Azure ML compute.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Pruning / sparsity passes ───────────────────────────────
  {
    name: "SparseGPT",
    category: "pruning",
    description: "One-shot pruning using SparseGPT algorithm for LLMs.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "Wanda",
    category: "pruning",
    description: "Weight-aware pruning (Wanda) — prunes by weight × activation magnitude.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "Prune",
    category: "pruning",
    description:
      "Magnitude-based weight pruning pass — supports L1 norm (sparser, blockier distributions) and L2 norm (smoother magnitude preservation) criteria for weight ranking.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "SparsityFineTuning",
    category: "pruning",
    description: "General sparsity fine-tuning pass.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── PEFT passes ─────────────────────────────────────────────
  {
    name: "LoRA",
    category: "peft",
    description: "Low-Rank Adaptation — trains small adapter matrices on frozen base weights.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "QLoRA",
    category: "peft",
    description: "Quantized Low-Rank Adaptation — LoRA on 4-bit quantized base model.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },

  // ── Model splitting ──────────────────────────────────────────
  {
    name: "SplitModel",
    category: "splitting",
    description: "Split an ONNX model into multiple smaller sub-models based on predefined assignments.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "CaptureSplitInfo",
    category: "splitting",
    description: "Capture cost model information for model splitting decisions.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Conversion passes (non-ONNX) ─────────────────────────────
  {
    name: "OpenVINOConversion",
    category: "openvino",
    description: "Convert a PyTorch model to OpenVINO IR format.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },
  {
    name: "OpenVINOIoUpdate",
    category: "openvino",
    description: "Convert dynamic OpenVINO model to static and update IO names.",
    inputs: ["handler.openvino.OpenVINOModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },
  {
    name: "OpenVINOQuantization",
    category: "openvino",
    description: "Post-training quantization for OpenVINO and ONNX models using Intel NNCF.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },
  {
    name: "OpenVINOQuantizationWithAccuracy",
    category: "openvino",
    description: "Post-training quantization with accuracy awareness for OpenVINO using Intel NNCF.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },
  {
    name: "OpenVINOWeightCompression",
    category: "openvino",
    description: "Weight compression for HuggingFace/ONNX models to OpenVINO using Intel NNCF.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },
  {
    name: "OpenVINOEncapsulation",
    category: "openvino",
    description: "Generates an ONNX model that encapsulates an OpenVINO IR model.",
    inputs: ["handler.openvino.OpenVINOModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OpenVINOOptimumConversion",
    category: "openvino",
    description: "Convert HuggingFace model to OpenVINO via Optimum Intel, with optional weight compression.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.openvino.OpenVINOModelHandler"],
  },

  // ── QNN passes ──────────────────────────────────────────────
  {
    name: "QNNConversion",
    category: "qnn",
    description: "Convert ONNX/TensorFlow/PyTorch model to QNN C++ model using qnn-framework-converter.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.qnn.QNNModelHandler"],
  },
  {
    name: "QNNModelLibGenerator",
    category: "qnn",
    description: "Compile QNN C++ model source into QNN model library for a target.",
    inputs: ["handler.qnn.QNNModelHandler"],
    outputs: ["handler.qnn.QNNModelHandler"],
  },
  {
    name: "QNNContextBinaryGenerator",
    category: "qnn",
    description: "Generate QNN context binary from model library for a specific target.",
    inputs: ["handler.qnn.QNNModelHandler"],
    outputs: ["handler.qnn.QNNModelHandler"],
  },
  {
    name: "QNNQuantization",
    category: "qnn",
    description: "Quantize for Qualcomm QNN execution provider.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "QairtPipeline",
    category: "qnn",
    description:
      "Single-pass QAIRT LLM pipeline: YAML-recipe-driven model loading, quantization, and compilation for QNN targets.",
    inputs: ["handler.pytorch.PyTorchModelHandler", "handler.hf.HfModelHandler"],
    outputs: ["handler.qnn.QNNModelHandler"],
  },
  {
    name: "SNPEConversion",
    category: "qnn",
    description: "Convert to Qualcomm SNPE DLC format.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.snpe.SNPEModelHandler"],
  },

  // ── Additional PEFT passes ──────────────────────────────────
  {
    name: "LoftQ",
    category: "peft",
    description: "LoftQ fine-tuning — quantizes and finds proper low-rank initialization simultaneously.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "LoHa",
    category: "peft",
    description: "Run LoHa fine-tuning on a HuggingFace PyTorch model.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "LoKr",
    category: "peft",
    description: "Run LoKr fine-tuning on a HuggingFace PyTorch model.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "DoRA",
    category: "peft",
    description: "Run DoRA (Weight-Decomposed Low-Rank Adaptation) fine-tuning.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "MergeAdapterWeights",
    category: "peft",
    description: "Merge LoRA adapter weights into the base model and save transformer context files.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.hf.HfModelHandler"],
  },
  {
    name: "MultiLoRA",
    category: "peft",
    description: "Multiple LoRA adapters for ONNX Runtime (experimental).",
    inputs: ["handler.pytorch.PyTorchModelHandler", "handler.hf.HfModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "ExtractLoRA",
    category: "peft",
    description: "Extract LoRA weights to separate adapter files.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "GenerateAdapterWeights",
    category: "peft",
    description: "Generate adapter weight files for serving.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "FinetuningPass",
    category: "peft",
    description: "General PyTorch fine-tuning pass.",
    inputs: ["handler.pytorch.PyTorchModelHandler", "handler.hf.HfModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "HuggingFaceFineTuning",
    category: "peft",
    description: "Hugging Face Trainer integration for fine-tuning.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── Graph surgeries ─────────────────────────────────────────
  {
    name: "GraphSurgeries",
    category: "onnx",
    description: "Apply ONNX graph surgeries (RenameInputs, RemoveQDQ, ReplaceErfWithTanh, etc).",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "QuantizeEmbeddingInt8",
    category: "onnx",
    description:
      "Graph surgery for INT8 embedding quantization. Reduces embedding table memory by quantizing to int8.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "ShareEmbeddingLmHead",
    category: "onnx",
    description:
      "Graph surgery to share embedding and LM-head weights, reducing model size for language models with tied embeddings.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "SimplifiedLayerNormToRMSNorm",
    category: "onnx",
    description:
      "Graph surgery converting SimplifiedLayerNorm nodes to RMSNorm for improved QNN compatibility and performance.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "NVModelOptGraphSurgery",
    category: "nvidia",
    description: "NVIDIA ModelOpt graph surgeries — replace-gqa, transpose-dq, add-cross-kv, convert-bf16.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Adapter extraction ──────────────────────────────────────
  {
    name: "ExtractAdapters",
    category: "onnx",
    description: "Extract adapters from ONNX model.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Model builder & conversion ──────────────────────────────
  {
    name: "ModelBuilder",
    category: "onnx",
    description: "Convert generative PyTorch model to ONNX using ONNX Runtime GenAI module.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "MobiusBuilder",
    category: "onnx",
    description: "ONNX export via Mobius; produces loadable ORT GenAI composite packages with caching.",
    inputs: ["handler.pytorch.PyTorchModelHandler", "handler.hf.HfModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "MatMulNBitsToQDQ",
    category: "onnx",
    description: "Convert ONNX MatMulNBits nodes to standard QDQ (QuantizeLinear/DequantizeLinear) format.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "DynamicToFixedShape",
    category: "onnx",
    description: "Convert dynamic ONNX model shapes to fixed shapes.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "SelectiveMixedPrecision",
    category: "onnx",
    description: "Annotate the ONNX model with mixed precision information.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OptimumConversion",
    category: "onnx",
    description: "Convert HuggingFace models to ONNX via the Optimum library.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OptimumMerging",
    category: "onnx",
    description: "Merge 2 models together with an if node via the Optimum library.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Additional compression ──────────────────────────────────
  {
    name: "SliceGPT",
    category: "pruning",
    description:
      "Post-training sparsification via orthogonal transformations — reduces model size by slicing rows/columns.",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "Gptq",
    category: "pytorch",
    description: "Run GPTQ quantization on a HuggingFace PyTorch model (high-level wrapper).",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "Rtn",
    category: "pytorch",
    description: "Run RTN quantization on a HuggingFace PyTorch model (high-level wrapper).",
    inputs: ["handler.hf.HfModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },
  {
    name: "KQuant",
    category: "pytorch",
    description:
      "ggml-style weight-only K-quant quantization (asymmetric/symmetric, 2/4/8-bit) for PyTorch models.",
    inputs: ["handler.hf.HfModelHandler", "handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── Performance tuning ──────────────────────────────────────
  {
    name: "OrtPerfTuning",
    category: "onnx",
    description: "ONNX Runtime performance tuning for execution provider settings.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "BatchSizeOptimization",
    category: "onnx",
    description: "Search for optimal batch size.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OnnxGraphCapture",
    category: "onnx",
    description: "Capture ONNX computation graph for analysis.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "ModelOptOptimizer",
    category: "nvidia",
    description: "NVIDIA Model Optimizer integration.",
    inputs: ["handler.pytorch.PyTorchModelHandler", "handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Optimum passes ──────────────────────────────────────────
  {
    name: "OptimumQuantization",
    category: "onnx",
    description: "Hugging Face Optimum quantization pass.",
    inputs: ["handler.hf.HfModelHandler", "handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
  {
    name: "OptimumGraphOptimization",
    category: "onnx",
    description: "Hugging Face Optimum ONNX graph optimizations.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },

  // ── Distillation passes ─────────────────────────────────────
  {
    name: "DistillationPass",
    category: "other",
    description: "General knowledge distillation pass.",
    inputs: ["handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.pytorch.PyTorchModelHandler"],
  },

  // ── Conversion passes (other) ───────────────────────────────
  {
    name: "TensorFlowConversion",
    category: "other",
    description: "Convert a model to TensorFlow SavedModel.",
    inputs: ["handler.onnx.ONNXModelHandler", "handler.pytorch.PyTorchModelHandler"],
    outputs: ["handler.tf.TFModelHandler"],
  },

  // ── Validation passes ───────────────────────────────────────
  {
    name: "OnnxDiscrepancyCheck",
    category: "validation",
    description:
      "Measures numerical discrepancies on a test model to validate conversions and optimizations. Does not modify the model.",
    inputs: ["handler.onnx.ONNXModelHandler"],
    outputs: ["handler.onnx.ONNXModelHandler"],
  },
];

/** String set of every known pass name — O(1) lookup. */
const KNOWN_PASS_NAMES: ReadonlySet<string> = new Set(PASS_CATALOG.map((p) => p.name));

/** Check if a pass type name is in the official 0.13.0 catalog. */
export function isKnownPassName(name: string): boolean {
  return KNOWN_PASS_NAMES.has(name);
}

/** Get catalog entry for a pass type name, or undefined if unknown. */
export function getPassCatalogEntry(name: string): PassCatalogEntry | undefined {
  return PASS_CATALOG.find((p) => p.name === name);
}

/** All known pass names grouped by category. */
export function getPassesByCategory(): Record<PassCategory, PassCatalogEntry[]> {
  const byCategory: Record<string, PassCatalogEntry[]> = {};
  for (const entry of PASS_CATALOG) {
    const cat = entry.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(entry);
  }
  return byCategory as Record<PassCategory, PassCatalogEntry[]>;
}
