/**
 * QNN HTP shape / model-readiness validation and fail-closed retry helpers.
 *
 * Hard failures: unresolved dynamic shapes for HTP; no QNN NPU when inference
 * intended; registration failure. Warnings: FP where QDQ is preferable.
 * SDK-backed Olive passes stay gated separately from plugin prep/inference.
 */
import type { IHVProvider, UIState } from "@/types";
import {
  QNN_ADVANCED_QAIRT_DOCS_URL,
  isQnnSnapdragonReleaseGatePassed,
  resolveQnnHostMode,
  type QnnHostMode,
} from "@/lib/qnnDeps";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

export type QnnReadinessSeverity = "error" | "warning" | "info";

export type QnnReadinessIssue = {
  severity: QnnReadinessSeverity;
  code: string;
  message: string;
};

/** Olive passes that still require external QAIRT SDK (`QNN_SDK_ROOT`). */
export const QNN_SDK_BACKED_PASS_NAMES = [
  "QNNConversion",
  "QNNModelLibGenerator",
  "QNNContextBinaryGenerator",
] as const;

/** Plugin-based passes that do not imply a full QAIRT SDK install. */
export const QNN_PLUGIN_PASS_NAMES = [
  "QNNPreprocess",
  "OnnxQuantization",
  "OnnxStaticQuantization",
  "EPContextBinaryGenerator",
] as const;

export function isQnnSdkBackedPass(passName: string): boolean {
  return (QNN_SDK_BACKED_PASS_NAMES as readonly string[]).includes(passName);
}

/** True for QNN plugin EP and QNN ABI EP (shared readiness / venv family). */
export function isQnnIhvProvider(provider: IHVProvider): boolean {
  return provider === "QNNExecutionProvider" || provider === "QnnAbiExecutionProvider";
}

/** True when a dim is dynamic / symbolic (unresolved for HTP). */
export function isUnresolvedDynamicDim(dim: unknown): boolean {
  if (dim === null || dim === undefined) return true;
  if (typeof dim === "string") {
    const trimmed = dim.trim();
    if (!trimmed) return true;
    if (/^\d+$/.test(trimmed)) return false;
    return true;
  }
  if (typeof dim === "number") {
    return !Number.isFinite(dim) || dim <= 0;
  }
  return true;
}

export function modelIoHasUnresolvedDynamicShapes(ioConfig: unknown): boolean {
  if (!ioConfig || typeof ioConfig !== "object") return false;
  const cfg = ioConfig as {
    input_shapes?: unknown;
    output_shapes?: unknown;
    input_names?: unknown;
  };
  const shapes = [cfg.input_shapes, cfg.output_shapes].filter(Boolean);
  for (const block of shapes) {
    if (!Array.isArray(block)) continue;
    for (const shape of block) {
      if (!Array.isArray(shape)) continue;
      if (shape.some((d) => isUnresolvedDynamicDim(d))) return true;
    }
  }
  return false;
}

export function qnnQuantizationRecommendation(state: Pick<UIState, "passes">): QnnReadinessIssue | null {
  if (!state.passes.quantization) {
    return {
      severity: "warning",
      code: "qnn_fp_model",
      message:
        "FP models often under-utilize HTP. Prefer ONNX QDQ / PTQ preprocessing for QNN deployment coverage.",
    };
  }
  if (state.passes.quantMethod && state.passes.quantMethod !== "ptq") {
    return {
      severity: "warning",
      code: "qnn_quant_method",
      message: `QNN targets support PTQ-style ONNX quantization in Studio; ${state.passes.quantMethod} is not the preferred path.`,
    };
  }
  return null;
}

