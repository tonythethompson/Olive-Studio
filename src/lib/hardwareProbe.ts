import { IHVProvider } from "@/types";
import {
  CUDA_SM_FLOOR,
  CUDA_DOWNLOAD_LINKS,
  isPreMaxwellNvidiaBox,
  pinnedOrtGpuInstallCommand,
} from "@/lib/cudaDeps";
import { resolveQnnHostMode } from "@/lib/qnnDeps";
import {
  alwaysSelectableProviders,
  isExportTargetProvider,
  isPlatformLocalProvider,
} from "@/lib/providerRuntimeKind";

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

/** QNN 2.x plugin probe (isolated `.venvs/qnn`). */
export interface QnnProbeResult {
  available: boolean;
  /** True when preparation capability is usable (plugin + QNN EpDevice). */
  loadable?: boolean;
  pluginVersion?: string;
  pluginRegistered?: boolean;
  preparation?: boolean;
  /** OrtHardwareDeviceType.NPU filter (not CPU/emulator). */
  npuDevice?: boolean;
  potentialInference?: boolean;
  /** Only true after Snapdragon release gate + cached HTP diagnostic. */
  verifiedInference?: boolean;
  htpSmoke?: {
    status: "not_run" | "passed" | "failed";
    detail?: string;
    at?: string;
  };
  hostMode?: "local-inference" | "preparation" | "out-of-scope";
  providers?: string[];
  deviceTypes?: string[];
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
  openvino?: OpenVinoProbeResult;
  qnn?: QnnProbeResult;
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
  DmlExecutionProvider: "DmlExecutionProvider",
  OpenVINOExecutionProvider: "OpenVINOExecutionProvider",
  QNNExecutionProvider: "QNNExecutionProvider",
  ROCMExecutionProvider: "ROCMExecutionProvider",
  WebGpuExecutionProvider: "WebGpuExecutionProvider",
  // Browser / OWR spellings are not local Python EPs; map if a probe ever reports them.
  WebGPUExecutionProvider: "WebGpuExecutionProvider",
  CoreMLExecutionProvider: "CoreMLExecutionProvider",
  NNAPIExecutionProvider: "NNAPIExecutionProvider",
  NnapiExecutionProvider: "NNAPIExecutionProvider",
  VitisAIExecutionProvider: "VitisAIExecutionProvider",
  SNPEExecutionProvider: "SNPEExecutionProvider",
  TensorflowLiteExecutionProvider: "TensorflowLiteExecutionProvider",
  XnnpackExecutionProvider: "XnnpackExecutionProvider",
  WasmExecutionProvider: "WasmExecutionProvider",
};

/**
 * Windows-first QNN host soft-compat: Win ARM64 (inference) or Win x64 (preparation).
 * Runtime signals (loadable / ORT-reported QNN) never override an out-of-scope host.
 */
export function computeQnnCompatibleHardware(input: {
  os: string;
  arch: string;
  qnnLoadable?: boolean;
  ortReportsQnn?: boolean;
}): boolean {
  const hostMode = resolveQnnHostMode({
    platform: computeDirectMlHardwareReady({ os: input.os }) ? "win32" : "linux",
    arch: input.arch,
  });
  if (hostMode === "out-of-scope") return false;
  return true;
}

export function mapOrtProvidersToIhv(providers: string[]): IHVProvider[] {
  const found = new Set<IHVProvider>();
  for (const provider of providers) {
    const mapped = ORT_PROVIDER_MAP[provider];
    if (mapped) found.add(mapped);
  }
  return Array.from(found);
}

/**
 * Whether local hardware can usefully run OpenVINO acceleration.
 *
 * Requires an Intel CPU (vendor-qualified), an Intel GPU/NPU name from host
 * enumeration, or OpenVINO already reporting GPU/NPU devices. Does not use
 * NVIDIA GPU lists (Arc never appears there) and does not match AMD
 * "N-Core Processor" strings via a bare `Core` token.
 */
