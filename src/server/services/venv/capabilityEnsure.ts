/**
 * Provider → family ensure + capability-specific package preparation.
 */
import type { IHVProvider } from "../../../types.ts";
import {
  humanFamilyLabel,
  resolveVenvFamily,
  type VenvFamily,
} from "../../../lib/venvFamily.ts";
import { ensureOpenVino } from "../olive/openvino.ts";
import { ensureOnnxRuntimeGpu } from "../olive/cuda.ts";
import { ensureTensorRt } from "../olive/tensorrt.ts";
import { ensureTensorRtRtx } from "../olive/tensorrt-rtx.ts";
import { ensureQnn } from "../olive/qnn.ts";
import { ensureVenvFamily } from "./familyEnsure.ts";
import { getVenvPython } from "./paths.ts";
import {
  capabilityForProvider,
  familyFlagsFromStatus,
  getDualRuntimeStatus,
  invalidateRuntimeStatusCache,
  probeFamilyStatus,
  type CapabilityStatus,
} from "./status.ts";

type SetupListener = (line: string) => void;

export type ProviderCapabilityUsage = "inference" | "preparation";

export type EnsureProviderCapabilityOptions = {
  /**
   * QNN splits preparation (plugin AOT / x64) vs inference (Win ARM64 NPU).
   * Other providers ignore this today.
   */
  usage?: ProviderCapabilityUsage;
};

export type EnsureProviderCapabilityResult = {
  ok: boolean;
  error?: string;
  family: VenvFamily;
  python: string | null;
};

function qnnCapabilityForUsage(
  status: Awaited<ReturnType<typeof probeFamilyStatus>>,
  usage: ProviderCapabilityUsage,
): CapabilityStatus | undefined {
  if (usage === "preparation") return status.capabilities.qnnPreparation;
  // Fail-closed: inference must not fall back to preparation capability.
  return status.capabilities.qnnInference;
}

/**
 * Ensure the correct venv family exists and the requested provider capability
 * is usable. Callers must have already normalized the provider ID.
 */
export async function ensureProviderCapability(
  provider: IHVProvider,
  onLine: SetupListener,
  opts?: EnsureProviderCapabilityOptions,
): Promise<EnsureProviderCapabilityResult> {
  const dual = await getDualRuntimeStatus({ force: true });
  const flags = familyFlagsFromStatus(dual.families);
  const family = resolveVenvFamily(provider, flags);
  onLine(`[setup] Using ${humanFamilyLabel(family)}`);

  const familyResult = await ensureVenvFamily(family, onLine);
  if (!familyResult.ok) {
    return {
      ok: false,
      error: familyResult.error ?? `Failed to prepare ${humanFamilyLabel(family)}`,
      family,
      python: null,
    };
  }

  const capResult = await installCapabilityPackages(provider, onLine);
  if (!capResult.ok) {
    return { ok: false, error: capResult.error, family, python: getVenvPython(family) };
  }

  invalidateRuntimeStatusCache();
  const status = await probeFamilyStatus(family);
  const usage = opts?.usage ?? "inference";
  const cap =
    provider === "QNNExecutionProvider"
      ? qnnCapabilityForUsage(status, usage)
      : capabilityForProvider(status, provider);

  // Providers without a capability slot (ROCm/WebGPU/export/platform) only need the family base.
  if (cap === undefined) {
    if (
      provider === "ROCMExecutionProvider" ||
      provider === "WebGpuExecutionProvider" ||
      provider === "CoreMLExecutionProvider" ||
      provider === "NNAPIExecutionProvider" ||
      provider === "VitisAIExecutionProvider" ||
      provider === "SNPEExecutionProvider" ||
      provider === "TensorflowLiteExecutionProvider" ||
      provider === "XnnpackExecutionProvider" ||
      provider === "WasmExecutionProvider"
    ) {
      return { ok: true, family, python: getVenvPython(family) };
    }
    return {
      ok: false,
      error: `Provider ${provider} has no capability slot in ${humanFamilyLabel(family)} (status mismatch)`,
      family,
      python: getVenvPython(family),
    };
  }
  if (!cap.usable) {
    return {
      ok: false,
      error:
        cap.detail ??
        `${provider} capability not usable in ${humanFamilyLabel(family)} (${cap.reason})`,
      family,
      python: getVenvPython(family),
    };
  }

  return { ok: true, family, python: getVenvPython(family) };
}

async function installCapabilityPackages(
  provider: IHVProvider,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (provider) {
      case "CPUExecutionProvider":
      case "DmlExecutionProvider":
      case "ROCMExecutionProvider":
      case "WebGpuExecutionProvider":
      case "CoreMLExecutionProvider":
      case "NNAPIExecutionProvider":
      case "VitisAIExecutionProvider":
      case "SNPEExecutionProvider":
      case "TensorflowLiteExecutionProvider":
      case "XnnpackExecutionProvider":
      case "WasmExecutionProvider":
        return { ok: true };

      case "QNNExecutionProvider": {
        const result = await ensureQnn(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      case "OpenVINOExecutionProvider": {
        const result = await ensureOpenVino(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      case "CUDAExecutionProvider": {
        const result = await ensureOnnxRuntimeGpu(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      case "TensorrtExecutionProvider": {
        const result = await ensureTensorRt(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      case "NvTensorRTRTXExecutionProvider": {
        const result = await ensureTensorRtRtx(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      default: {
        const _exhaustive: never = provider;
        return { ok: false, error: `Unsupported provider: ${_exhaustive}` };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
