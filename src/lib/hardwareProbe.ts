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
  OpenVINOExecutionProvider: "OpenVINOExecutionProvider",
  ROCMExecutionProvider: "ROCMExecutionProvider",
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
}): IHVProvider[] {
  const detected = new Set<IHVProvider>(["CPUExecutionProvider"]);

  if (input.onnxRuntimeProviders?.length) {
    for (const provider of mapOrtProvidersToIhv(input.onnxRuntimeProviders)) {
      detected.add(provider);
    }
  }

  // nvidia-smi / rocm-smi / openvino fill gaps when the installed ORT wheel lacks GPU EPs.
  if (input.hasNvidiaGpu) {
    detected.add("CUDAExecutionProvider");
    detected.add("TensorrtExecutionProvider");
  }
  if (input.hasRocmGpu) {
    detected.add("ROCMExecutionProvider");
  }
  if (input.hasOpenVino) {
    detected.add("OpenVINOExecutionProvider");
  }

  return Array.from(detected);
}

export function pickRecommendedProvider(detected: IHVProvider[]): IHVProvider {
  const priority: IHVProvider[] = [
    "TensorrtExecutionProvider",
    "CUDAExecutionProvider",
    "ROCMExecutionProvider",
    "OpenVINOExecutionProvider",
    "CPUExecutionProvider",
  ];
  for (const provider of priority) {
    if (detected.includes(provider)) return provider;
  }
  return "CPUExecutionProvider";
}

export function isProviderDetectedLocally(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined
): boolean {
  if (!probe) return true;
  return probe.detectedProviders.includes(provider);
}

export async function fetchHardwareProbe(refresh = false): Promise<HardwareProbeResult> {
  const url = refresh ? "/api/system/hardware-probe?refresh=1" : "/api/system/hardware-probe";
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Hardware probe failed (${res.status})`);
  }
  return res.json() as Promise<HardwareProbeResult>;
}
