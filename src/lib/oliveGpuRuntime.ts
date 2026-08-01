/**
 * Stable onnxruntime-gpu on PyPI is CUDA 12.x through 1.26.x.
 * 1.27+ wheels are CUDA 13 builds but cu13 pip runtime packages are not fully published yet.
 */
export const PINNED_ORT_GPU_VERSION = "1.26.0";

export const CUDA12_RUNTIME_PACKAGES: Array<{
  importName: string;
  installArgs: string[];
  label: string;
}> = [
  { importName: "nvidia.cudnn", installArgs: ["nvidia-cudnn-cu12"], label: "nvidia-cudnn-cu12" },
  { importName: "nvidia.cublas", installArgs: ["nvidia-cublas-cu12"], label: "nvidia-cublas-cu12" },
  {
    importName: "nvidia.cuda_runtime",
    installArgs: ["nvidia-cuda-runtime-cu12"],
    label: "nvidia-cuda-runtime-cu12",
  },
  { importName: "nvidia.cufft", installArgs: ["nvidia-cufft-cu12"], label: "nvidia-cufft-cu12" },
  { importName: "nvidia.curand", installArgs: ["nvidia-curand-cu12"], label: "nvidia-curand-cu12" },
  {
    importName: "nvidia.cuda_nvrtc",
    installArgs: ["nvidia-cuda-nvrtc-cu12"],
    label: "nvidia-cuda-nvrtc-cu12",
  },
  {
    importName: "nvidia.nvjitlink",
    installArgs: ["nvidia-nvjitlink-cu12"],
    label: "nvidia-nvjitlink-cu12",
  },
];

export function pinnedOrtGpuInstallArgs(): string[] {
  return [`onnxruntime-gpu==${PINNED_ORT_GPU_VERSION}`];
}

/**
 * Creates a human-readable label for the pinned ONNX Runtime GPU package.
 *
 * @returns The package name followed by its pinned version
 */
export function pinnedOrtGpuLabel(): string {
  return `onnxruntime-gpu (${PINNED_ORT_GPU_VERSION})`;
}

/** Python probe: verifies onnxruntime-gpu dist/module versions and CUDA EP usability. */
export const ORT_GPU_PROBE_SCRIPT = `
import importlib.metadata as m
import onnxruntime as ort
try:
    dist = m.distribution("onnxruntime-gpu")
    usable = False
    try:
        if hasattr(ort, "is_provider_usable"):
            usable = bool(ort.is_provider_usable("CUDAExecutionProvider"))
        elif hasattr(ort, "get_usable_providers"):
            usable = "CUDAExecutionProvider" in list(ort.get_usable_providers())
        else:
            usable = "CUDAExecutionProvider" in ort.get_available_providers()
    except Exception:
        usable = False
    print(f"ok:{dist.version}:{ort.__version__}:{'1' if usable else '0'}")
except Exception as exc:
    print(f"fail:{exc}")
`.trim();

/**
 * Parses the ONNX Runtime GPU probe output and verifies both reported versions.
 *
 * @param stdout - The probe's standard output
 * @returns The parsed distribution and module versions, with `ok` set to `true` when both match the pinned version
 */
export function parseOrtGpuProbe(stdout: string): {
  ok: boolean;
  distVersion?: string;
  ortVersion?: string;
  cudaUsable?: boolean;
} {
  const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
  if (!line.startsWith("ok:")) return { ok: false };
  const parts = line.split(":");
  const distVersion = parts[1];
  const ortVersion = parts[2];
  const usableFlag = parts[3];
  if (!distVersion || !ortVersion) return { ok: false };
  const cudaUsable = usableFlag === "1";
  return {
    ok: distVersion === PINNED_ORT_GPU_VERSION && ortVersion === PINNED_ORT_GPU_VERSION && cudaUsable,
    distVersion,
    ortVersion,
    cudaUsable,
  };
}

/**
 * Determines whether an execution provider uses GPU acceleration.
 *
 * @param provider - The execution provider name
 * @returns `true` for CUDA, TensorRT, TensorRT RTX, or ROCm providers, `false` otherwise.
 */
export function isGpuExecutionProvider(provider: string): boolean {
  return (
    provider === "CUDAExecutionProvider" ||
    provider === "TensorrtExecutionProvider" ||
    provider === "NvTensorRTRTXExecutionProvider" ||
    provider === "ROCMExecutionProvider"
  );
}
