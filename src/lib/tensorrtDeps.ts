/**
 * Classic TensorRT (nvinfer_10) pinned for stable onnxruntime-gpu on PyPI (CUDA 12.x).
 * Do not use unpinned `pip install tensorrt` — latest PyPI may ship TRT 11 / CUDA 13.
 *
 * CUDA 13 + TRT 11 requires ORT nightly from ort-cuda-13-nightly (not wired here).
 */
export const PINNED_TENSORRT_VERSION = "10.9.0.34";

export function pinnedTensorRtInstallArgs(): string[] {
  return ["tensorrt", `==${PINNED_TENSORRT_VERSION}`];
}

export function pinnedTensorRtLabel(): string {
  return `tensorrt (${PINNED_TENSORRT_VERSION})`;
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
