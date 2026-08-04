/**
 * OpenVINO + Optimum-Intel stack installation metadata.
 *
 * Installs the PyPI OpenVINO runtime and the Hugging Face Optimum-Intel bridge
 * (openvino extra) into the project .venv. Used by the Hardware panel install
 * button and by recipe-required-package inference.
 */
export const OPEN_VINO_PIP_PACKAGE = "openvino";
export const OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE = "optimum-intel[openvino]";

/** Intel GPU driver setup docs for OpenVINO. */
export const OPEN_VINO_GPU_DRIVER_URL =
  "https://docs.openvino.ai/2026/get-started/install-openvino/configurations/configurations-intel-gpu.html";

/** Intel NPU driver setup docs for OpenVINO. */
export const OPEN_VINO_NPU_DRIVER_URL =
  "https://docs.openvino.ai/2026/get-started/install-openvino/configurations/configurations-intel-npu.html";

/**
 * Returns the pip install arguments for the OpenVINO stack.
 *
 * Uses --upgrade-strategy eager so OpenVINO upgrades cleanly even when optimum-intel
 * transitively pins an older runtime.
 */
export function openvinoStackInstallArgs(): string[] {
  return ["--upgrade-strategy", "eager", OPEN_VINO_PIP_PACKAGE, OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE];
}

export function openvinoStackLabel(): string {
  return `${OPEN_VINO_PIP_PACKAGE} + ${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE}`;
}
