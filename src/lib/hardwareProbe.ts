import { IHVProvider } from "@/types";

export interface GpuInfo {
  name: string;
  vramMb?: number;
  driver?: string;
}

export interface HardwareProbeResult {
  probedAt: string;
  platform: {
    os: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    systemRamGb?: number;
  };
  nvidia?: {
    gpus: GpuInfo[];
    cudaVersion?: string;
    cudaTag?: string;
  };
  rocm?: {
    gpus: GpuInfo[];
  };
  openvino?: {
    available: boolean;
    version?: string;
  };
  tensorrt?: {
    loadable: boolean;
    detail?: string;
  };
  tensorRtRtx?: {
    loadable: boolean;
    detail?: string;
    version?: string;
  };
  /** Providers reported by onnxruntime.get_available_providers() when probed. */
  onnxRuntimeProviders?: string[];
  /** EPs inferred from local probes (always includes CPU). */
  detectedProviders: IHVProvider[];
  recommendedProvider: IHVProvider;
  notes: string[];
}

const ORT_PROVIDER_MAP: Record<string, IHVProvider> = {
  CPUExecutionProvider: "CPUExecutionProvider",
  CUDAExecutionProvider: "CUDAExecutionProvider",
  TensorrtExecutionProvider: "TensorrtExecutionProvider",
  NvTensorRTRTXExecutionProvider: "NvTensorRTRTXExecutionProvider",
  NvTensorRtRtxExecutionProvider: "NvTensorRTRTXExecutionProvider",
  OpenVINOExecutionProvider: "OpenVINOExecutionProvider",
  ROCMExecutionProvider: "ROCMExecutionProvider",
  WebGpuExecutionProvider: "WebGpuExecutionProvider",
};

export function mapOrtProvidersToIhv(providers: string[]): IHVProvider[] {
  const found = new Set<IHVProvider>();
  for (const provider of providers) {
    const mapped = ORT_PROVIDER_MAP[provider];
    if (mapped) found.add(mapped);
  }
  return Array.from(found);
}

export function mergeDetectedProviders(input: {
  onnxRuntimeProviders?: string[];
  hasNvidiaGpu: boolean;
  hasRocmGpu: boolean;
  hasOpenVino: boolean;
  tensorRtLoadable?: boolean;
  tensorRtRtxLoadable?: boolean;
}): IHVProvider[] {
  const detected = new Set<IHVProvider>(["CPUExecutionProvider"]);
  const tensorRtOk = input.tensorRtLoadable === true;
  const tensorRtRtxOk = input.tensorRtRtxLoadable === true;

  if (input.onnxRuntimeProviders?.length) {
    for (const provider of mapOrtProvidersToIhv(input.onnxRuntimeProviders)) {
      if (provider === "TensorrtExecutionProvider" && !tensorRtOk) {
        continue;
      }
      if (provider === "NvTensorRTRTXExecutionProvider" && !tensorRtRtxOk) {
        continue;
      }
      detected.add(provider);
    }
  }

  // nvidia-smi / rocm-smi / openvino fill gaps when the installed ORT wheel lacks GPU EPs.
  if (input.hasNvidiaGpu) {
    detected.add("CUDAExecutionProvider");
    // TensorRT RTX is GPU-compatible on consumer NVIDIA cards even before the
    // tensorrt-rtx pip package is installed — the app can install it on demand.
    detected.add("NvTensorRTRTXExecutionProvider");
    if (tensorRtOk) {
      detected.add("TensorrtExecutionProvider");
    }
  }
  if (input.hasRocmGpu) {
    detected.add("ROCMExecutionProvider");
  }
  if (input.hasOpenVino) {
    detected.add("OpenVINOExecutionProvider");
  }

  return Array.from(detected);
}

export function pickRecommendedProvider(
  detected: IHVProvider[],
  opts?: { tensorRtRtxLoadable?: boolean },
): IHVProvider {
  // Prefer TensorRT RTX only when the runtime package is already loadable;
  // otherwise CUDA is the better default (TRT RTX can be installed on demand).
  const priority: IHVProvider[] = [
    ...(opts?.tensorRtRtxLoadable ? (["NvTensorRTRTXExecutionProvider"] as const) : []),
    "TensorrtExecutionProvider",
    "CUDAExecutionProvider",
    "NvTensorRTRTXExecutionProvider",
    "ROCMExecutionProvider",
    "OpenVINOExecutionProvider",
    "WebGpuExecutionProvider",
    "CPUExecutionProvider",
  ];
  for (const provider of priority) {
    if (detected.includes(provider)) return provider;
  }
  return "CPUExecutionProvider";
}

function undetectedProviderReason(provider: IHVProvider): string {
  switch (provider) {
    case "QNNExecutionProvider":
      return "Qualcomm QNN requires Snapdragon / Hexagon NPU hardware on this machine.";
    case "ROCMExecutionProvider":
      return "AMD ROCm was not detected (no ROCm GPU or ROCm runtime on this machine).";
    case "OpenVINOExecutionProvider":
      return "Intel OpenVINO was not detected (OpenVINO runtime not installed locally).";
    case "CUDAExecutionProvider":
      return "NVIDIA CUDA was not detected (no NVIDIA GPU or CUDA execution provider on this machine).";
    case "TensorrtExecutionProvider":
      return "Full TensorRT (nvinfer_10 / datacenter SDK) is not loadable. Consumer GeForce GPUs should use TensorRT RTX (NvTensorRTRTX) or CUDA instead — that is separate from full TensorRT.";
    case "NvTensorRTRTXExecutionProvider":
      return "TensorRT RTX needs an NVIDIA GPU. On GeForce RTX, install tensorrt-rtx from Hardware (or it installs on first run). This is not the same as full TensorRT.";
    case "WebGpuExecutionProvider":
      return "WebGPU requires a browser environment with the WebGPU API (Chrome 113+ / Edge 113+ / Firefox Nightly). Not available in node-based probing contexts.";
    case "CPUExecutionProvider":
      return "";
    default: {
      const unreachable: never = provider;
      return `Execution provider not available on this machine (${unreachable}).`;
    }
  }
}

/** Providers the user may select after local hardware detection. */
export function getSelectableProviders(probe: HardwareProbeResult | null | undefined): IHVProvider[] {
  if (!probe) {
    return ["CPUExecutionProvider"];
  }
  return probe.detectedProviders;
}

/** Block selection when a provider is absent from the local probe. */
export function getProviderAvailabilityBlock(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
): { reason: string } | null {
  if (provider === "CPUExecutionProvider") {
    return null;
  }
  if (!probe) {
    return {
      reason: "Hardware detection is still running. Only CPU can be selected until probing finishes.",
    };
  }
  if (!probe.detectedProviders.includes(provider)) {
    return { reason: undetectedProviderReason(provider) };
  }
  return null;
}

export function isProviderDetectedLocally(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
): boolean {
  if (!probe) {
    return false;
  }
  return probe.detectedProviders.includes(provider);
}

export async function fetchHardwareProbe(refresh = false): Promise<HardwareProbeResult> {
  const url = refresh ? "/api/system/hardware-probe?refresh=1" : "/api/system/hardware-probe";
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Hardware probe failed (${res.status})`);
  }
  const result = (await res.json()) as HardwareProbeResult;

  if (!refresh && (result.platform.systemRamGb == null || result.platform.systemRamGb <= 0)) {
    return fetchHardwareProbe(true);
  }

  return result;
}
