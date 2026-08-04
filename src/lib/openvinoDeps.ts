/**
 * OpenVINO + Optimum-Intel installation metadata for the default venv family.
 *
 * Installs the PyPI OpenVINO runtime and Hugging Face Optimum-Intel bridge
 * (openvino extra). Does NOT install `onnxruntime-openvino` — that wheel
 * conflicts with `onnxruntime-directml` / `onnxruntime` on the default family.
 * Olive Studio OpenVINO capability is the Python `openvino` package.
 */
export const OPEN_VINO_PIP_PACKAGE = "openvino";
export const OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE = "optimum-intel[openvino]";

/**
 * Historical note: `onnxruntime-openvino` supplies ORT's OpenVINOExecutionProvider
 * but is mutually exclusive with other ORT wheels. Kept as a named constant for
 * docs/tests that assert we do NOT install it into the default family.
 */
export const ONNXRUNTIME_OPENVINO_PIP_PACKAGE = "onnxruntime-openvino";

/**
 * ORT distributions that would conflict if `onnxruntime-openvino` were installed.
 * Documented for constraint enforcement — default-family installs must never
 * uninstall these to make room for the OpenVINO ORT wheel.
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
 * Pip install args for the OpenVINO Python stack (no ORT wheel swap).
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
  ];
}

export function openvinoStackLabel(): string {
  return `${OPEN_VINO_PIP_PACKAGE} + ${OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE}`;
}
