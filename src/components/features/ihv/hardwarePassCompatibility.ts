import { IHVProvider, UIState } from "@/types";
import {
  getQuantMethodActivationBlock,
  isConversionFormatAllowed,
  isPeftAllowed,
  isPeftMethodAllowed,
  isQuantMethodAllowed,
  isStructuredPruningAllowed,
} from "@/lib/pipelineValidation";

export type PassEstimates = {
  speedup: string;
  vram: string;
  efficiency: string;
};

/** Pass IDs that map to a quant method for activation-block checks. */
export const QUANT_METHOD_BY_PASS_ID: Partial<
  Record<
    string,
    Extract<
      UIState["passes"]["quantMethod"],
      "awq" | "qat" | "gptq" | "hqq" | "spinquant" | "quarot"
    >
  >
> = {
  "awq-quantization": "awq",
  "gptq-quantization": "gptq",
  "spinquant-quantization": "spinquant",
  "quarot-quantization": "quarot",
  "hqq-quantization": "hqq",
  "qat-quantization": "qat",
};

export interface OptimizationPassValidation {
  id: string;
  name: string;
  category: "Conversion" | "Quantization" | "Compression" | "PEFT";
  description: string;
  isUnsupported: (provider: IHVProvider) => boolean;
  getIncompatibilityReason: (provider: IHVProvider) => string;
  isActive: (passes: UIState["passes"]) => boolean;
  toggle: (passes: UIState["passes"], currentActive: boolean) => Partial<UIState["passes"]>;
  requiresExplanation: string;
  estimates: PassEstimates;
}

