import { IHVProvider } from "@/types";
import {
  CUDA_SM_FLOOR,
  CUDA_DOWNLOAD_LINKS,
  isPreMaxwellNvidiaBox,
  pinnedOrtGpuInstallCommand,
} from "@/lib/cudaDeps";

/**
 * Compute capability is reported as `"<major>.<minor>"` (e.g. `"8.9"` for
 * Ada Lovelace, `"7.5"` for Turing). `undefined` means we could not read it
 * (older drivers, parsing failure) — callers must treat absence as permissive
 * so a probe hiccup never falsely downgrades an otherwise supported GPU.
 */
export interface GpuInfo {
  name: string;
  vramMb?: number;
  driver?: string;
  computeCapability?: string;
}

/**
 * Minimum NVIDIA compute capability TensorRT 10.x and TensorRT-RTX can run on.
 * Turing (SM 7.5) is the floor; Maxwell/Pascal/Kepler cannot execute either
 * EP even when the SDK/runtime are installed. Centralizing this number avoids
 * drift between the detection (nvidia-smi), the recipe-compatibility check,
 * the install-needed hint, and the missing-provider reason.
 *
 * Format: `{ major, minor }`. Compare numerically; e.g. 8.9 ≥ 7.5.
 */
export const TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY = { major: 7, minor: 5 } as const;

/**
 * Parse a `"<major>.<minor>"` string (e.g. `"8.9"`, `"7.5"`, `"12.0"`) into
 * a comparable pair. Returns `undefined` on any malformed/empty input so
 * "I don't know" never downgrades compat silently.
 */
export function parseComputeCapability(value: string | undefined): { major: number; minor: number } | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(\d+)\.(\d+)$/);
  if (!m) return undefined;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

/**
 * Does the GPU's compute capability meet or exceed the TensorRT 10.x / RTX floor?
 * `undefined` compute capability is treated as supported so a probe glitch
 * does not silently mark a real RTX card as incompatible.
 */
