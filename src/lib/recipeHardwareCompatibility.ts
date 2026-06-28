import { isNvTensorRtRtxCatalogPath } from "@/lib/tensorrtRtxDeps";
import { getCatalogDeviceFromRecipe, type RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import {
  type HardwareProbeResult,
  isProviderDetectedLocally,
} from "@/lib/hardwareProbe";
import type { IHVProvider } from "@/types";

export type RecipeHardwareCompatTier = "compatible" | "unavailable" | "unknown";

export interface RecipeHardwareCompatResult {
  tier: RecipeHardwareCompatTier;
  targetDevice: string;
  reason: string;
  /** Primary EP this recipe expects on this machine. */
  requiredProvider?: IHVProvider;
}

function isWindowsProbe(probe: HardwareProbeResult): boolean {
  return probe.platform.os.toLowerCase().includes("win");
}

function catalogDeviceToProvider(device: string): IHVProvider | undefined {
  switch (device) {
    case "CUDA":
      return "CUDAExecutionProvider";
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
    default:
      return undefined;
  }
}

export function resolveRecipeTargetDevice(
  item: RecipeCatalogItem,
  parsedRecipe?: unknown,
): string {
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
    if (isWindowsProbe(probe)) {
      return {
        tier: "compatible",
        targetDevice,
        reason: "DirectML targets Windows — this host qualifies.",
      };
    }
    return {
      tier: "unavailable",
      targetDevice,
      reason: "DirectML recipes require Windows. This host is not Windows.",
    };
  }

  if (targetDevice === "QNN") {
    if (isProviderDetectedLocally("QNNExecutionProvider", probe)) {
      return {
        tier: "compatible",
        targetDevice,
        reason: "Qualcomm QNN / Hexagon NPU detected.",
        requiredProvider: "QNNExecutionProvider",
      };
    }
    return {
      tier: "unavailable",
      targetDevice,
      reason: "QNN requires Snapdragon / Hexagon dev hardware (not detected on this desktop).",
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

  if (isProviderDetectedLocally(requiredProvider, probe)) {
    const gpuHint =
      probe.nvidia?.gpus[0]?.name ??
      probe.rocm?.gpus[0]?.name ??
      probe.platform.cpuModel;
    return {
      tier: "compatible",
      targetDevice,
      reason: `${targetDevice} backend available (${gpuHint}).`,
      requiredProvider,
    };
  }

  const detected = probe.detectedProviders
    .map((p) => p.replace("ExecutionProvider", ""))
    .join(", ");

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