export const PASS_VALIDATIONS: OptimizationPassValidation[] = [
  {
    id: "onnx-conversion",
    name: "ONNX Model Conversion",
    category: "Conversion",
    description:
      "Converts PyTorch, TensorFlow, or JAX models to the ONNX format for cross-platform inference.",
    isUnsupported: () => false,
    getIncompatibilityReason: () => "",
    isActive: (passes) => passes.conversion && passes.conversionFormat === "onnx",
    toggle: (passes, active) =>
      active
        ? { ...passes, conversion: false }
        : { ...passes, conversion: true, conversionFormat: "onnx" },
    requiresExplanation:
      "Standard ONNX conversion is universally supported across all execution providers that consume ONNX models.",
    estimates: { speedup: "1.0x", vram: "No Change", efficiency: "100%" },
  },
  {
    id: "openvino-format",
    name: "OpenVINO IR Conversion Stage",
    category: "Conversion",
    description:
      "Compiles standard execution graphs into the highly optimized Intel OpenVINO XML/BIN Intermediate Representation.",
    isUnsupported: (provider) => !isConversionFormatAllowed("openvino", provider),
    getIncompatibilityReason: () => "Requires Intel OpenVINO hardware target.",
    isActive: (passes) => passes.conversion && passes.conversionFormat === "openvino",
    toggle: (passes, active) =>
      active
        ? { ...passes, conversionFormat: "onnx" }
        : { ...passes, conversion: true, conversionFormat: "openvino" },
    requiresExplanation:
      "Standard CPU, NVIDIA Titan/GeForce/RTX, Qualcomm Snapdragon, and AMD hosts expect standard ONNX models instead of proprietary Intel IR files.",
    estimates: { speedup: "3.1x", vram: "Host Shared", efficiency: "98%" },
  },
  {
    id: "onnx-float-to-float16",
    name: "ONNX Float-to-Float16 Conversion",
    category: "Quantization",
    description:
      "Converts FP32 model weights and activations to FP16, halving memory footprint with minimal accuracy loss.",
    isUnsupported: () => false,
    getIncompatibilityReason: () => "",
    isActive: (passes) => passes.quantization && passes.quantPrecision === "fp16",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantPrecision: "int8" }
        : { ...passes, quantization: true, quantPrecision: "fp16" },
    requiresExplanation:
      "FP16 conversion is broadly supported. On Intel oneDNN without AMX, BF16 throughput may be degraded.",
    estimates: { speedup: "1.8x", vram: "-50% VRAM", efficiency: "97%" },
  },
  {
    id: "onnx-static-quantization",
    name: "ONNX Static Quantization (PTQ)",
    category: "Quantization",
    description:
      "Applies post-training static quantization using calibration data to produce INT8/INT4 models with fixed scale factors.",
    isUnsupported: () => false,
    getIncompatibilityReason: () => "",
    isActive: (passes) => passes.quantization && passes.quantMethod === "ptq",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantization: false }
        : { ...passes, quantization: true, quantMethod: "ptq" },
    requiresExplanation:
      "Static quantization with calibration data is universally supported for ONNX models across all providers.",
    estimates: { speedup: "2.2x", vram: "-70% VRAM", efficiency: "90%" },
  },
  {
    id: "onnx-model-optimizer",
    name: "ONNX Graph Optimization",
    category: "Compression",
    description:
      "Applies graph-level optimizations including constant folding, operator fusion, and dead-node elimination.",
    isUnsupported: () => false,
    getIncompatibilityReason: () => "",
    isActive: (passes) => passes.onnxTransforms,
    toggle: (passes, active) => (active ? { ...passes, onnxTransforms: false } : { ...passes, onnxTransforms: true }),
    requiresExplanation:
      "ONNX graph-level optimizations are universally applicable and improve inference performance on all targets.",
    estimates: { speedup: "1.3x", vram: "-10%", efficiency: "100%" },
  },
  {
    id: "awq-quantization",
    name: "AWQ Activation-Aware Quantization",
    category: "Quantization",
    description:
      "Protects high-salient channel weights dynamically from rounding errors, protecting baseline math precision.",
    isUnsupported: (provider) => !isQuantMethodAllowed("awq", provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD high-performance compute host.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "awq",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "awq", pruning: false },
    requiresExplanation:
      "AWQ is fine-tuned for heavy linear layers utilizing specialized CUDA or ROCm GPU acceleration matrices.",
    estimates: { speedup: "2.5x", vram: "-72% VRAM", efficiency: "92%" },
  },
  {
    id: "gptq-quantization",
    name: "GPTQ Post-Training Quantization",
    category: "Quantization",
    description:
      "Layer-wise quantization using approximate second-order information to minimize quantization error on large language models.",
    isUnsupported: (provider) => !isQuantMethodAllowed("gptq", provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD high-performance GPU compute host.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "gptq",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "gptq", pruning: false },
    requiresExplanation:
      "GPTQ performs GPU-accelerated layer-wise calibration requiring CUDA or ROCm compute capabilities.",
    estimates: { speedup: "2.4x", vram: "-75% VRAM", efficiency: "91%" },
  },
  {
    id: "spinquant-quantization",
    name: "SpinQuant Rotation-Based Quantization",
    category: "Quantization",
    description:
      "Applies learned rotation matrices before quantization to reduce outlier magnitudes and improve low-bit accuracy.",
    isUnsupported: (provider) => !isQuantMethodAllowed("spinquant", provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD GPU for rotation-based calibration.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "spinquant",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "spinquant" },
    requiresExplanation:
      "SpinQuant rotation calibration demands GPU compute for matrix decomposition during quantization.",
    estimates: { speedup: "2.3x", vram: "-70% VRAM", efficiency: "93%" },
  },
  {
    id: "quarot-quantization",
    name: "QuaRot Quantization with Rotation",
    category: "Quantization",
    description:
      "Applies orthogonal rotation to weight matrices before quantization, spreading outlier information across channels.",
    isUnsupported: (provider) => !isQuantMethodAllowed("quarot", provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD GPU for rotation computation.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "quarot",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "quarot" },
    requiresExplanation:
      "QuaRot requires GPU compute for orthogonal rotation matrix calibration and weight transformation.",
    estimates: { speedup: "2.3x", vram: "-70% VRAM", efficiency: "92%" },
  },
  {
    id: "hqq-quantization",
    name: "HQQ Half-Quadratic Quantization",
    category: "Quantization",
    description:
      "Zero-shot data-free quantization using half-quadratic optimization to find optimal quantization parameters without calibration data.",
    isUnsupported: (provider) => !isQuantMethodAllowed("hqq", provider),
    getIncompatibilityReason: () => "Requires CPU, CUDA, CoreML, or MIGraphX execution provider.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "hqq",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "hqq" },
    requiresExplanation:
      "HQQ is currently supported on CPU, CUDA, CoreML, and MIGraphX providers for half-quadratic optimization inference.",
    estimates: { speedup: "2.0x", vram: "-68% VRAM", efficiency: "89%" },
  },
  {
    id: "qat-quantization",
    name: "Quantization-Aware Training (QAT)",
    category: "Quantization",
    description:
      "Instruments training backpropagation to emulate integer quantization noise, producing highly robust integer models.",
    isUnsupported: (provider) => !isQuantMethodAllowed("qat", provider),
    getIncompatibilityReason: () => "Snapdragon NPU does not support active QAT pipelines.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "qat",
    toggle: (passes, active) =>
      active ? { ...passes, quantMethod: "ptq" } : { ...passes, quantization: true, quantMethod: "qat" },
    requiresExplanation:
      "Qualcomm Snapdragon Hexagon NPUs require standard offline Post-Training Quantization (PTQ) formats to run properly.",
    estimates: { speedup: "1.8x", vram: "-50% VRAM", efficiency: "88%" },
  },
  {
    id: "structured-sparsity",
    name: "Structured 2:4 Sparsity Pruning",
    category: "Compression",
    description:
      "Systematically zeros out 2 out of every 4 block elements to maximize memory access efficiency.",
    isUnsupported: (provider) => !isStructuredPruningAllowed(provider),
    getIncompatibilityReason: () => "Requires built-in NVIDIA Ampere+ Tensor Cores.",
    isActive: (passes) => passes.pruning && passes.pruningType === "structured",
    toggle: (passes, active) =>
      active
        ? { ...passes, pruningType: "unstructured" }
        : { ...passes, pruning: true, pruningType: "structured" },
    requiresExplanation:
      "2:4 block sparsity requires built-in hardware decoding logic integrated exclusively into modern NVIDIA RTX or enterprise datacenter GPUs.",
    estimates: { speedup: "2.0x", vram: "No Change", efficiency: "99%" },
  },
  {
    id: "peft-adapters",
    name: "PEFT LoRA Training Stage",
    category: "PEFT",
    description:
      "Locks core parameters to fine-tune compact rank-adapters, drastically boosting training speed and reducing VRAM footprint.",
    isUnsupported: (provider) => !isPeftAllowed(provider),
    getIncompatibilityReason: () => "NPUs are strictly optimized for static low-power inference.",
    isActive: (passes) => passes.peft,
    toggle: (passes, active) => (active ? { ...passes, peft: false } : { ...passes, peft: true }),
    requiresExplanation:
      "Edge-facing Snapdragon or Intel NPU architectures cannot execute full training loops. Adapter configurations must be compiled on CPU/GPU.",
    estimates: { speedup: "1.6x (Tuned)", vram: "-60% VRAM", efficiency: "94%" },
  },
  {
    id: "qlora-adapters",
    name: "Double-Quantized QLoRA Adapter Tuning",
    category: "PEFT",
    description:
      "Pairs LoRA rank updates with highly compressed 4-bit NormalFloat parameters to allow massive model adjustments.",
    isUnsupported: (provider) => !isPeftMethodAllowed("qlora", provider),
    getIncompatibilityReason: () => "Requires GPU CUDA/ROCm acceleration.",
    isActive: (passes) => passes.peft && passes.peftMethod === "qlora",
    toggle: (passes, active) =>
      active ? { ...passes, peftMethod: "lora" } : { ...passes, peft: true, peftMethod: "qlora" },
    requiresExplanation:
      "QLoRA requires active, high-fidelity dynamic double-quantization backpropagation kernels which are completely unsupported on standard CPU hosts.",
    estimates: { speedup: "1.5x (Tuned)", vram: "-82% VRAM", efficiency: "90%" },
  },
];

