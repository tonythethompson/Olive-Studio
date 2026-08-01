import { pinnedTensorRtInstallArgs, pinnedTensorRtLabel } from "./tensorrtDeps.ts";

/**
 * Stable onnxruntime-gpu on PyPI is CUDA 12.x through 1.26.x.
 * 1.27+ wheels are CUDA 13 builds but cu13 pip runtime packages are not fully published yet.
 * Do not enable cu130/cu132 until ORT + nvidia-*-cu13 pins resolve on PyPI.
 */
export const PINNED_ORT_GPU_VERSION = "1.26.0";

/** PyTorch CUDA tags Olive Studio can fully resolve to installable pins. */
export const RESOLVABLE_CUDA_TAGS = ["cu118", "cu121", "cu124", "cu126", "cu128"] as const;
export type ResolvableCudaTag = (typeof RESOLVABLE_CUDA_TAGS)[number];

export function isResolvableCudaTag(tag: string): tag is ResolvableCudaTag {
  return (RESOLVABLE_CUDA_TAGS as readonly string[]).includes(tag);
}

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

export type CudaTagResolution = {
  tag: ResolvableCudaTag;
  torchIndexUrl: string;
  ortInstallArgs: string[];
  ortLabel: string;
  runtimePackages: typeof CUDA12_RUNTIME_PACKAGES;
  /** Classic TensorRT pin compatible with onnxruntime-gpu 1.26 / CUDA 12. */
  tensorRtInstallArgs: string[];
  tensorRtLabel: string;
};

/**
 * Resolve install pins for a supported CUDA tag.
 * Returns null for cpu/auto/unsupported tags (cu130, cu132, …).
 */
export function resolveCudaTag(tag: string): CudaTagResolution | null {
  if (!isResolvableCudaTag(tag)) return null;
  return {
    tag,
    torchIndexUrl: `https://download.pytorch.org/whl/${tag}`,
    ortInstallArgs: pinnedOrtGpuInstallArgs(),
    ortLabel: pinnedOrtGpuLabel(),
    runtimePackages: CUDA12_RUNTIME_PACKAGES,
    tensorRtInstallArgs: pinnedTensorRtInstallArgs(),
    tensorRtLabel: pinnedTensorRtLabel(),
  };
}

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
