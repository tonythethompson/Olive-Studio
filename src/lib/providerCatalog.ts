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
    // The SM 7.5 (Turing) floor mirrors `TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY`
    // in `src/lib/hardwareProbe.ts`. Keep this wording in lockstep with the
    // `undetectedProviderReason('NvTensorRTRTXExecutionProvider')` text so the
    // chip and the unavailable reason can't drift apart; the
    // providerCatalog.test.ts guard test enforces this.
    name: "NVIDIA TensorRT RTX",
    shortName: "TRT RTX",
    desc: "JIT TensorRT engines via tensorrt-rtx — no full SDK. Runs on NVIDIA GPUs with compute capability ≥ 7.5 (Turing / GeForce RTX 20xx or newer; primary target Ampere/Ada/Blackwell consumer RTX).",
    icon: Layers,
    tooltip: {
      requirements:
        "NVIDIA GPU with compute capability ≥ 7.5 (Turing / GeForce RTX 20xx or newer). Targets consumer RTX (Ampere/Ada/Blackwell) via tensorrt-rtx runtime — no full TensorRT SDK needed. Pre-Turing cards (Maxwell/Pascal/Kepler) cannot run this EP even after install.",
      quantMethods: "AWQ INT4 (strongly recommended), GPTQ INT4. Avoid PTQ INT8 (requires QDQ nodes).",
      recommendation:
        "AWQ INT4 is optimal for consumer RTX GPUs — reduces VRAM and provides fast inference. PTQ INT8 requires QDQ format which tensorrt-rtx does not generate.",
    },
  },
  {
    id: "TensorrtExecutionProvider",
    // The SM 7.5 (Turing) floor mirrors `TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY`
    // in `src/lib/hardwareProbe.ts`. Keep this wording in lockstep with the
    // catalog chip for `NvTensorRTRTXExecutionProvider` (same family, same
    // floor, separate install path) and with the
    // `undetectedProviderReason('TensorrtExecutionProvider')` text so the
    // chip, the unavailable reason, and the TRT-RTX chip can't drift apart.
    // The providerCatalog.test.ts guard test enforces this across all four
    // surfaces.
    name: "NVIDIA TensorRT",
    shortName: "TensorRT",
    desc: "Full TensorRT 10.x SDK (nvinfer_10) for maximum throughput on NVIDIA GPUs ≥ compute capability 7.5 (Turing / GeForce RTX 20xx or newer; also Quadro, Datacenter, H100/B100).",
    icon: Layers,
    tooltip: {
      requirements:
        "NVIDIA GPU with compute capability ≥ 7.5 (Turing / GeForce RTX 20xx or newer; also Quadro, Datacenter, H100/B100). Requires full TensorRT 10.x SDK (nvinfer_10) in .venv — installable from Hardware. Pre-Turing cards (Maxwell/Pascal/Kepler) cannot run this EP even after install. For a lighter consumer path on the same floor, prefer TensorRT RTX.",

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
    id: "DmlExecutionProvider",
    name: "Windows DirectML",
    shortName: "DirectML",
    desc: "GPU acceleration on Windows via DirectML (onnxruntime-directml).",
    icon: Layers,
    tooltip: {
      requirements:
        "Windows 10/11 with a DirectX 12 capable GPU. Uses onnxruntime-directml in the default project runtime.",
      quantMethods: "PTQ INT8 (recommended), limited INT4 depending on operator support.",
      recommendation:
        "Prefer INT8 PTQ for broad DirectML coverage. Keep CUDA/TensorRT workloads on the separate CUDA runtime.",
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
  {
    id: "CoreMLExecutionProvider",
    name: "Apple CoreML",
    shortName: "CoreML",
    desc: "Apple Neural Engine / GPU via CoreML on macOS and iOS (platform-local when ORT lists it).",
    icon: CpuIcon,
    tooltip: {
      requirements:
        "macOS Apple Silicon (M1/M2/M3/M4). Prefer fixed input shapes for optimal ANE scheduling.",
      quantMethods: "PTQ INT8, FP16. KQuant, RTN, HQQ, QAT also supported.",
      recommendation:
        "Suitable for Apple edge deployment. Fixed input shapes enable optimal Neural Engine scheduling. Execute Live requires Darwin host with ORT CoreML EP.",
    },
  },
  {
    id: "NNAPIExecutionProvider",
    name: "Android NNAPI",
    shortName: "NNAPI",
    desc: "Android Neural Networks API export target for OWR / mobile ORT (not a local Python EP).",
    icon: CpuIcon,
    tooltip: {
      requirements: "Android device or OWR mobile export. Studio does not run NNAPI via Execute Live.",
      quantMethods: "PTQ INT8 / uint8 (NNAPI limits vary by driver).",
      recommendation:
        "Prefer INT8 with small graphs. Use OWR mobile export; many ops fall back to CPU on device.",
    },
  },
  {
    id: "VitisAIExecutionProvider",
    name: "AMD/Xilinx Vitis AI",
    shortName: "Vitis AI",
    desc: "Xilinx DPU / Vitis AI edge target (platform-local when ORT lists it).",
    icon: CpuIcon,
    tooltip: {
      requirements: "Xilinx board with Vitis AI ORT EP. Power-of-2 scale constraints apply.",
      quantMethods: "VitisAIQuantization / INT8 calibration.",
      recommendation:
        "Best for edge CNNs. Execute Live only when the probe reports VitisAIExecutionProvider.",
    },
  },
  {
    id: "SNPEExecutionProvider",
    name: "Qualcomm SNPE (Legacy)",
    shortName: "SNPE",
    desc: "Legacy Qualcomm SNPE / DLC path. Prefer QNN for Snapdragon NPU work.",
    icon: CpuIcon,
    tooltip: {
      requirements: "Legacy SNPE SDK / DLC conversion. Not supported for Studio Execute Live.",
      quantMethods: "SNPEConversion + vendor quantization tooling.",
      recommendation: "Prefer QNNExecutionProvider for new Qualcomm targets. Keep SNPE only for legacy DLC pipelines.",
    },
  },
  {
    id: "TensorflowLiteExecutionProvider",
    name: "TensorFlow Lite",
    shortName: "TFLite",
    desc: "TFLite conversion / export path (not a local Olive Execute Live EP).",
    icon: Cpu,
    tooltip: {
      requirements: "TFLite runtime or conversion toolchain. Studio blocks Execute Live for this target.",
      quantMethods: "INT8 TFLite conversion paths.",
      recommendation: "Use for TFLite export recipes only. Prefer ONNX + QNN/NNAPI/WebGPU for Studio-first flows.",
    },
  },
  {
    id: "XnnpackExecutionProvider",
    name: "XNNPACK (Mobile)",
    shortName: "XNNPACK",
    desc: "OWR / ONNX Runtime Mobile CPU backend via XNNPACK (export target).",
    icon: Cpu,
    tooltip: {
      requirements: "ORT Mobile / OWR mobile package. Not a local Python EP in Studio.",
      quantMethods: "FP16 / INT8 suitable for mobile CPU.",
      recommendation: "Pair with OWR mobile export. Prefer as CPU fallback beside NNAPI on Android.",
    },
  },
  {
    id: "WasmExecutionProvider",
    name: "WASM (Browser)",
    shortName: "WASM",
    desc: "ONNX Runtime Web WASM CPU backend for browsers (export target).",
    icon: Cpu,
    tooltip: {
      requirements: "onnxruntime-web WASM build. Not a local Python EP.",
      quantMethods: "FP32 / FP16; INT8 support depends on ORT Web build.",
      recommendation: "Use as WebGPU fallback in OWR web configs, or alone for CPU-only browser deploy.",
    },
  },
];

export function getProviderCatalogEntry(id: IHVProvider): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