export function computeOpenVinoCompatibleHardware(input: {
  cpuModel: string;
  intelGpuNames?: string[];
  openvinoDevices?: string[];
}): boolean {
  const hasIntelCpu = /\bIntel\b|\bXeon\b/i.test(input.cpuModel);
  const hasIntelGpu = (input.intelGpuNames ?? []).some((name) => /Intel/i.test(name));
  const hasIntelOpenVinoDevices =
    (input.openvinoDevices ?? []).some((device) => /GPU|NPU/i.test(device));
  return hasIntelCpu || hasIntelGpu || hasIntelOpenVinoDevices;
}

/**
 * Whether the host is DirectML / DirectX 12 class capable for recipe gating.
 * Windows 10+ ships DX12; we do not probe adapter creation here. EP registration
 * (`DmlExecutionProvider` in ORT) remains separate for install guidance.
 *
 * Matches win32 / Windows / Windows_NT tokens without treating "darwin" as Windows.
 */
export function computeDirectMlHardwareReady(input: { os: string }): boolean {
  const os = input.os.toLowerCase();
  return /\bwin(?:dows(?:_nt)?|32|64)?\b/.test(os) || os.includes("win32") || os.includes("windows");
}

/**
 * True when Hardware should offer DirectML one-click install: DX12-class host
 * and DmlExecutionProvider not yet registered in the probe.
 */