export function assessQnnRecipeReadiness(input: {
  state: Pick<UIState, "ihvProvider" | "passes">;
  /** Optional Olive io_config / shape block for HTP static-shape checks. */
  ioConfig?: unknown;
  probe?: HardwareProbeResult | null;
  hostMode?: QnnHostMode;
  platform?: { platform: NodeJS.Platform | string; arch: string };
}): QnnReadinessIssue[] {
  if (!isQnnIhvProvider(input.state.ihvProvider)) return [];

  const issues: QnnReadinessIssue[] = [];
  const mode =
    input.hostMode ??
    input.probe?.qnn?.hostMode ??
    (input.platform
      ? resolveQnnHostMode(input.platform)
      : resolveQnnHostMode({
          platform: typeof process !== "undefined" ? process.platform : "linux",
          arch: typeof process !== "undefined" ? process.arch : "x64",
        }));

  if (mode === "out-of-scope") {
    issues.push({
      severity: "error",
      code: "qnn_out_of_scope",
      message:
        "QNN workflows are Windows-first in this release (Win ARM64 inference / Win x64 preparation).",
    });
    return issues;
  }

  if (mode === "preparation") {
    issues.push({
      severity: "info",
      code: "qnn_prep_only",
      message:
        "Windows x64: plugin preparation / AOT only. Local HTP inference is not claimed. SDK-backed Olive passes still need QAIRT separately.",
    });
  }

  if (input.ioConfig !== undefined && modelIoHasUnresolvedDynamicShapes(input.ioConfig)) {
    issues.push({
      severity: "error",
      code: "qnn_dynamic_shapes",
      message:
        "Unresolved dynamic shapes are a hard failure for HTP. Fix static shapes / io_config before a QNN inference session.",
    });
  }

  if (mode === "local-inference") {
    if (input.probe && !input.probe.qnn?.npuDevice) {
      issues.push({
        severity: "error",
        code: "qnn_npu_missing",
        message:
          "No QNN OrtEpDevice with OrtHardwareDeviceType.NPU. CPU/emulator QNN devices do not satisfy inference readiness.",
      });
    } else if (
      input.probe?.qnn?.npuDevice &&
      (!isQnnSnapdragonReleaseGatePassed() || !input.probe.qnn.verifiedInference)
    ) {
      issues.push({
        severity: "warning",
        code: "qnn_npu_unverified",
        message:
          "QNN runtime / NPU device present. UI will not claim “QNN NPU ready” until the Snapdragon release gate and cached HTP diagnostic pass.",
      });
    }
  }

  if (input.probe && input.probe.qnn?.loadable !== true) {
    issues.push({
      severity: "error",
      code: "qnn_runtime_missing",
      message:
        "QNN runtime not ready in .venvs/qnn. Install onnxruntime==1.26.0 + onnxruntime-qnn==2.4.0 from Hardware.",
    });
  }

  const quant = qnnQuantizationRecommendation(input.state);
  if (quant) issues.push(quant);

  issues.push({
    severity: "info",
    code: "qnn_fail_closed",
    message:
      "QNN sessions are fail-closed (no automatic DirectML/CPU fallback). On failure use Retry with DirectML or Retry with CPU explicitly.",
  });

  issues.push({
    severity: "info",
    code: "qnn_sdk_docs",
    message: `Advanced QAIRT / SDK-backed passes: ${QNN_ADVANCED_QAIRT_DOCS_URL}`,
  });

  return issues;
}

/** Explicit retry targets after a fail-closed QNN job (never automatic). */
export function qnnExplicitRetryProviders(): IHVProvider[] {
  return ["DmlExecutionProvider", "CPUExecutionProvider"];
}

export function qnnRuntimeUiLabel(probe?: HardwareProbeResult | null): string {
  if (probe?.qnn?.verifiedInference && isQnnSnapdragonReleaseGatePassed()) {
    return "QNN NPU ready";
  }
  if (probe?.qnn?.loadable) {
    if (probe.qnn.hostMode === "preparation") return "QNN runtime installed (preparation)";
    if (probe.qnn.npuDevice) return "QNN runtime installed (NPU device)";
    return "QNN runtime installed";
  }
  return "QNN runtime not installed";
}
