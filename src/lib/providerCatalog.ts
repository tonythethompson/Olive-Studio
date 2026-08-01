import { type LucideIcon, Cpu, CpuIcon, Layers } from "lucide-react";

import type { IHVProvider } from "@/types";

export interface ProviderTooltipInfo {
  /** Minimum hardware requirements */
  requirements: string;
  /** Supported quantization methods */
  quantMethods: string;
  /** Recommended configuration for best results */
  recommendation: string;
}

export interface ProviderCatalogEntry {
  id: IHVProvider;
  name: string;
  shortName: string;
  desc: string;
  icon: LucideIcon;
  /** Detailed tooltip information for the provider card */
  tooltip: ProviderTooltipInfo;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "CPUExecutionProvider",
    name: "Native CPU",
    shortName: "CPU",
    desc: "Standard ONNX Runtime CPU provider for broad compatibility.",
    icon: Cpu,
    tooltip: {
      requirements: "Any x86-64 or ARM64 CPU. No GPU required. Works everywhere.",
      quantMethods: "PTQ INT8, INT4 (limited INT4 runtime support on some CPUs).",
      recommendation:
        "Use INT8 PTQ for best CPU performance. Avoid INT4 unless targeting specific CPU instruction sets (AVX-512 VNNI).",
    },
  },
  {
    id: "CUDAExecutionProvider",
    name: "NVIDIA CUDA",
    shortName: "CUDA",
    desc: "Accelerates inference on NVIDIA GPUs via CUDA.",
    icon: Layers,
    tooltip: {
      requirements:
        "NVIDIA GPU (Kepler or newer) with CUDA toolkit installed. Driver version 450+ recommended.",
      quantMethods: "AWQ INT4 (recommended), GPTQ INT4/INT8, PTQ INT8.",
      recommendation:
        "AWQ INT4 provides the best balance of speed and accuracy for LLMs. Use structured 2:4 sparsity on Ampere+ for additional speedup.",
    },
  },
  {
    id: "NvTensorRTRTXExecutionProvider",
    name: "NVIDIA TensorRT RTX",
    shortName: "TRT RTX",
    desc: "Consumer RTX GPUs (GeForce 30xx+). JIT TensorRT engines via tensorrt-rtx — no full SDK.",
    icon: Layers,
    tooltip: {
      requirements:
        "NVIDIA GeForce RTX 30xx or newer (Ampere+). Uses tensorrt-rtx runtime — no full TensorRT SDK needed.",
      quantMethods: "AWQ INT4 (strongly recommended), GPTQ INT4. Avoid PTQ INT8 (requires QDQ nodes).",
      recommendation:
        "AWQ INT4 is optimal for consumer RTX GPUs — reduces VRAM and provides fast inference. PTQ INT8 requires QDQ format which tensorrt-rtx does not generate.",
    },
  },
  {
    id: "TensorrtExecutionProvider",
    name: "NVIDIA TensorRT",
    shortName: "TensorRT",
    desc: "Full TensorRT SDK (nvinfer_10) for maximum throughput on NVIDIA GPUs.",
    icon: Layers,
    tooltip: {
      requirements:
        "NVIDIA GPU Turing or newer (GeForce RTX 20xx+, Quadro, datacenter). Requires full TensorRT 10.x SDK (nvinfer_10) in .venv — installable from Hardware. For a lighter consumer path, prefer TensorRT RTX.",
      quantMethods: "AWQ INT4 (recommended), GPTQ INT4. INT8 requires QDQ-format ONNX graph.",
      recommendation:
        "AWQ INT4 skips TensorRT calibration and provides the fastest build times. Use for maximum throughput in production.",
    },
  },
  {
    id: "OpenVINOExecutionProvider",
    name: "Intel OpenVINO",
    shortName: "OpenVINO",
    desc: "Optimized for Intel Core, Xeon, and Core Ultra (CPU/GPU/NPU).",
    icon: CpuIcon,
    tooltip: {
      requirements:
        "Intel CPU (6th gen+), Intel GPU (Arc/Iris), or Intel NPU (Meteor Lake+). OpenVINO Python package required.",
      quantMethods: "INT8 static quantization (recommended), INT4 weight compression.",
      recommendation:
        "Use OnnxStaticQuantization for INT8 — OpenVINO's built-in quantizer is more accurate than generic PTQ. Enable weight compression for 2-4x model size reduction.",
    },
  },
  {
    id: "QNNExecutionProvider",
    name: "Qualcomm QNN (Snapdragon)",
    shortName: "QNN",
    desc: "Hexagon NPU acceleration on Snapdragon edge and mobile devices.",
    icon: CpuIcon,
    tooltip: {
      requirements:
        "Qualcomm Snapdragon 8 Gen 2/3 or newer with Hexagon NPU. Snapdragon Dev Kit or Android device.",
      quantMethods: "AWQ INT4 with symmetric quantization (awqSym=true), GPTQ INT4.",
      recommendation:
        "AWQ INT4 with awqSym=true is required for correct QNN inference. INT8 may cause excessive accuracy drops (5-10%).",
    },
  },
  {
    id: "ROCMExecutionProvider",
    name: "AMD ROCm",
    shortName: "ROCm",
    desc: "High-performance compute on AMD Instinct and Radeon GPUs.",
    icon: Layers,
    tooltip: {
      requirements: "AMD GPU (MI250/MI300 or Radeon RX 7xxx) with ROCm 5.7+ stack installed.",
      quantMethods: "GPTQ INT4/INT8 (recommended), PTQ INT8. AWQ has limited ROCm support.",
      recommendation:
        "GPTQ provides the best ROCm compatibility and performance. Avoid AWQ — use GPTQ INT4 for optimal VRAM efficiency on AMD GPUs.",
    },
  },
  {
    id: "WebGpuExecutionProvider",
    name: "WebGPU (Browser)",
    shortName: "WebGPU",
    desc: "ONNX Runtime Web's WebGPU provider for in-browser GPU inference via the WebGPU API.",
    icon: Layers,
    tooltip: {
      requirements:
        "Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled. Any GPU with WebGPU support.",
      quantMethods: "FP16 (recommended), INT8 (experimental).",
      recommendation:
        "Use FP16 for broadest WebGPU compatibility. INT8 support varies by browser and GPU vendor. Export to ONNX format for web deployment.",
    },
  },
];

export function getProviderCatalogEntry(id: IHVProvider): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
