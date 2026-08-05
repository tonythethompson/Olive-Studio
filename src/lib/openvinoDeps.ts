/**
 * OpenVINO + Optimum-Intel installation metadata for the openvino venv family.
 *
 * `onnxruntime-openvino` is installed only in `.venvs/openvino` (registers
 * OpenVINOExecutionProvider). It is forbidden on default and cuda families.
 * The Python `openvino` package and optimum-intel bridge are also installed
 * into the openvino family for Olive passes.
 */
import type { OpenVinoTargetDevice } from "@/types";

export type { OpenVinoTargetDevice };

export const OPEN_VINO_PIP_PACKAGE = "openvino";
export const OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE = "optimum-intel[openvino]";

/** OpenVINOExecutionProvider silicon target (maps to Olive accelerator.device). */
export const OPEN_VINO_TARGET_DEVICES: readonly OpenVinoTargetDevice[] = [
  "CPU",
  "GPU",
  "NPU",
] as const;

/** Olive LocalSystem accelerator.device for an OpenVINO target. */
export function openvinoTargetToOliveDevice(
  target: OpenVinoTargetDevice,
): "cpu" | "gpu" | "npu" {
  switch (target) {
    case "GPU":
      return "gpu";
    case "NPU":
      return "npu";
    case "CPU":
      return "cpu";
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/** Normalize free-form device tokens from probes / recipes. */
export function normalizeOpenVinoTargetDevice(raw: unknown): OpenVinoTargetDevice | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const token = raw.trim().toUpperCase();
  if (token === "CPU" || token.startsWith("CPU.")) return "CPU";
  if (token === "GPU" || token.startsWith("GPU.") || token === "GPU_FP16" || token === "GPU_FP32") {
    return "GPU";
  }
  if (token === "NPU" || token.startsWith("NPU.")) return "NPU";
  return null;
}

/** True when probe-reported OpenVINO devices include the requested target. */
export function isOpenVinoTargetAvailable(
  target: OpenVinoTargetDevice,
  devices: string[] | undefined | null,
): boolean {
  if (target === "CPU") return true;
  if (!devices?.length) return false;
  const re = target === "GPU" ? /GPU/i : /NPU/i;
  return devices.some((d) => re.test(d));
}

/**
 * Prefer GPU, then NPU, then CPU from an OpenVINO device list.
 * Falls back to CPU when the probe has not reported devices yet.
 */
export function pickOpenVinoTargetFromDevices(
  devices: string[] | undefined | null,
): OpenVinoTargetDevice {
  if (isOpenVinoTargetAvailable("GPU", devices)) return "GPU";
  if (isOpenVinoTargetAvailable("NPU", devices)) return "NPU";
  return "CPU";
}

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