/**
 * Determines the compatibility and estimated optimization characteristics of a pass for a provider.
 */
export function getCellCompatibility(
  pass: OptimizationPassValidation,
  provider: IHVProvider,
  passes?: UIState["passes"],
) {
  const isUnsupported = pass.isUnsupported(provider);
  const quantMethod = QUANT_METHOD_BY_PASS_ID[pass.id];

  if (passes && quantMethod && !isUnsupported) {
    const block = getQuantMethodActivationBlock(quantMethod, passes, provider);
    if (block) {
      return {
        status: "blocked" as const,
        label: "Config blocked",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        reason: block.reason,
        speedup: "N/A",
        vram: "N/A",
        efficiency: "0%",
      };
    }
  }

  if (isUnsupported) {
    return {
      status: "unsupported" as const,
      label: "Incompatible",
      color: "bg-rose-500/15 border-rose-500/30 text-rose-400",
      reason: pass.getIncompatibilityReason(provider),
      speedup: "N/A",
      vram: "N/A",
      efficiency: "0%",
    };
  }

  if (provider === "CPUExecutionProvider") {
    if (pass.id === "peft-adapters" || pass.id === "qlora-adapters") {
      return {
        status: "partial" as const,
        label: "CPU Fallback",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        reason:
          "Executes correctly but lacks hardware tensor cores. Active tuning is extremely slow on CPUs.",
        speedup: "1.0x (Baseline)",
        vram: "System RAM (-20%)",
        efficiency: "15% (Fallback)",
      };
    }
  }

  const { speedup, vram, efficiency } = pass.estimates ?? {
    speedup: "2.2x",
    vram: "-50%",
    efficiency: "95%",
  };
  return {
    status: "supported" as const,
    label: "Optimized",
    color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
    reason: "Fully supported. Direct edge hardware instruction sets mapped successfully.",
    speedup,
    vram,
    efficiency,
  };
}
