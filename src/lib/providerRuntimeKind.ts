/**
 * Runtime role for each IHV execution provider in Olive Studio.
 *
 * - `local`: Python ORT EP that can run via Execute Live when probe/venv allow.
 * - `exportTarget`: Recipe/export wiring only (browser, OWR, conversion paths).
 * - `platformLocal`: Real ORT EP on some hosts (Darwin CoreML, Vitis AI boards);
 *   selectable for recipes always; Execute Live only when the probe lists it.
 */
import type { IHVProvider } from "@/types";

export type ProviderRuntimeKind = "local" | "exportTarget" | "platformLocal";

export function getProviderRuntimeKind(provider: IHVProvider): ProviderRuntimeKind {
  switch (provider) {
    case "WebGpuExecutionProvider":
    case "NNAPIExecutionProvider":
    case "SNPEExecutionProvider":
    case "TensorflowLiteExecutionProvider":
    case "XnnpackExecutionProvider":
    case "WasmExecutionProvider":
      return "exportTarget";
    case "CoreMLExecutionProvider":
    case "VitisAIExecutionProvider":
    case "QNNExecutionProvider":
    case "QnnAbiExecutionProvider":
      return "platformLocal";
    case "CPUExecutionProvider":
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
    case "DmlExecutionProvider":
    case "OpenVINOExecutionProvider":
    case "ROCMExecutionProvider":
      return "local";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function isExportTargetProvider(provider: IHVProvider): boolean {
  return getProviderRuntimeKind(provider) === "exportTarget";
}

export function isPlatformLocalProvider(provider: IHVProvider): boolean {
  return getProviderRuntimeKind(provider) === "platformLocal";
}

/** Qualcomm SNPE is legacy; prefer QNN for new Snapdragon work. */
export function isLegacyExportProvider(provider: IHVProvider): boolean {
  return provider === "SNPEExecutionProvider";
}

/**
 * Providers that do not support PEFT (LoRA/QLoRA) passes.
 *
 * - QNN: QNN runtime does not support PEFT adapter merging
 * - OpenVINO: OpenVINO conversion does not handle PEFT adapters
 *
 * Used by both state sanitization (pipelineStateCommit.ts) and validation
 * (pipelineValidation.ts) to enforce a consistent PEFT provider policy.
 */
export const PEFT_UNSUPPORTED_PROVIDERS: readonly IHVProvider[] = [
  "QNNExecutionProvider",
  "QnnAbiExecutionProvider",
  "OpenVINOExecutionProvider",
] as const;

/**
 * Providers always choosable for recipe selection without a local probe hit:
 * export targets (WebGPU, OWR mobile/web, TFLite, SNPE) and platform-local EPs
 * (CoreML, VitisAI). Execute Live stays gated separately via pipeline validation.
 */
export function alwaysSelectableProviders(): IHVProvider[] {
  return (
    [
      "WebGpuExecutionProvider",
      "NNAPIExecutionProvider",
      "SNPEExecutionProvider",
      "TensorflowLiteExecutionProvider",
      "XnnpackExecutionProvider",
      "WasmExecutionProvider",
      "CoreMLExecutionProvider",
      "VitisAIExecutionProvider",
      "QNNExecutionProvider",
      "QnnAbiExecutionProvider",
    ] as const
  ).slice();
}
