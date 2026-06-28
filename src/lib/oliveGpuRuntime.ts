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

export function pinnedOrtGpuLabel(): string {
  return `onnxruntime-gpu (${PINNED_ORT_GPU_VERSION})`;
}

export function isGpuExecutionProvider(provider: string): boolean {
  return (
    provider === "CUDAExecutionProvider" ||
    provider === "TensorrtExecutionProvider" ||
    provider === "NvTensorRTRTXExecutionProvider" ||
    provider === "ROCMExecutionProvider"
  );
}
