/**
 * OpenVINO + Optimum-Intel + ORT OpenVINO EP installation metadata.
 *
 * Installs the PyPI OpenVINO runtime, the Hugging Face Optimum-Intel bridge
 * (openvino extra), and `onnxruntime-openvino` (supplies OpenVINOExecutionProvider)
 * into the project .venv. Used by the Hardware panel install button and by
 * recipe-required-package inference.
 *
 * Olive maps OpenVINOExecutionProvider → onnxruntime-openvino
 * (see microsoft/Olive olive/hardware/constants.py). Plain `openvino` /
 * `optimum-intel` alone do not register the ORT execution provider.
 */
export const OPEN_VINO_PIP_PACKAGE = "openvino";
export const OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE = "optimum-intel[openvino]";
/** ORT wheel that bundles OpenVINOExecutionProvider (mutually exclusive with onnxruntime-gpu). */
export const ONNXRUNTIME_OPENVINO_PIP_PACKAGE = "onnxruntime-openvino";

/**
 * ORT distributions that conflict with `onnxruntime-openvino` on the same
 * import path. Uninstall these before installing the OpenVINO ORT wheel.
 */
export const OPENVINO_CONFLICTING_ORT_PACKAGES = [
  "onnxruntime",
  "onnxruntime-gpu",
  "onnxruntime-directml",
] as const;

/** Intel GPU driver setup docs for OpenVINO. */
export const OPEN_VINO_GPU_DRIVER_URL =
  "https://docs.openvino.ai/2026/get-started/install-openvino/configurations/configurations-intel-gpu.html";

/** Intel NPU driver setup docs for OpenVINO. */
export const OPEN_VINO_NPU_DRIVER_URL =
  "https://docs.openvino.ai/2026/get-started/install-openvino/configurations/configurations-intel-npu.html";

/**
 * Returns the pip install arguments for the OpenVINO stack.
 *
 * `--upgrade` is required for `--upgrade-strategy eager` to take effect so
 * already-installed OpenVINO packages (and their deps) are upgraded when
 * optimum-intel transitively pins an older runtime.
 */
export function openvinoStackInstallArgs(): string[] {
  return [
    "--upgrade",
    "--upgrade-strategy",
    "eager",
    OPEN_VINO_PIP_PACKAGE,
    OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE,
    ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
  ];
}

export function openvinoStackLabel(): string {
  return `${OPEN_VINO_PIP_PACKAGE} + ${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE} + ${ONNXRUNTIME_OPENVINO_PIP_PACKAGE}`;
}
