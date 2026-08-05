/**
 * Classic TensorRT (nvinfer_10) pinned for stable onnxruntime-gpu on PyPI (CUDA 12.x).
 * Do not use unpinned `pip install tensorrt` — latest PyPI may ship TRT 11 / CUDA 13.
 *
 * CUDA 13 + TRT 11 requires ORT nightly from ort-cuda-13-nightly (not wired here).
 */
export const PINNED_TENSORRT_VERSION = "10.9.0.34";

/**
 * Provides the pinned TensorRT package requirement for installation.
 *
 * @returns An array containing the pinned TensorRT package requirement
 */
export function pinnedTensorRtInstallArgs(): string[] {
  // Single requirement token so pip does not treat "==version" as a second package.
  return [`tensorrt==${PINNED_TENSORRT_VERSION}`];
}

/**
 * Creates the display label for the pinned TensorRT version.
 *
 * @returns The TensorRT label with its pinned version
 */
export function pinnedTensorRtLabel(): string {
  return `tensorrt (${PINNED_TENSORRT_VERSION})`;
}

/**
 * Copy-pasteable pip command that installs the classic TensorRT SDK at the
 * pinned version. NVIDIA publishes TRT 10.x on PyPI.org, so we deliberately
 * avoid `--index-url` here — that flag would override the project's index
 * resolution and could break other packages. Use this helper anywhere a
 * user-facing hint needs the exact install invocation so the hint stays in
 * lockstep with the version `ensureTensorRt` actually installs.
 */
export function pinnedTensorRtInstallCommand(): string {
  const args = pinnedTensorRtInstallArgs();
  return `pip install ${args.join(" ")}`;
}

/** ORT TensorrtExecutionProvider in stable wheels is built against TensorRT 10.x (nvinfer_10). */
export function isCompatibleTensorRtVersion(version: string): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return major === 10;
}

export function envWithTensorRtLibs(
  base: NodeJS.ProcessEnv,
  libsDir: string | null | undefined,
): NodeJS.ProcessEnv {
  return envWithPrependedPaths(base, libsDir ? [libsDir] : []);
}

export function envWithPrependedPaths(
  base: NodeJS.ProcessEnv,
  dirs: Array<string | null | undefined>,
): NodeJS.ProcessEnv {
  const prepend = dirs.filter((dir): dir is string => Boolean(dir && dir.length > 0));
  if (prepend.length === 0) return base;
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const existing = base[pathKey] ?? process.env[pathKey] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const parts = existing.split(sep).filter(Boolean);
  const merged = [...prepend.filter((dir) => !parts.includes(dir)), ...parts];
  return { ...base, [pathKey]: merged.join(sep) };
}