export function isNvidiaGpuTensorRtFamily(gpu: GpuInfo): boolean {
  const cap = parseComputeCapability(gpu.computeCapability);
  if (!cap) return true;
  if (cap.major !== TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major) {
    return cap.major > TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major;
  }
  return cap.minor >= TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor;
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
    /**
     * True when `nvcc --version` succeeded. The toolkit is only required
     * for native CUDA compilation — Olive Studio inference only needs the
     * driver + CUDA runtime libraries (which ship inside the
     * `onnxruntime-gpu` wheel). Surfacing this separately lets the IHV
     * panel decide whether to offer a download link.
     *
     * `undefined` means the probe didn't run or didn't yield a clear answer
     * (no nvcc in PATH, fresh installer, etc.).
     */
    cudaToolkit?: {
      available: boolean;
      version?: string;
    };
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
  /**
   * Whether the CUDA execution provider is actually loadable by ORT in this
   * environment. Distinct from NVIDIA GPU detection (nvidia-smi) — the EP can
   * be missing because `onnxruntime-gpu` wheel isn't installed, the CUDA
   * runtime libs aren't on PATH, or the driver/ORT ABI versions don't match.
   * Mirrors the `tensorrt` / `tensorRtRtx` shape so `mergeDetectedProviders`
   * can strip CUDA from the detected list when it isn't loadable and the
   * recipe-compat layer can surface a one-click install hint.
   */
  cuda?: {
    loadable: boolean;
    detail?: string;
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
  tensorRtLoadable?: boolean;
  tensorRtRtxLoadable?: boolean;
  /**
   * Pre-computed by the route handler from `nvidia.gpus[].computeCapability`.
   * When `true`, at least one NVIDIA GPU meets the TensorRT-family floor
   * (SM 7.5 / Turing+). Defaults to `true` for backwards compatibility with
   * callers that did not supply the GPU detail; routes that have it should
   * always pass it explicitly.
   */
  nvidiaTensorRtFamilyCapable?: boolean;
  /**
   * Pre-computed from the ORT CUDA EP probe (`ORT_GPU_PROBE_SCRIPT`).
   * When explicitly `false`, the CUDA execution provider is not loadable in
   * this environment (e.g. onnxruntime-gpu wheel missing, driver/wheel
   * mismatch) and `mergeDetectedProviders` strips `CUDAExecutionProvider`
   * from the detected list. Defaults to `true` for callers that don't probe
   * the EP — same permissive-to-unknown convention as TensorRT.
   */
  cudaLoadable?: boolean;
}): IHVProvider[] {
  const detected = new Set<IHVProvider>(["CPUExecutionProvider"]);
  const tensorRtOk = input.tensorRtLoadable === true;
  const tensorRtRtxOk = input.tensorRtRtxLoadable === true;
  // Treat `undefined` as "we don't know yet" → permissive (don't strip CUDA).
  // Only an explicit `false` from the ORT probe removes the EP from the
  // detected list, unlocking the install-needed branch in the recipe
  // compat layer. Same permissive-to-unknown convention as the RTX gate.
  const cudaOk = input.cudaLoadable !== false;
  // Default true: callers without compute-cap data must not silently hide
  // the RTX-family EPs (pre-Turing downgrades only fire when we KNOW the SM).
  const tensorRtFamilyCapable = input.nvidiaTensorRtFamilyCapable ?? true;

  if (input.onnxRuntimeProviders?.length) {
    for (const provider of mapOrtProvidersToIhv(input.onnxRuntimeProviders)) {
      if (provider === "TensorrtExecutionProvider" && !tensorRtOk) {
        continue;
      }
      if (provider === "NvTensorRTRTXExecutionProvider" && !tensorRtRtxOk) {
        continue;
      }
      // Gate RTX-family EPs even when ORT reports them — nvidia-smi SM ≥ 7.5
      // is the real floor; without it the EP load is a lie.
      if (provider === "TensorrtExecutionProvider" || provider === "NvTensorRTRTXExecutionProvider") {
        if (!tensorRtFamilyCapable) continue;
      }
      // Mirror the RTX gate: if the CUDA EP is not actually loadable in
      // this environment, strip it from ORT's reported list even when ORT
      // reports it (e.g. wheel installed but EP failed to register).
      if (provider === "CUDAExecutionProvider" && !cudaOk) {
        continue;
      }
      detected.add(provider);
    }
  }

  // nvidia-smi / rocm-smi / openvino fill gaps when the installed ORT wheel lacks GPU EPs.
  if (input.hasNvidiaGpu) {
    // Only fill CUDA from nvidia-smi when the ORT probe confirms the EP loads.
    // Falls back to the onnxRuntimeProviders branch when probe hasn't run yet
    // (caller didn't pass cudaLoadable, defaults to permissive).
    if (cudaOk) {
      detected.add("CUDAExecutionProvider");
    }
    if (tensorRtFamilyCapable) {
      detected.add("NvTensorRTRTXExecutionProvider");
      if (tensorRtOk) {
        detected.add("TensorrtExecutionProvider");
      }
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

/**
 * Selects the preferred execution provider from the detected providers.
 *
 * @param detected - Providers detected on the current system
 * @param opts - Runtime loadability flags for TensorRT providers
 * @returns The highest-priority detected provider, or `CPUExecutionProvider` when none match
 */
export function pickRecommendedProvider(
  detected: IHVProvider[],
  opts?: { tensorRtRtxLoadable?: boolean; tensorRtLoadable?: boolean },
): IHVProvider {
  // Prefer installed acceleration stacks; otherwise CUDA is the safe NVIDIA default.
  const priority: IHVProvider[] = [
    ...(opts?.tensorRtRtxLoadable ? (["NvTensorRTRTXExecutionProvider"] as const) : []),
    ...(opts?.tensorRtLoadable ? (["TensorrtExecutionProvider"] as const) : []),
    "CUDAExecutionProvider",
    "NvTensorRTRTXExecutionProvider",
    "TensorrtExecutionProvider",
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

/**
 * Provides the user-facing reason an execution provider is unavailable.
 *
 * The CUDA branch consults the latest probe fields to give a precise
 * explanation:
 *
 *   1. No NVIDIA GPU at all → pick the CPU provider instead.
 *   2. NVIDIA GPU present but every card predates the CUDA 12 toolkit
 *      floor (SM < 5.0 / Maxwell) → toolkits cannot help this hardware.
 *   3. NVIDIA GPU + driver detected but `onnxruntime-gpu` is missing from
 *      `.venv` → pip install the wheel.
 *   4. NVIDIA GPU + driver + toolkit installed but the CUDA EP failed to
 *      register → driver or wheel mismatch.
 *
 * The "Install onnxruntime-gpu" hint includes the exact pinned install
 * command so the user can paste it without digging through Hardware.
 *
 * @param provider - The execution provider to describe
 * @param probe - Optional hardware probe result for path-specific messaging
 * @returns An availability message, or an empty string for the CPU provider
 */
function undetectedProviderReason(
  provider: IHVProvider,
  probe?: HardwareProbeResult | null,
): string {
  switch (provider) {
    case "QNNExecutionProvider":
      return "Qualcomm QNN requires Snapdragon / Hexagon NPU hardware on this machine.";
    case "ROCMExecutionProvider":
      return "AMD ROCm was not detected (no ROCm GPU or ROCm runtime on this machine).";
    case "OpenVINOExecutionProvider":
      return "Intel OpenVINO was not detected (OpenVINO runtime not installed locally).";
    case "CUDAExecutionProvider": {
      if (!probe) {
        return "NVIDIA CUDA was not detected (no NVIDIA GPU or CUDA execution provider on this machine).";
      }
      const nvidia = probe.nvidia;
      const gpus = nvidia?.gpus ?? [];
      // 1. CPU-only box
      if (gpus.length === 0) {
        return "No NVIDIA GPU detected on this machine (nvidia-smi returned no devices). Use the CPU provider for OLIVE recipes.";
      }
      // 2. Pre-Maxwell box: install cannot recover
      if (isPreMaxwellNvidiaBox(gpus)) {
        const names = gpus.map((g) => g.name).join(", ");
        return `NVIDIA GPU detected (${names}) but every card predates the CUDA 12 toolkit floor (compute capability ≥ ${CUDA_SM_FLOOR}, Maxwell / GeForce GTX 750 Ti or GTX 9xx series). Upgrading the toolkit cannot recover this — these cards (Kepler SM 3.x) cannot execute modern CUDA. Use the CPU provider, or upgrade hardware.`;
      }
      // 3. NVIDIA driver OK but onnxruntime-gpu missing in .venv
      const cudaEpUsable = probe.cuda?.loadable === true;
      const toolkit = nvidia?.cudaToolkit;
      const toolTip =
        toolkit?.available === true
          ? `toolkit ${toolkit.version ?? "available"}` +
            (nvidia?.cudaVersion ? ` on driver CUDA ${nvidia.cudaVersion}` : "")
          : toolkit?.available === false
            ? "toolkit (nvcc) not installed"
            : "toolkit status unknown";
      if (!cudaEpUsable) {
        return `NVIDIA driver detected on ${gpus.map((g) => g.name).join(", ")}; ${toolTip}. The CUDA execution provider is not registered by onnxruntime-gpu in the project .venv — install the pinned wheel with \`${pinnedOrtGpuInstallCommand()}\` (you can also click "Install onnxruntime-gpu" in the Hardware panel).${
          toolkit?.available === false
            ? ` CUDA toolkit is also missing; for native builds grab it from ${CUDA_DOWNLOAD_LINKS.archive}.`
            : ""
        }`;
      }
      // 4. Toolkit + driver + ORT installed but the CUDA EP isn't in
      // detectedProviders — likely driver/wheel mismatch (e.g. CUDA 13
      // wheel against CUDA 11 driver).
      return `NVIDIA CUDA driver + toolkit installed, but the CUDA execution provider is not selectable in this environment (likely driver/wheel version mismatch — refresh the probe after fixing the install).`;
    }
    case "TensorrtExecutionProvider": {
      const min = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;
      return `Full TensorRT needs an NVIDIA GPU with compute capability ≥ ${min} (Turing / GeForce RTX 20xx, Quadro, datacenter). Pre-Turing cards (Maxwell/Pascal/Kepler) cannot run TensorRT 10.x even after install. On a supported GPU, install the TensorRT SDK into .venv from Hardware — it installs on first TensorRT run otherwise.`;
    }
    case "NvTensorRTRTXExecutionProvider": {
      const min = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;
      return `TensorRT RTX needs an NVIDIA GPU with compute capability ≥ ${min} (Turing / GeForce RTX 20xx or newer). Pre-Turing cards (Maxwell/Pascal/Kepler) cannot run the EP. On a supported GeForce RTX, install tensorrt-rtx from Hardware (or it installs on first run). This is not the same as full TensorRT.`;
    }
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
    return { reason: undetectedProviderReason(provider, probe) };
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
