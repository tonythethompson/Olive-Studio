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
