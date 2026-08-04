/** Pip metapackage for NVIDIA TensorRT RTX (consumer GeForce 30xx+). Olive v0.9.1+. */
export const TENSORRT_RTX_PIP_PACKAGE = "tensorrt-rtx";

/**
 * NVIDIA standalone TensorRT-RTX EP-ABI plugin package, hosted on NVIDIA's
 * PyPI index (not on PyPI.org). Installing this package is what actually
 * registers the `NvTensorRTRTXExecutionProvider` symbol with ONNX Runtime
 * via `register_execution_provider_library`. Without it, ONNX Runtime
 * (including the pinned `onnxruntime-gpu`) reports the EP as missing
 * even though the `tensorrt-rtx` PyPI package is installed.
 *
 * The Python module that ships in this distribution is
 * `onnxruntime_ep_nv_tensorrt_rtx`; the wheel itself bundles the
 * `onnxruntime_providers_nv_tensorrt_rtx.dll` op library plus the
 * TensorRT-RTX runtime (`tensorrt_rtx_1_5.dll`) and CUDA-13 runtime.
 */
export const TENSORRT_RTX_EP_ABI_PACKAGE = "onnxruntime-ep-nv-tensorrt-rtx-cu13";
export const TENSORRT_RTX_EP_ABI_VERSION = "0.3.0";
export const TENSORRT_RTX_NVIDIA_INDEX_URL = "https://pypi.nvidia.com";

export function tensorrtRtxInstallArgs(): string[] {
  return [TENSORRT_RTX_PIP_PACKAGE];
}

export function tensorrtRtxLabel(): string {
  return TENSORRT_RTX_PIP_PACKAGE;
}

/**
 * Pip args for installing the NVIDIA EP-ABI plugin. The package is only
 * hosted on NVIDIA's PyPI index, so the install passes the index URL as
 * an *extra* index (not the system index) so other PyPI packages keep
 * resolving normally.
 */
export function tensorrtRtxEpAbiInstallArgs(): string[] {
  return [
    "--extra-index-url",
    TENSORRT_RTX_NVIDIA_INDEX_URL,
    `${TENSORRT_RTX_EP_ABI_PACKAGE}==${TENSORRT_RTX_EP_ABI_VERSION}`,
  ];
}

export function tensorrtRtxEpAbiLabel(): string {
  return `${TENSORRT_RTX_EP_ABI_PACKAGE} (${TENSORRT_RTX_EP_ABI_VERSION})`;
}

/**
 * Copy-pasteable pip command that installs the EP-ABI plugin (for the
 * fallback hint surfaced to users when the in-app install path fails).
 * Uses `pip install <args>` so the manual command mirrors exactly the
 * argument string the install route actually passes to `pip install`
 * (see `tensorrtRtxEpAbiInstallArgs`). Single source of truth = the
 * args list, so a version/index bump updates both in lockstep without
 * any drift.
 */
export function tensorrtRtxEpAbiInstallCommand(): string {
  return `pip install ${tensorrtRtxEpAbiInstallArgs().join(" ")}`;
}

export function isNvTensorRtRtxProvider(provider: string): boolean {
  return provider === "NvTensorRTRTXExecutionProvider";
}

export function isNvTensorRtRtxCatalogPath(repoPath: string): boolean {
  return /nvtensorrtrtx/i.test(repoPath);
}
