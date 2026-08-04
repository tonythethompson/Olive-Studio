/**
 * CUDA version detection helpers + onnxruntime-gpu install into the cuda family.
 */
import {
  ORT_GPU_PROBE_SCRIPT,
  parseOrtGpuProbe,
  pinnedOrtGpuInstallArgs,
  pinnedOrtGpuLabel,
  PINNED_ORT_GPU_VERSION,
  isResolvableCudaTag,
} from "../../../lib/oliveGpuRuntime.ts";
import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { getVenvPython } from "../venv/paths.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { invalidateRuntimeStatusCache } from "../venv/status.ts";
import fs from "fs";

/** Parse CUDA version from nvidia-smi output. */
export function parseCudaVersionFromNvidiaSmi(
  stdout: string,
): { cudaVersion: string; cudaTag: string } | null {
  const m = stdout.match(/CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/);
  if (!m) return null;
  const cudaVersion = `${m[1]}.${m[2]}`;
  const cudaTag = pickCudaTag(parseInt(m[1], 10), parseInt(m[2], 10));
  return { cudaVersion, cudaTag };
}

export function pickCudaTag(major: number, minor: number): string {
  const tiers = [
    { major: 12, minor: 8, tag: "cu128" },
    { major: 12, minor: 6, tag: "cu126" },
    { major: 12, minor: 4, tag: "cu124" },
    { major: 12, minor: 1, tag: "cu121" },
    { major: 11, minor: 8, tag: "cu118" },
  ];
  if (major >= 13) return "cu128";
  for (const t of tiers) {
    if (major > t.major || (major === t.major && minor >= t.minor)) return t.tag;
  }
  return "cpu";
}

export async function detectCudaTag(preferred: string, onLine: (line: string) => void): Promise<string> {
  if (preferred && preferred !== "auto") {
    if (preferred === "cpu" || isResolvableCudaTag(preferred)) {
      onLine(`[deps] CUDA version override: ${preferred}`);
      return preferred;
    }
    onLine(
      `[deps] Unsupported CUDA tag "${preferred}" (no ORT/cu12 resolution); falling back to auto-detect`,
    );
  }

  const venvPython = getVenvPython("cuda");
  try {
    const { stdout } = await execFileAsync(venvPython, [
      "-c",
      "import torch; print(torch.version.cuda or 'NONE')",
    ]);
    const existing = stdout.trim();
    if (existing !== "NONE" && existing) {
      const parts = existing.split(".");
      const tag = pickCudaTag(parseInt(parts[0], 10), parseInt(parts[1] ?? "0", 10));
      onLine(`[deps] Existing torch CUDA ${existing} → using ${tag}`);
      return tag;
    }
  } catch {
    /* torch not installed */
  }

  try {
    const { stdout } = await execFileAsync("nvidia-smi", []);
    const parsed = parseCudaVersionFromNvidiaSmi(stdout);
    if (parsed) {
      onLine(`[deps] nvidia-smi detected CUDA ${parsed.cudaVersion} → ${parsed.cudaTag}`);
      return parsed.cudaTag;
    }
  } catch {
    /* no GPU */
  }

  onLine(`[deps] No GPU detected → CPU torch`);
  return "cpu";
}

/**
 * Ensures the cuda-family venv has the pinned onnxruntime-gpu wheel with a
 * usable CUDA execution provider.
 */
export async function ensureOnnxRuntimeGpu(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvResult = await ensureVenvFamily("cuda", onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the CUDA runtime",
    };
  }
  const venvPython = getVenvPython("cuda");
  if (!fs.existsSync(venvPython)) {
    return {
      ok: false,
      error: "CUDA runtime is incomplete (missing python). Use Setup runtime, then retry.",
    };
  }

  const env = envForFamily("cuda");

  try {
    const { stdout } = await execFileAsync(venvPython, ["-c", ORT_GPU_PROBE_SCRIPT], { env });
    const probe = parseOrtGpuProbe(stdout);
    if (probe.ok) {
      onLine("[deps] onnxruntime-gpu already installed and CUDA EP registered");
      return { ok: true, libsDir: null };
    }
    if (probe.distVersion || probe.ortVersion) {
      onLine(
        probe.cudaUsable === false
          ? `[deps] onnxruntime-gpu ${probe.distVersion ?? probe.ortVersion} installed but CUDA EP not registered — reinstalling pinned wheel...`
          : `[deps] onnxruntime-gpu ${probe.distVersion ?? probe.ortVersion} installed but need ${PINNED_ORT_GPU_VERSION}, reinstalling...`,
      );
    }
  } catch {
    /* install below */
  }

  onLine(`[deps] Installing ${pinnedOrtGpuLabel()} (required for CUDA EP)...`);
  try {
    await pipInstallForFamily("cuda", venvPython, pinnedOrtGpuInstallArgs(), onLine);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, libsDir: null, error: msg };
  }
  onLine(`[deps] ${pinnedOrtGpuLabel()} installed`);

  invalidateRuntimeStatusCache();

  try {
    const { stdout } = await execFileAsync(venvPython, ["-c", ORT_GPU_PROBE_SCRIPT], { env });
    const probe = parseOrtGpuProbe(stdout);
    if (probe.ok) {
      onLine("[deps] CUDA execution provider load verified after install");
      return { ok: true, libsDir: null };
    }
    return {
      ok: false,
      libsDir: null,
      error:
        probe.cudaUsable === false
          ? `${pinnedOrtGpuLabel()} installed but the onnxruntime CUDA EP did not register — likely a driver / CUDA-version mismatch (probe reported: ${probe.distVersion ?? "?"} / ort ${probe.ortVersion ?? "?"}). Refresh the hardware probe and check the NVIDIA driver.`
          : `${pinnedOrtGpuLabel()} is not at the pinned version ${PINNED_ORT_GPU_VERSION} after install (got ${probe.distVersion ?? "?"} / ort ${probe.ortVersion ?? "?"}).`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      libsDir: null,
      error: `CUDA EP probe failed after install: ${msg}. Refresh the hardware probe and check the Python venv.`,
    };
  }
}
