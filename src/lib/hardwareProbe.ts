import { IHVProvider } from "@/types";

export interface GpuInfo {
  name: string;
  vramMb?: number;
  driver?: string;
}

export interface OpenVinoProbeResult {
  available: boolean;
  /** True when OpenVINO EP is loadable in the .venv (matches tensorrt.loadable pattern). */
  loadable?: boolean;
  version?: string;
  /** Devices reported by openvino.Core().available_devices (e.g. CPU, GPU, NPU, AUTO). */
  devices?: string[];
  optimumIntel?: {
    available: boolean;
    version?: string;
    detail?: string;
  };
  /** True when onnxruntime reports OpenVINOExecutionProvider. */
  openvinoExecutionProvider?: boolean;
  detail?: string;
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
  openvino?: OpenVinoProbeResult;
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

/**
 * Combines ONNX Runtime providers and hardware probe results into the locally detected provider list.
 *
 * @param input - Provider and hardware detection results, including runtime loadability for TensorRT variants
 * @returns A deduplicated list of detected providers that always includes CPU
 */
export function mergeDetectedProviders(input: {
  onnxRuntimeProviders?: string[];
  hasNvidiaGpu: boolean;
  hasRocmGpu: boolean;
  hasOpenVino: boolean;
  /** True when the local CPU/platform can run the OpenVINO runtime, even if not yet installed. */
  hasOpenVinoCompatibleHardware?: boolean;
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
    detected.add("NvTensorRTRTXExecutionProvider");
    if (tensorRtOk) {
      detected.add("TensorrtExecutionProvider");
    }
  }
  if (input.hasRocmGpu) {
    detected.add("ROCMExecutionProvider");
  }
  if (input.hasOpenVino || input.hasOpenVinoCompatibleHardware) {
    detected.add("OpenVINOExecutionProvider");
  }

  return Array.from(detected);
}

/**
 * Selects the preferred execution provider from the detected providers.
 *
 * @param detected - Providers detected on the current system
 * @param opts - Runtime loadability flags for TensorRT providers
 * @returns The highest-priority detected provider, or `CPUExecutionProvider` when none match
 */
export function pickRecommendedProvider(
  detected: IHVProvider[],
  opts?: { tensorRtRtxLoadable?: boolean; tensorRtLoadable?: boolean; openvinoLoadable?: boolean },
): IHVProvider {
  // Prefer installed acceleration stacks; otherwise CUDA is the safe NVIDIA default.
  const priority: IHVProvider[] = [
    ...(opts?.tensorRtRtxLoadable ? (["NvTensorRTRTXExecutionProvider"] as const) : []),
    ...(opts?.tensorRtLoadable ? (["TensorrtExecutionProvider"] as const) : []),
    "CUDAExecutionProvider",
    "NvTensorRTRTXExecutionProvider",
    "TensorrtExecutionProvider",
    "ROCMExecutionProvider",
    ...(opts?.openvinoLoadable ? (["OpenVINOExecutionProvider"] as const) : []),
    "WebGpuExecutionProvider",
    "CPUExecutionProvider",
  ];
  for (const provider of priority) {
    if (detected.includes(provider)) return provider;
  }
  return "CPUExecutionProvider";
}

/**
 * Provides the user-facing reason an execution provider is unavailable.
 *
 * @param provider - The execution provider to describe
 * @returns An availability message, or an empty string for the CPU provider
 */
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
      return "Full TensorRT needs an NVIDIA GPU (Turing / GeForce RTX 20xx or newer). Install the TensorRT SDK into .venv from Hardware, or it installs on first TensorRT run.";
    case "NvTensorRTRTXExecutionProvider":
      return "TensorRT RTX needs an NVIDIA GPU. On GeForce RTX, install tensorrt-rtx from Hardware (or it installs on first run). This is not the same as full TensorRT.";
    case "WebGpuExecutionProvider":
      return "WebGPU is a browser deploy target (ONNX Runtime Web), not a local Python EP. Select it to build web-oriented recipes, then run Browser Test / WebGPU benchmark in Recipe & run (Chrome 113+ / Edge 113+).";
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
  // WebGPU is a browser deploy target (ORT Web), not a local Python EP to probe.
  if (provider === "WebGpuExecutionProvider") {
    return null;
  }
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