export function computeDirectMlNeedsInstall(
  probe: HardwareProbeResult | null | undefined,
): boolean {
  if (!probe?.platform?.os) return false;
  return (
    computeDirectMlHardwareReady({ os: probe.platform.os }) &&
    !isProviderDetectedLocally("DmlExecutionProvider", probe)
  );
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
  /** True when onnxruntime reports DmlExecutionProvider (not merely Windows). */
  hasDirectMl?: boolean;
  /** Soft-detect QNN on Windows ARM64/x64 or when the qnn family is loadable. */
  hasQnnCompatibleHardware?: boolean;
  qnnLoadable?: boolean;
  tensorRtLoadable?: boolean;
  tensorRtRtxLoadable?: boolean;
  nvidiaTensorRtFamilyCapable?: boolean;
  cudaLoadable?: boolean;
}): IHVProvider[] {
  const detected = new Set<IHVProvider>(["CPUExecutionProvider"]);
  const tensorRtOk = input.tensorRtLoadable === true;
  const tensorRtRtxOk = input.tensorRtRtxLoadable === true;
  const cudaOk = input.cudaLoadable !== false;
  const tensorRtFamilyCapable = input.nvidiaTensorRtFamilyCapable ?? true;

  if (input.onnxRuntimeProviders?.length) {
    for (const provider of mapOrtProvidersToIhv(input.onnxRuntimeProviders)) {
      if (provider === "QNNExecutionProvider") {
        // Host-boundary soft-detect below owns QNN; do not trust ORT listing alone.
        continue;
      }
      if (provider === "TensorrtExecutionProvider" && !tensorRtOk) {
        continue;
      }
      if (provider === "NvTensorRTRTXExecutionProvider" && !tensorRtRtxOk) {
        continue;
      }
      if (provider === "TensorrtExecutionProvider" || provider === "NvTensorRTRTXExecutionProvider") {
        if (!tensorRtFamilyCapable) continue;
      }
      if (provider === "CUDAExecutionProvider" && !cudaOk) {
        continue;
      }
      detected.add(provider);
    }
  }

  if (input.hasNvidiaGpu) {
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
  if (input.hasOpenVino || input.hasOpenVinoCompatibleHardware) {
    detected.add("OpenVINOExecutionProvider");
  }
  if (input.hasDirectMl) {
    detected.add("DmlExecutionProvider");
  }
  if (input.hasQnnCompatibleHardware) {
    detected.add("QNNExecutionProvider");
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
  opts?: {
    tensorRtRtxLoadable?: boolean;
    tensorRtLoadable?: boolean;
    openvinoLoadable?: boolean;
    qnnLoadable?: boolean;
  },
): IHVProvider {
  // Prefer installed acceleration stacks; otherwise CUDA is the safe NVIDIA default.
  const priority: IHVProvider[] = [
    ...(opts?.tensorRtRtxLoadable ? (["NvTensorRTRTXExecutionProvider"] as const) : []),
    ...(opts?.tensorRtLoadable ? (["TensorrtExecutionProvider"] as const) : []),
    ...(opts?.qnnLoadable ? (["QNNExecutionProvider"] as const) : []),
    "CUDAExecutionProvider",
    "NvTensorRTRTXExecutionProvider",
    "TensorrtExecutionProvider",
    "ROCMExecutionProvider",
    "DmlExecutionProvider",
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
    case "QNNExecutionProvider": {
      if (!probe) {
        return "Qualcomm QNN requires Windows ARM64 (Snapdragon NPU inference) or Windows x64 (plugin preparation).";
      }
      const mode = probe.qnn?.hostMode;
      if (mode === "out-of-scope") {
        return "QNN plugin install/UX is Windows-first in this Studio release (Win ARM64 inference / Win x64 preparation).";
      }
      if (probe.qnn?.loadable === true) {
        return "QNN runtime is installed but not listed as selectable yet — refresh the hardware probe.";
      }
      if (mode === "preparation") {
        return "Windows x64 QNN preparation: install the QNN runtime (.venvs/qnn with onnxruntime + onnxruntime-qnn) from Hardware. Local HTP inference is not claimed on x64.";
      }
      if (mode === "local-inference") {
        return "Windows ARM64 Snapdragon: install the QNN runtime (.venvs/qnn) from Hardware. “QNN NPU ready” requires the Snapdragon release gate + HTP diagnostic.";
      }
      return "Qualcomm QNN requires Windows ARM64 (Snapdragon NPU) or Windows x64 (plugin preparation). Install from Hardware when this host is in scope.";
    }
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
    case "CoreMLExecutionProvider":
      return "Apple CoreML was not detected (requires macOS/iOS onnxruntime with CoreMLExecutionProvider). You can still select it for recipe export; Execute Live needs a probe hit.";
    case "VitisAIExecutionProvider":
      return "AMD/Xilinx Vitis AI was not detected (requires a Vitis AI ORT build). You can still select it for recipe export; Execute Live needs a probe hit.";
    case "NNAPIExecutionProvider":
      return "Android NNAPI is an OWR / mobile export target, not a local Python EP.";
    case "SNPEExecutionProvider":
      return "Qualcomm SNPE is a legacy export path (prefer QNN). Not available for Studio Execute Live.";
    case "TensorflowLiteExecutionProvider":
      return "TensorFlow Lite is a conversion/export path, not a local Olive Execute Live EP.";
    case "XnnpackExecutionProvider":
      return "XNNPACK is an OWR / ORT Mobile CPU export target, not a local Python EP.";
    case "WasmExecutionProvider":
      return "WASM is an ONNX Runtime Web CPU export target, not a local Python EP.";
    case "DmlExecutionProvider":
      return "Windows DirectML was not detected (requires Windows + onnxruntime-directml in the default .venv). Use Install in Hardware.";
    case "CPUExecutionProvider":
      return "";
    default: {
      const unreachable: never = provider;
      return `Execution provider not available on this machine (${unreachable}).`;
    }
  }
}

/**
 * Providers the user may select after local hardware detection.
 * Export targets (WebGPU, OWR mobile/web, TFLite, SNPE) are always choosable
 * even when absent from `detectedProviders` — they are not local Python EPs,
 * so missing them from the probe must never look like a failed detection.
 */
export function getSelectableProviders(probe: HardwareProbeResult | null | undefined): IHVProvider[] {
  const extras = alwaysSelectableProviders();
  if (!probe) {
    return Array.from(new Set<IHVProvider>(["CPUExecutionProvider", ...extras]));
  }
  return Array.from(new Set<IHVProvider>([...probe.detectedProviders, ...extras]));
}

/**
 * Block selection when a provider is absent from the local probe.
 * Export targets never return a block (selectable without “not detected”).
 */
export function getProviderAvailabilityBlock(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
): { reason: string } | null {
  // Export targets (incl. WebGPU) are not local Python EPs to probe.
  if (isExportTargetProvider(provider)) {
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
