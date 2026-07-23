import type { UIState } from "@/types";

export interface PassGuidance {
  title: string;
  summary: string;
  whatItDoes: string;
  whenToUse: string[];
  whenNotToUse: string[];
}

const GUIDANCE: Record<string, PassGuidance> = {
  splitting: {
    title: "Model splitting",
    summary: "Splits a large model into sub-graphs for pipeline or multi-device execution.",
    whatItDoes:
      "Breaks the network into smaller ONNX subgraphs (e.g. encoder, decoder, KV blocks) so each piece can run on a device with less memory.",
    whenToUse: [
      "Very large LLMs that do not fit on a single GPU even with quantization.",
      "Pipeline parallelism across multiple GPUs or edge devices.",
      "Deploying only part of a model (e.g. UNet without text encoder).",
    ],
    whenNotToUse: [
      "Small models that already fit in VRAM — adds orchestration overhead.",
      "When you need a single fused artifact for simplest deployment.",
      "With QAT quantization (conflicts with splitting in this pipeline).",
    ],
  },
  peft: {
    title: "PEFT / LoRA",
    summary: "Fine-tune small adapter layers instead of full model weights.",
    whatItDoes:
      "Freezes the base model and trains low-rank adapters (LoRA) or quantized adapters (QLoRA) for task-specific behavior before export.",
    whenToUse: [
      "Adapting a foundation model to a domain or style with limited data.",
      "When full fine-tuning would need too much VRAM or time.",
      "CUDA or ROCm targets that support training kernels.",
    ],
    whenNotToUse: [
      "Snapdragon QNN or OpenVINO-only inference targets — no training on NPU.",
      "When you only need inference on a pre-trained model with no customization.",
      "If you only need compression, use quantization instead.",
    ],
  },
  conversion: {
    title: "Graph conversion",
    summary: "Converts PyTorch/TensorFlow weights into ONNX or OpenVINO IR.",
    whatItDoes:
      "Exports the model into a static runtime graph Olive and ONNX Runtime can optimize and execute on your target hardware.",
    whenToUse: [
      "Almost always — Olive expects an intermediate graph for GPU/NPU/CPU deployment.",
      "ONNX for NVIDIA CUDA, TensorRT, AMD ROCm, and broad CPU runtimes.",
      "OpenVINO IR when deploying exclusively on Intel OpenVINO.",
    ],
    whenNotToUse: [
      "OpenVINO IR on NVIDIA, Qualcomm, or generic CPU ONNX paths — use ONNX instead.",
      "Skipping conversion only if another pass already produced a compatible graph.",
    ],
  },
  pruning: {
    title: "Pruning / sparsity",
    summary: "Zeros low-importance weights to shrink and speed up the model.",
    whatItDoes:
      "Removes connections by magnitude, SparseGPT, or Wanda criteria. Structured 2:4 pruning aligns with NVIDIA Tensor Core sparse kernels.",
    whenToUse: [
      "Further compression after or instead of heavy quantization.",
      "NVIDIA Ampere+ GPUs when using structured 2:4 sparsity.",
      "Research or edge deployments where accuracy trade-offs are acceptable.",
    ],
    whenNotToUse: [
      "With AWQ quantization — pruning is disabled automatically (conflicts with calibration).",
      "When maximum accuracy is required and you cannot re-validate outputs.",
      "Structured sparsity on CPUs or non-NVIDIA GPUs — use unstructured or skip.",
    ],
  },
  transformer_opt: {
    title: "ONNX Runtime transforms",
    summary: "Fuses operators for faster inference on ORT backends.",
    whatItDoes:
      "Rewrites attention, LayerNorm, and GELU patterns into fused kernels ORT can execute efficiently on CPU or GPU.",
    whenToUse: [
      "ONNX output targeting CUDA, TensorRT, or CPU execution providers.",
      "Transformer/LLM architectures after conversion to ONNX.",
    ],
    whenNotToUse: [
      "OpenVINO IR output — graph is optimized by OpenVINO instead.",
      "When debugging raw ONNX op-by-op behavior.",
    ],
  },
  quantization: {
    title: "Quantization",
    summary: "Reduces weight precision to INT8/INT4 for smaller, faster models.",
    whatItDoes:
      "Compresses weights (and sometimes activations) so inference uses less memory and bandwidth. Method choice affects accuracy and hardware support.",
    whenToUse: [
      "Deploying LLMs on consumer GPUs with limited VRAM.",
      "Edge or mobile targets that require INT8/INT4 kernels.",
      "When slight accuracy loss is acceptable for large speed/size gains.",
    ],
    whenNotToUse: [
      "Tasks needing maximum numerical fidelity with no calibration data.",
      "AWQ together with pruning — pick one compression strategy.",
      "QAT on Snapdragon NPU — use PTQ for QNN instead.",
    ],
  },
  quantization_ptq: {
    title: "PTQ (post-training quantization)",
    summary: "Quantize after training using calibration data — fastest path.",
    whatItDoes:
      "Observes activations on a small calibration set and maps weights to INT8/INT4 without retraining.",
    whenToUse: [
      "Default choice for most deployment pipelines.",
      "CPU, OpenVINO, QNN, and broad GPU support.",
      "When you already have a trained model and representative sample inputs.",
    ],
    whenNotToUse: ["When PTQ accuracy drops too much and you can afford QAT retraining."],
  },
  quantization_awq: {
    title: "AWQ (activation-aware quantization)",
    summary: "Protects salient weights during INT4/INT8 compression.",
    whatItDoes:
      "Uses activation statistics to avoid quantizing the most important channels, often preserving LLM quality at INT4.",
    whenToUse: [
      "Large language models on NVIDIA CUDA, TensorRT, or AMD ROCm.",
      "Aggressive INT4 compression where plain PTQ loses too much quality.",
    ],
    whenNotToUse: [
      "CPU-only or QNN targets — not supported on those backends.",
      "Together with pruning — disable pruning or use PTQ instead.",
      "When calibration data does not represent real prompts/workloads.",
    ],
  },
  quantization_qat: {
    title: "QAT (quantization-aware training)",
    summary: "Simulates quantization during training for robust INT models.",
    whatItDoes:
      "Fine-tunes with fake-quant nodes in the graph so the model learns to tolerate low precision.",
    whenToUse: [
      "When PTQ accuracy is insufficient and you can retrain.",
      "CUDA/ROCm training pipelines with time for extra epochs.",
    ],
    whenNotToUse: [
      "Snapdragon QNN — use PTQ only.",
      "Quick one-shot export with no training budget.",
      "Combined with model splitting in this pipeline.",
    ],
  },
  input: {
    title: "Model input",
    summary: "Source weights Olive loads before any optimization pass.",
    whatItDoes:
      "Defines whether weights come from Hugging Face Hub, a local folder, or Azure ML, and sets the baseline dtype footprint.",
    whenToUse: [
      "Hugging Face for popular open models and Olive HF integrations.",
      "Local for custom checkpoints or air-gapped environments.",
    ],
    whenNotToUse: ["N/A — every recipe needs a model source."],
  },
  provider: {
    title: "Execution provider",
    summary: "Hardware backend ONNX Runtime uses at inference time.",
    whatItDoes:
      "Selects CUDA, TensorRT, CPU, OpenVINO, QNN, or ROCm so Olive aligns passes with what your silicon actually runs.",
    whenToUse: [
      "Match the machine you will deploy on (probe banner shows detected hardware).",
      "Pick TensorRT for max NVIDIA throughput; OpenVINO for Intel; QNN for Snapdragon.",
    ],
    whenNotToUse: [
      "OpenVINO IR conversion with a non-OpenVINO provider.",
      "PEFT training on QNN — switch to CUDA/CPU for adapter tuning.",
    ],
  },
  output: {
    title: "Optimized output",
    summary: "Packaged artifacts after Olive finishes the recipe.",
    whatItDoes:
      "Produces ONNX/OpenVINO binaries, configs, and metadata ready for deployment or further export (e.g. ONNX Runtime Web).",
    whenToUse: ["Always — this is the result of running the recipe."],
    whenNotToUse: [],
  },
};

export function getPassGuidanceForNode(nodeId: string, state: UIState): PassGuidance | null {
  if (nodeId === "quantization" && state.passes.quantization) {
    const method = state.passes.quantMethod;
    if (method === "awq" && GUIDANCE.quantization_awq) return GUIDANCE.quantization_awq;
    if (method === "qat" && GUIDANCE.quantization_qat) return GUIDANCE.quantization_qat;
    if (method === "ptq" && GUIDANCE.quantization_ptq) return GUIDANCE.quantization_ptq;
  }

  if (nodeId === "conversion" && state.passes.conversion) {
    const base = { ...GUIDANCE.conversion };
    if (state.passes.conversionFormat === "openvino") {
      base.summary = "Exports to Intel OpenVINO IR for Core/Xeon/NPU targets.";
      base.whenToUse = [
        "Intel OpenVINO execution provider only.",
        "Deploying on Intel CPU, iGPU, or supported NPU paths.",
      ];
      base.whenNotToUse = ["NVIDIA CUDA, TensorRT, AMD ROCm, or Qualcomm QNN — use ONNX."];
    }
    return base;
  }

  return GUIDANCE[nodeId] ?? null;
}
