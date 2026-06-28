/** Pip metapackage for NVIDIA TensorRT RTX (consumer GeForce 30xx+). Olive v0.9.1+. */
export const TENSORRT_RTX_PIP_PACKAGE = "tensorrt-rtx";

export function tensorrtRtxInstallArgs(): string[] {
  return [TENSORRT_RTX_PIP_PACKAGE];
}

export function tensorrtRtxLabel(): string {
  return TENSORRT_RTX_PIP_PACKAGE;
}

export function isNvTensorRtRtxProvider(provider: string): boolean {
  return provider === "NvTensorRTRTXExecutionProvider";
}

export function isNvTensorRtRtxCatalogPath(repoPath: string): boolean {
  return /nvtensorrtrtx/i.test(repoPath);
}
