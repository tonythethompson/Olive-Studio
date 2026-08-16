/**
 * Provider → family ensure + capability-specific package preparation.
 */
import type { IHVProvider } from "../../../types.ts";
import { humanFamilyLabel, resolveVenvFamily, type VenvFamily } from "../../../lib/venvFamily.ts";
import { ensureOpenVino } from "../olive/openvino.ts";
import { ensureOnnxRuntimeGpu } from "../olive/cuda.ts";
import { ensureTensorRt } from "../olive/tensorrt.ts";
import { ensureTensorRtRtx } from "../olive/tensorrt-rtx.ts";
import { ensureQnn } from "../olive/qnn.ts";
import { ensureCoremltools } from "../olive/coreml.ts";
import { ensureMigraphx } from "../olive/migraphx.ts";
import { isQnnIhvProvider } from "../../../lib/qnnReadiness.ts";
import { ensureVenvFamily } from "./familyEnsure.ts";
import { isExportTargetProvider, isPlatformLocalProvider } from "../../../lib/providerRuntimeKind.ts";
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
  if (isExportTargetProvider(provider)) {
    return {
      ok: false,
      error: `${provider} cannot run via local Olive Python; export the recipe for the target runtime instead`,
      family: "default",
      python: null,
    };
  }

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

  // coremltools is macOS-only. On other hosts, skip package installation and
  // let the ORT provider check below return the actionable registration error.
  if (provider !== "CoreMLExecutionProvider" || dual.platform === "darwin") {
    const capResult = await installCapabilityPackages(provider, onLine);
    if (!capResult.ok) {
      return { ok: false, error: capResult.error, family, python: getVenvPython(family) };
    }
  }

  invalidateRuntimeStatusCache();
  const status = await probeFamilyStatus(family);
  const usage = opts?.usage ?? "inference";
  const cap = isQnnIhvProvider(provider)
    ? qnnCapabilityForUsage(status, usage)
    : capabilityForProvider(status, provider);

  // Providers without a capability slot:
  // - export targets are rejected above
  // - platform-local (CoreML/VitisAI) must appear in this family's ORT providers
  // - ROCm is best-effort on the default family base
  if (cap === undefined) {
    if (isPlatformLocalProvider(provider)) {
      const python = getVenvPython(family);
      if (!status.ortProviders.includes(provider)) {
        return {
          ok: false,
          error: `${provider} is not registered in ${humanFamilyLabel(family)} ORT; export the recipe or run on a host where the hardware probe detects it`,
          family,
          python,
        };
      }
      return { ok: true, family, python };
    }
    if (provider === "ROCMExecutionProvider") {
      return { ok: true, family, python: getVenvPython(family) };
    }

    // oneDNN: bundled in the default ORT wheel — no separate install needed.
    // Verify EP availability via the probed ORT providers list (already fetched
    // within the ORT probe timeout). If absent, the wheel lacks DNNL support.
    if (provider === "DnnlExecutionProvider") {
      const python = getVenvPython(family);
      if (status.ortProviders.includes("DnnlExecutionProvider")) {
        return { ok: true, family, python };
      }
      return {
        ok: false,
        error:
          "DnnlExecutionProvider is not registered by the installed ORT wheel. " +
          "Reinstall onnxruntime with oneDNN/DNNL support enabled (e.g. the official onnxruntime wheel built with --use_dnnl).",
        family,
        python,
      };
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
      error: cap.detail ?? `${provider} capability not usable in ${humanFamilyLabel(family)} (${cap.reason})`,
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
      case "NNAPIExecutionProvider":
      case "VitisAIExecutionProvider":
      case "SNPEExecutionProvider":
      case "TensorflowLiteExecutionProvider":
      case "XnnpackExecutionProvider":
      case "WasmExecutionProvider":
        return { ok: true };

      case "CoreMLExecutionProvider": {
        const result = await ensureCoremltools(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      // QNN ABI shares the QNN venv family / plugin stack with QNNExecutionProvider.
      case "QNNExecutionProvider":
      case "QnnAbiExecutionProvider": {
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

      // MIGraphX: Linux x64 only — ROCm + migraphx package
      case "MIGraphXExecutionProvider": {
        const result = await ensureMigraphx(onLine);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }

      // oneDNN: bundled in default ORT wheel — no additional install needed
      case "DnnlExecutionProvider":
        return { ok: true };

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
