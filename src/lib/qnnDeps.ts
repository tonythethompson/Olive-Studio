/**
 * QNN 2.x plugin EP installation metadata for the isolated qnn venv family.
 *
 * `.venvs/qnn` uses standard `onnxruntime` plus the `onnxruntime-qnn` plugin
 * package (not a replacement ORT distribution). Pins match QNN EP 2.4.0's
 * compiled/tested ORT pair for deterministic family builds.
 *
 * @see https://github.com/onnxruntime/onnxruntime-qnn
 */

/** Canonical ORT wheel for the qnn family (not DirectML / GPU / OpenVINO). */
export const ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE = "onnxruntime";
export const PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION = "1.26.0";

/** QNN 2.x plugin package installed beside standard ORT. */
export const ONNXRUNTIME_QNN_PLUGIN_PACKAGE = "onnxruntime-qnn";
export const PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION = "2.4.0";

/**
 * Tested NumPy pins per CPython minor (QNN requires 1.25.2 or >=1.26.4).
 * Spike-verified on CPython 3.12 with the ORT/plugin pair above.
 */
export const QNN_NUMPY_PINS: Readonly<Record<"3.11" | "3.12" | "3.13", string>> = {
  "3.11": "1.26.4",
  "3.12": "2.2.6",
  "3.13": "2.2.6",
};

/** CPython minors accepted for the qnn family in the current Studio release. */
export const QNN_FAMILY_PYTHON_MINORS = ["3.11", "3.12", "3.13"] as const;
export type QnnFamilyPythonMinor = (typeof QNN_FAMILY_PYTHON_MINORS)[number];

/** Advanced QAIRT tooling docs (not required for ordinary plugin install). */
export const QNN_ADVANCED_QAIRT_DOCS_URL =
  "https://docs.qualcomm.com/bundle/publicresource/topics/80-63442-10/introduction.html";

export function isQnnFamilyPythonMinor(minor: string): minor is QnnFamilyPythonMinor {
  return (QNN_FAMILY_PYTHON_MINORS as readonly string[]).includes(minor);
}

/** Exact NumPy pin for a supported Python minor, or null if unsupported. */
export function qnnNumpyPinForPythonMinor(minor: string): string | null {
  if (!isQnnFamilyPythonMinor(minor)) return null;
  return QNN_NUMPY_PINS[minor];
}

/** Marker-based NumPy constraints for pip (one pin per supported minor). */
export function qnnNumpyConstraintArgs(): string[] {
  return QNN_FAMILY_PYTHON_MINORS.map(
    (minor) => `numpy==${QNN_NUMPY_PINS[minor]}; python_version=="${minor}"`,
  );
}

export function qnnOrtInstallArgs(): string[] {
  return [`${ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION}`];
}

/** Supplemental packages: QNN plugin + NumPy pins (not ORT distributions). */
export function qnnSupplementalInstallArgs(): string[] {
  return [
    `${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION}`,
    ...qnnNumpyConstraintArgs(),
  ];
}

export function qnnPackageConstraints(): string[] {
  return [
    `${ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION}`,
    `${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION}`,
    ...qnnNumpyConstraintArgs(),
  ];
}

export function qnnSupplementalConstraints(): string[] {
  return [
    `${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION}`,
    ...qnnNumpyConstraintArgs(),
  ];
}

export function qnnStackLabel(): string {
  return `${ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION} + ${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION}`;
}

export function qnnStackInstallCommand(): string {
  return `pip install ${ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION} ${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION}`;
}

/**
 * True when Studio may claim verified “QNN NPU ready” UI.
 * Remains false until the Snapdragon release gate passes on real hardware.
 * Kept as a function so call sites type-check while the gate is still closed.
 */
export function isQnnSnapdragonReleaseGatePassed(): boolean {
  return false;
}

/** @deprecated Prefer {@link isQnnSnapdragonReleaseGatePassed}. */
export const QNN_SNAPDRAGON_RELEASE_GATE_PASSED = false as boolean;

/** Host mode for Windows-first QNN release scope. */
export type QnnHostMode = "local-inference" | "preparation" | "out-of-scope";

export function resolveQnnHostMode(opts: {
  platform: NodeJS.Platform | string;
  arch: string;
}): QnnHostMode {
  if (opts.platform !== "win32") return "out-of-scope";
  const arch = opts.arch.toLowerCase();
  if (arch === "arm64" || arch === "aarch64") return "local-inference";
  if (arch === "x64" || arch === "x86_64" || arch === "amd64") return "preparation";
  return "out-of-scope";
}
