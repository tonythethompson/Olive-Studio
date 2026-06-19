import type { LucideIcon } from "lucide-react";
import { Cpu, CpuIcon, Layers } from "lucide-react";
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
    id: "TensorrtExecutionProvider",
    name: "NVIDIA TensorRT",
    shortName: "TensorRT",
    desc: "Maximum throughput on NVIDIA GPUs using TensorRT engines.",
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
];

export function getProviderCatalogEntry(id: IHVProvider): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
