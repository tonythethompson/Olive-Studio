import { type LucideIcon, Cpu, CpuIcon, Layers } from "lucide-react";

import type { IHVProvider } from "@/types";

export interface ProviderCatalogEntry {
  id: IHVProvider;
  name: string;
  shortName: string;
  desc: string;
  icon: LucideIcon;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "CPUExecutionProvider",
    name: "Native CPU",
    shortName: "CPU",
    desc: "Standard ONNX Runtime CPU provider for broad compatibility.",
    icon: Cpu,
  },
  {
    id: "CUDAExecutionProvider",
    name: "NVIDIA CUDA",
    shortName: "CUDA",
    desc: "Accelerates inference on NVIDIA GPUs via CUDA.",
    icon: Layers,
  },
  {
    id: "NvTensorRTRTXExecutionProvider",
    name: "NVIDIA TensorRT RTX",
    shortName: "TRT RTX",
    desc: "Consumer RTX GPUs (GeForce 30xx+). JIT TensorRT engines via tensorrt-rtx — no full SDK.",
    icon: Layers,
  },
  {
    id: "TensorrtExecutionProvider",
    name: "NVIDIA TensorRT",
    shortName: "TensorRT",
    desc: "Datacenter / full TensorRT SDK (nvinfer_10) for maximum throughput.",
    icon: Layers,
  },
  {
    id: "OpenVINOExecutionProvider",
    name: "Intel OpenVINO",
    shortName: "OpenVINO",
    desc: "Optimized for Intel Core, Xeon, and Core Ultra (CPU/GPU/NPU).",
    icon: CpuIcon,
  },
  {
    id: "QNNExecutionProvider",
    name: "Qualcomm QNN (Snapdragon)",
    shortName: "QNN",
    desc: "Hexagon NPU acceleration on Snapdragon edge and mobile devices.",
    icon: CpuIcon,
  },
  {
    id: "ROCMExecutionProvider",
    name: "AMD ROCm",
    shortName: "ROCm",
    desc: "High-performance compute on AMD Instinct and Radeon GPUs.",
    icon: Layers,
  },
  {
    id: "WebGpuExecutionProvider",
    name: "WebGPU (Browser)",
    shortName: "WebGPU",
    desc: "ONNX Runtime Web's WebGPU provider for in-browser GPU inference via the WebGPU API.",
    icon: Layers,
  },
];

export function getProviderCatalogEntry(id: IHVProvider): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
