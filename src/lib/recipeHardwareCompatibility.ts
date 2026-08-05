import {
  isNvTensorRtRtxCatalogPath,
  tensorrtRtxEpAbiInstallCommand,
} from "@/lib/tensorrtRtxDeps";
import { pinnedTensorRtInstallCommand } from "@/lib/tensorrtDeps";
import { getCatalogDeviceFromRecipe, type RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import {
  isNvidiaGpuTensorRtFamily,
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  type HardwareProbeResult,
  isProviderDetectedLocally,
  computeDirectMlHardwareReady,
  computeQnnCompatibleHardware,
} from "@/lib/hardwareProbe";
import {
  CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY,
  isPreMaxwellNvidiaBox,
  pinnedOrtGpuInstallCommand,
} from "@/lib/cudaDeps";
import { qnnStackInstallCommand, resolveQnnHostMode } from "@/lib/qnnDeps";
import type { IHVProvider } from "@/types";

export type RecipeHardwareCompatTier = "compatible" | "unavailable" | "unknown";

/**
 * When a recipe's target EP is GPU-capable on the current machine but the
 * Python runtime deps for that EP haven't been installed yet, surface a
 * targeted install hint instead of hiding the recipe. The recipe still
 * counts as hardware-compatible so `hideIncompatibleRecipes` does not drop it.
 */
export interface RecipeInstallHint {
  kind:
    | "tensorrt"
    | "tensorrt-rtx"
    | "onnxruntime-gpu"
    | "onnxruntime-directml"
    | "onnxruntime-qnn";
  /** Provider the recipe expects once deps land. */
  provider: IHVProvider;
  /** Underlying detail string from the probe (may be empty). */
  detail?: string;
  /** Human-friendly hint shown next to the recipe card. */
  hint: string;
  /** Ready-to-paste pip command for the install. */
  installCommand: string;
}

export interface RecipeHardwareCompatResult {
  tier: RecipeHardwareCompatTier;
  targetDevice: string;
  reason: string;
  /** Primary EP this recipe expects on this machine. */
  requiredProvider?: IHVProvider;
  /**
   * Set when this machine has the correct GPU but the runtime deps for the
   * recipe's EP aren't installed in `.venv` yet. UI shows an inline install
   * hint; recipe is still counted as `tier: "compatible"`.
   */
  requiresInstall?: RecipeInstallHint;
}

function ePInstallHint(args: {
  probe: HardwareProbeResult;
  requiredProvider: IHVProvider;
  kind: RecipeInstallHint["kind"];
  detailKey?: "tensorrt" | "tensorRtRtx" | "cuda" | "qnn";
  depLabel: string;
  installCommand: string;
  /** Override the "supported family" label (defaults to NVIDIA GPU or CPU model). */
  deviceLabel?: string;
}): RecipeInstallHint {
  const gpuHint =
    args.deviceLabel ?? args.probe.nvidia?.gpus[0]?.name ?? args.probe.platform.cpuModel;
  const detail = args.detailKey ? args.probe[args.detailKey]?.detail : undefined;
  return {
    kind: args.kind,
    provider: args.requiredProvider,
    detail,
    hint: detail
      ? `${args.depLabel} not in .venv (${detail}). Hardware is in the supported family (${gpuHint}) — install in Hardware then retry.`
      : `${args.depLabel} not in .venv yet. Hardware is in the supported family (${gpuHint}) — install in Hardware (step 02) to run this recipe.`,
    installCommand: args.installCommand,
  };
}

function catalogDeviceToProvider(device: string): IHVProvider | undefined {
  switch (device) {
    case "CUDA":
      return "CUDAExecutionProvider";
    case "DirectML":
      return "DmlExecutionProvider";
    case "TensorRT":
      return "TensorrtExecutionProvider";
    case "TensorRT RTX":
      return "NvTensorRTRTXExecutionProvider";
    case "OpenVINO":
      return "OpenVINOExecutionProvider";
    case "QNN":
      return "QNNExecutionProvider";
    case "CPU":
      return "CPUExecutionProvider";
    case "WebGPU":
      return "WebGpuExecutionProvider";
    default:
      return undefined;
  }
}

export function resolveRecipeTargetDevice(item: RecipeCatalogItem, parsedRecipe?: unknown): string {
  if (isNvTensorRtRtxCatalogPath(item.repoPath)) {
    return "TensorRT RTX";
  }
  return getCatalogDeviceFromRecipe(parsedRecipe) ?? item.device;
}

export function assessRecipeHardwareCompatibility(
  targetDevice: string,
  probe: HardwareProbeResult | null | undefined,
): RecipeHardwareCompatResult {
  if (!probe) {
    return {
      tier: "unknown",
      targetDevice,
      reason: "Hardware probe pending — compatibility not verified yet.",
    };
  }

  if (targetDevice === "CPU") {
    return {
      tier: "compatible",
      targetDevice,
      reason: "CPU execution is available on this machine.",
      requiredProvider: "CPUExecutionProvider",
    };
  }

  if (targetDevice === "DirectML") {
    // Hardware readiness (Windows / DX12 class) gates compatible vs unavailable.
    // EP registration separately drives the install hint.
    if (computeDirectMlHardwareReady({ os: probe.platform.os })) {
      if (isProviderDetectedLocally("DmlExecutionProvider", probe)) {
        return {
          tier: "compatible",
          targetDevice,
          reason: "DirectML backend available on Windows.",
          requiredProvider: "DmlExecutionProvider",
        };
      }
      return {
        tier: "compatible",
        targetDevice,
        reason: "DirectML targets Windows — install onnxruntime-directml in .venv to run this recipe.",
        requiredProvider: "DmlExecutionProvider",
        requiresInstall: ePInstallHint({
          probe,
          requiredProvider: "DmlExecutionProvider",
          kind: "onnxruntime-directml",
          depLabel: "onnxruntime-directml (DirectML EP wheel)",
          installCommand: "pip install onnxruntime-directml",
          deviceLabel: "Windows DirectX 12 adapter",
        }),
      };
    }
    return {
      tier: "unavailable",
      targetDevice,
      reason: "DirectML recipes require Windows. This host is not Windows.",
      requiredProvider: "DmlExecutionProvider",
    };
  }

  if (targetDevice === "QNN") {
    const hostMode = resolveQnnHostMode({
      platform: probe.platform.os.toLowerCase().includes("win") ? "win32" : "linux",
      arch: probe.platform.arch,
    });
    const qnnCompatible = computeQnnCompatibleHardware({
      os: probe.platform.os,
      arch: probe.platform.arch,
      qnnLoadable: probe.qnn?.loadable === true,
      ortReportsQnn: probe.onnxRuntimeProviders?.includes("QNNExecutionProvider"),
    });
    if (isProviderDetectedLocally("QNNExecutionProvider", probe) || qnnCompatible) {
      if (probe.qnn?.loadable === true) {
        return {
          tier: "compatible",
          targetDevice,
          reason:
            hostMode === "preparation"
              ? "QNN runtime installed for Windows x64 preparation / plugin AOT (not local HTP inference)."
              : probe.qnn.npuDevice
                ? "QNN runtime installed with NPU EpDevice (verified “QNN NPU ready” gated separately)."
                : "QNN runtime installed (.venvs/qnn).",
          requiredProvider: "QNNExecutionProvider",
        };
      }
      if (hostMode === "out-of-scope") {
        return {
          tier: "unavailable",
          targetDevice,
          reason:
            "QNN plugin install/UX is Windows-first in this Studio release (Win ARM64 inference / Win x64 preparation).",
          requiredProvider: "QNNExecutionProvider",
        };
      }
      return {
        tier: "compatible",
        targetDevice,
        reason:
          hostMode === "preparation"
            ? "Windows x64 can prepare QNN plugin / AOT recipes — install .venvs/qnn first."
            : "Windows ARM64 Snapdragon host can run QNN — install .venvs/qnn first.",
        requiredProvider: "QNNExecutionProvider",
        requiresInstall: ePInstallHint({
          probe,
          requiredProvider: "QNNExecutionProvider",
          kind: "onnxruntime-qnn",
          detailKey: "qnn",
          depLabel: "QNN runtime (onnxruntime + onnxruntime-qnn plugin in .venvs/qnn)",
          installCommand: qnnStackInstallCommand(),
          deviceLabel:
            hostMode === "preparation"
              ? "Windows x64 (preparation / AOT)"
              : "Windows ARM64 Snapdragon NPU",
        }),
      };
    }
    return {
      tier: "unavailable",
      targetDevice,
      reason:
        "QNN requires Windows ARM64 (Snapdragon NPU inference) or Windows x64 (plugin preparation). Not detected on this host.",
      requiredProvider: "QNNExecutionProvider",
    };
  }

  const requiredProvider = catalogDeviceToProvider(targetDevice);
  if (!requiredProvider) {
    return {
      tier: "unknown",
      targetDevice,
      reason: `Unknown catalog device tag "${targetDevice}".`,
    };
  }

  const hasNvidia = Boolean(probe.nvidia?.gpus.length);
  const gpuHint = probe.nvidia?.gpus[0]?.name ?? probe.rocm?.gpus[0]?.name ?? probe.platform.cpuModel;
  // Pre-Turing NVIDIA GPUs (Maxwell/Pascal/Kepler, SM < 7.5) cannot execute
  // TensorRT 10.x or TensorRT-RTX — installing the SDK does not change that.
  // Surface as unavailable with no install hint so the user does not waste
  // time on a one-click install that cannot possibly succeed. Mixed-GPU
  // boxes (one pre-Turing, one modern) are still treated as supported —
  // `isNvidiaGpuTensorRtFamily` is true if at least one GPU meets the floor.
  const isPreTuringNvidiaBox =
    hasNvidia &&
    Boolean(probe.nvidia) &&
    !probe.nvidia!.gpus.some((g) => isNvidiaGpuTensorRtFamily(g));
  const smFloor = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;
  // Pre-Maxwell NVIDIA GPUs (Kepler SM 3.x, sm < 5.0) cannot execute modern
  // CUDA 12 builds — the toolkit floor dropped SM 3.x with CUDA 12.0.
  // Mirror the pre-Turing short-circuit: the install hint would point the
  // user at a one-click install that cannot possibly succeed.
  const isPreMaxwellBox =
    hasNvidia && Boolean(probe.nvidia) && isPreMaxwellNvidiaBox(probe.nvidia!.gpus);
  const cudaSmFloor = `${CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.major}.${CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.minor}`;

  if (isProviderDetectedLocally(requiredProvider, probe)) {
    return {
      tier: "compatible",
      targetDevice,
      reason: `${targetDevice} backend available (${gpuHint}).`,
      requiredProvider,
    };
  }

  if (isPreTuringNvidiaBox && (requiredProvider === "TensorrtExecutionProvider" || requiredProvider === "NvTensorRTRTXExecutionProvider")) {
    return {
      tier: "unavailable",
      targetDevice,
      reason: `${targetDevice} requires NVIDIA compute capability ≥ ${smFloor} (Turing / RTX 20xx+); ${gpuHint} is below that floor. TensorRT 10.x and TensorRT-RTX cannot execute on Maxwell/Pascal/Kepler.`,
      requiredProvider,
    };
  }

  // Pre-Maxwell NVIDIA short-circuit for CUDA recipes. Every detected NVIDIA
  // GPU is below the CUDA 12 toolkit floor (SM 5.0 / Maxwell) and cannot
  // execute modern CUDA — surfacing as unavailable prevents the user from
  // chasing one-click installs that cannot succeed.
  if (
    isPreMaxwellBox &&
    targetDevice === "CUDA" &&
    requiredProvider === "CUDAExecutionProvider"
  ) {
    return {
      tier: "unavailable",
      targetDevice,
      // CUDA-floor copy must track Maxwell SM 5.0: GTX 750 Ti / GTX 9xx
      // are the canonical Maxwell product IDs; the previous wording
      // borrowed "GeForce RTX 20xx+" from the pre-Turing branch (RTX 20xx
      // is Turing SM 7.5, the floor above) and would have told a Pascal
      // SM 6.x owner their supported card is unsupported.
      reason: `CUDA requires NVIDIA compute capability ≥ ${cudaSmFloor} (Maxwell / GeForce GTX 750 Ti or GTX 9xx series and newer); ${gpuHint} is below that floor. The CUDA 12 toolkit drops SM 3.x (Kepler) support and modern Olive recipes cannot run on those cards. Use the CPU provider, or upgrade hardware.`,
      requiredProvider,
    };
  }

  // 🟢 Hardware-compatible fallback: the GPU on this machine is in the
  // TensorRT-supported family (NVIDIA, SM 7.5+ for TRT 10.x / RTX 30xx+
  // for TRT-RTX), but the Python deps for the recipe's EP haven't landed in
  // .venv yet. Treat the recipe as compatible so `hideIncompatibleRecipes`
  // doesn't drop it, but expose an install hint so the user knows one click
  // in Hardware (step 02) will close the gap.
  // Pre-Turing NVIDIA boxes skip this fallback (see isPreTuringNvidiaBox)
  // so the hint is never shown for cards that cannot run the EP at all.
  if (
    !isPreTuringNvidiaBox &&
    requiredProvider === "TensorrtExecutionProvider" &&
    hasNvidia &&
    probe.tensorrt?.loadable === false
  ) {
    return {
      tier: "compatible",
      targetDevice,
      reason: `TensorRT backend available on ${gpuHint} after installing tensorrt in .venv.`,
      requiredProvider,
      requiresInstall: ePInstallHint({
        probe,
        requiredProvider,
        kind: "tensorrt",
        detailKey: "tensorrt",
        depLabel: "tensorrt SDK (nvinfer_10)",
        installCommand: pinnedTensorRtInstallCommand(),
      }),
    };
  }
  if (
    !isPreTuringNvidiaBox &&
    requiredProvider === "NvTensorRTRTXExecutionProvider" &&
    hasNvidia &&
    probe.tensorRtRtx?.loadable === false
  ) {
    // (Pre-Turing check above already short-circuits to unavailable; this branch
    // is only reached for SM ≥ 7.5 GPUs with EP-ABI plugin not yet installed.)
    return {
      tier: "compatible",
      targetDevice,
      reason: `TensorRT RTX backend available on ${gpuHint} after installing tensorrt-rtx in .venv.`,
      requiredProvider,
      requiresInstall: ePInstallHint({
        probe,
        requiredProvider,
        kind: "tensorrt-rtx",
        detailKey: "tensorRtRtx",
        depLabel: "tensorrt-rtx (NVIDIA EP-ABI plugin)",
        installCommand: tensorrtRtxEpAbiInstallCommand(),
      }),
    };
  }

  // 🟢 Hardware-compatible fallback: NVIDIA driver + compute capability are
  // fine, but `onnxruntime-gpu` isn't installed (or the CUDA EP failed to
  // register) in `.venv` yet. Surface the recipe as compatible so
  // `hideIncompatibleRecipes` does not drop it, but expose the install
  // hint so the user knows one click in Hardware (step 02) closes the gap.
  // Pre-Maxwell boxes skip this fallback (see isPreMaxwellBox) so the hint
  // is never shown for cards that cannot run the EP at all.
  //
  // We use `isProviderDetectedLocally` (not a direct `onnxRuntimeProviders`
  // check) because the route handler strips `CUDAExecutionProvider` from
  // `detectedProviders` when `mergeDetectedProviders(...)` is given
  // `cudaLoadable: false` — so this gate fires in lockstep with the UI.
  if (
    !isPreMaxwellBox &&
    requiredProvider === "CUDAExecutionProvider" &&
    hasNvidia &&
    !isProviderDetectedLocally("CUDAExecutionProvider", probe)
  ) {
    return {
      tier: "compatible",
      targetDevice,
      reason: `CUDA backend available on ${gpuHint} after installing onnxruntime-gpu in .venv.`,
      requiredProvider,
      requiresInstall: ePInstallHint({
        probe,
        requiredProvider,
        kind: "onnxruntime-gpu",
        detailKey: "cuda",
        depLabel: "onnxruntime-gpu (CUDA EP wheel)",
        installCommand: pinnedOrtGpuInstallCommand(),
      }),
    };
  }

  const detected = probe.detectedProviders.map((p) => p.replace("ExecutionProvider", "")).join(", ");

  return {
    tier: "unavailable",
    targetDevice,
    reason: `Requires ${targetDevice} (${requiredProvider.replace("ExecutionProvider", "")}) — detected on this machine: ${detected || "CPU only"}.`,
    requiredProvider,
  };
}

export function assessCatalogItemHardwareCompatibility(
  item: RecipeCatalogItem,
  probe: HardwareProbeResult | null | undefined,
  parsedRecipe?: unknown,
): RecipeHardwareCompatResult {
  const targetDevice = resolveRecipeTargetDevice(item, parsedRecipe);
  return assessRecipeHardwareCompatibility(targetDevice, probe);
}

export function summarizeRecipeHardwareCompatibility(
  items: RecipeCatalogItem[],
  probe: HardwareProbeResult | null | undefined,
): { compatible: number; unavailable: number; unknown: number } {
  let compatible = 0;
  let unavailable = 0;
  let unknown = 0;
  for (const item of items) {
    const tier = assessCatalogItemHardwareCompatibility(item, probe).tier;
    if (tier === "compatible") compatible += 1;
    else if (tier === "unavailable") unavailable += 1;
    else unknown += 1;
  }
  return { compatible, unavailable, unknown };
}
