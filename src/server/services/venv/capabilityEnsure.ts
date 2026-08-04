/**
 * Provider → family ensure + capability-specific package preparation.
 */
import type { IHVProvider } from "../../../types.ts";
import {
  humanFamilyLabel,
  resolveVenvFamily,
  type VenvFamily,
} from "../../../lib/venvFamily.ts";
import { ensureVenvFamily } from "./familyEnsure.ts";
import { getVenvPython } from "./paths.ts";
import {
  capabilityForProvider,
  familyFlagsFromStatus,
  getDualRuntimeStatus,
  invalidateRuntimeStatusCache,
  probeFamilyStatus,
} from "./status.ts";

type SetupListener = (line: string) => void;

export type EnsureProviderCapabilityResult = {
  ok: boolean;
  error?: string;
  family: VenvFamily;
  python: string | null;
};

/**
 * Ensure the correct venv family exists and the requested provider capability
 * is usable. Callers must have already normalized the provider ID.
 */
export async function ensureProviderCapability(
  provider: IHVProvider,
  onLine: SetupListener,
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
  const cap = capabilityForProvider(status, provider);

  // Providers without a capability slot (QNN/ROCm/WebGPU) only need the family base.
  if (cap === undefined) {
    return { ok: true, family, python: getVenvPython(family) };
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
  switch (provider) {
    case "CPUExecutionProvider":
    case "DmlExecutionProvider":
    case "QNNExecutionProvider":
    case "ROCMExecutionProvider":
    case "WebGpuExecutionProvider":
      return { ok: true };

    case "OpenVINOExecutionProvider": {
      const { ensureOpenVino } = await import("../olive/openvino.ts");
      const result = await ensureOpenVino(onLine);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    case "CUDAExecutionProvider": {
      const { ensureOnnxRuntimeGpu } = await import("../olive/cuda.ts");
      const result = await ensureOnnxRuntimeGpu(onLine);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    case "TensorrtExecutionProvider": {
      const { ensureTensorRt } = await import("../olive/tensorrt.ts");
      const result = await ensureTensorRt(onLine);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    case "NvTensorRTRTXExecutionProvider": {
      const { ensureTensorRtRtx } = await import("../olive/tensorrt-rtx.ts");
      const result = await ensureTensorRtRtx(onLine);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }

    default: {
      const _exhaustive: never = provider;
      return { ok: false, error: `Unsupported provider: ${_exhaustive}` };
    }
  }
}
