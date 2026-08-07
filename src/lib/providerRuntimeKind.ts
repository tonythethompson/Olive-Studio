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
      return "platformLocal";
    case "CPUExecutionProvider":
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
    case "DmlExecutionProvider":
    case "OpenVINOExecutionProvider":
    case "QNNExecutionProvider":
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

/** Providers always choosable in Batch / ProviderInspector without local detection. */
export function alwaysSelectableProviders(): IHVProvider[] {
  return (
    [
      "WebGpuExecutionProvider",
      "NNAPIExecutionProvider",
      "SNPEExecutionProvider",
      "TensorflowLiteExecutionProvider",
      "XnnpackExecutionProvider",
      "WasmExecutionProvider",
    ] as const
  ).slice();
}
