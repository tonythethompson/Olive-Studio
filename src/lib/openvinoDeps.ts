/**
 * OpenVINO + Optimum-Intel installation metadata for the openvino venv family.
 *
 * `onnxruntime-openvino` is installed only in `.venvs/openvino` (registers
 * OpenVINOExecutionProvider). It is forbidden on default and cuda families.
 * The Python `openvino` package and optimum-intel bridge are also installed
 * into the openvino family for Olive passes.
 */
export const OPEN_VINO_PIP_PACKAGE = "openvino";
export const OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE = "optimum-intel[openvino]";

/**
 * ORT wheel for the isolated openvino family. Mutually exclusive with other ORT
 * wheels — must not be installed into default or cuda runtimes.
 */
export const ONNXRUNTIME_OPENVINO_PIP_PACKAGE = "onnxruntime-openvino";

/**
 * ORT distributions that would conflict if `onnxruntime-openvino` were installed
 * alongside them in the same venv.
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
 * Pip install args for the OpenVINO Python stack (no ORT wheel swap here —
 * onnxruntime-openvino is installed via the openvino family ensure).
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
