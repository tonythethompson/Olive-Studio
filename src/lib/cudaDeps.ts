import { parseComputeCapability, type GpuInfo } from "@/lib/hardwareProbe";
import {
  pinnedOrtGpuInstallArgs as _pinnedOrtGpuInstallArgs,
  pinnedOrtGpuLabel as _pinnedOrtGpuLabel,
} from "@/lib/oliveGpuRuntime";

// NOTE: this file imports primitives from `@/lib/hardwareProbe` (the SM
// parser + GPU info type) AND hardwareProbe.ts imports the CUDA floor
// constants + `isPreMaxwellNvidiaBox` from us. The cycle resolves because
// every cross-reference sits inside a function body — module-init never
// reads across the boundary. If you add a module-level `const x =
// parseComputeCapability(...)` here or `const y = isPreMaxwellNvidiaBox(...)`
// in hardwareProbe.ts the cycle breaks. The next refactor that needs an
// early-init usage should split `parseComputeCapability` + `GpuInfo` into a
// leaf module and have both sides depend on it.

/**
 * Minimum NVIDIA compute capability the CUDA 12.x toolkit / runtime can run on.
 *
 * CUDA 12 dropped all SM 3.x (Kepler) support — Maxwell SM 5.0 is the new
 * floor for cuobjdump'd code, and onnxruntime-gpu 1.26 / CUDA 12.x wheels
 * are built accordingly. Pascal SM 6.x and above all run cleanly.
 *
 * Cards below 5.0 (Kepler GK110 / GK208 family — e.g. GTX 680, GT 730
 * Kepler) cannot execute modern CUDA at all; installing the toolkit cannot
 * recover this. Centralizing the number avoids drift between the device
 * probe, the recipe-compat layer, the install-needed hint, and the
 * missing-EP reason text.
 *
 * Compare numerically (e.g. 7.5 ≥ 5.0).
 */
export const CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY = { major: 5, minor: 0 } as const;

export const CUDA_SM_FLOOR = `${CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.major}.${CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.minor}` as const;

/**
 * Does the GPU's compute capability meet or exceed the CUDA 12 toolkit floor?
 *
 * `undefined` compute capability is treated as supported so a probe glitch
 * does not silently mark an otherwise supported GPU as incompatible — the
 * same permissive-to-unknown convention used by `isNvidiaGpuTensorRtFamily`.
 *
 * Both "0.0" (older drivers / parse glitch) and explicit pre-floor values
 * resolve to `false`: we only return `true` when we have NO reason to
 * suspect the GPU is below the floor.
 */
export function isNvidiaGpuCudaToolkitFamily(gpu: GpuInfo): boolean {
  const cap = parseComputeCapability(gpu.computeCapability);
  if (!cap) return true;
  if (cap.major !== CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.major) {
    return cap.major > CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.major;
  }
  return cap.minor >= CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY.minor;
}

/**
 * True only when at least one NVIDIA GPU is detected AND every card is
 * strictly below the CUDA 12 toolkit floor (SM < 5.0). Such a workstation
 * cannot run modern Olive recipes — listing the install buttons would just
 * point the user at a one-click install that cannot possibly succeed.
 *
 * On a mixed box (one Kepler + one RTX), the helper returns `false` and
 * the install hint stays available.
 */
export function isPreMaxwellNvidiaBox(gpus: GpuInfo[]): boolean {
  if (gpus.length === 0) return false;
  return gpus.every((g) => !isNvidiaGpuCudaToolkitFamily(g));
}

// ─────────────────────────────────────────────────────────────────────────
// Install points
// ─────────────────────────────────────────────────────────────────────────

/**
 * The CUDA Toolkit is a system-level install (~3 GB) and Olive Studio
 * cannot pip-install it. Instead, the UI surfaces a deep link to NVIDIA's
 * archive page so the user can grab the matching toolkit for their
 * driver + OS in one click.
 *
 * The `archive` URL is the canonical landing page; the `windows` / `linux`
 * / `wsl` entries deep-link into the CUDA 12.8 wizard (the highest tag
 * `RESOLVABLE_CUDA_TAGS` in oliveGpuRuntime resolves today).
 */
export const CUDA_DOWNLOAD_LINKS = {
  archive: "https://developer.nvidia.com/cuda-toolkit-archive",
  windows: "https://developer.nvidia.com/cuda-12-8-0-download-archive?target_os=Windows",
  linux: "https://developer.nvidia.com/cuda-12-8-0-download-archive?target_os=Linux",
  wsl: "https://developer.nvidia.com/cuda-12-8-0-download-archive?target_os=Windows&target_arch=x86_64&target_distro=WSL",
} as const;

/**
 * Returns the most appropriate NVIDIA CUDA Toolkit download URL for the
 * running OS. Defaults to the archive landing page so the user can pick
 * any toolkit if we don't recognize the OS string.
 */
export function cudaDownloadUrlForOs(os: string | undefined | null): string {
  const text = (os ?? "").toLowerCase();
  if (text.includes("wsl")) return CUDA_DOWNLOAD_LINKS.wsl;
  if (text.includes("win")) return CUDA_DOWNLOAD_LINKS.windows;
  if (text.includes("linux") || text.includes("darwin")) return CUDA_DOWNLOAD_LINKS.linux;
  return CUDA_DOWNLOAD_LINKS.archive;
}

/**
 * Pip-installable command for the pinned onnxruntime-gpu into the project's
 * `.venv`. Re-exports the version pin from oliveGpuRuntime so the CUDA /
 * TensorRT / TensorRT-RTX install paths all stay on the same wheel set.
 */
export function pinnedOrtGpuInstallCommand(): string {
  return `pip install ${_pinnedOrtGpuInstallArgs().join(" ")}`;
}

/**
 * Read-only copy of the pinned install args — useful for the install
 * route that needs to pipe them straight into `pip install`.
 */
export function pinnedOrtGpuInstallArgs(): string[] {
  return _pinnedOrtGpuInstallArgs();
}

export function pinnedOrtGpuLabel(): string {
  return _pinnedOrtGpuLabel();
}
