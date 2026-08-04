/**
 * CUDA version detection helpers.
 *
 * parseCudaVersionFromNvidiaSmi and pickCudaTag are the canonical implementations.
 * routes/system.ts was duplicating them — it should import from here instead.
 */
import { spawn } from "child_process";
import {
  ORT_GPU_PROBE_SCRIPT,
  parseOrtGpuProbe,
  pinnedOrtGpuInstallArgs,
  pinnedOrtGpuLabel,
  PINNED_ORT_GPU_VERSION,
  isResolvableCudaTag,
} from "../../../lib/oliveGpuRuntime.ts";
import { execFileAsync } from "../shared/exec.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import { ensureVenv } from "../venv/index.ts";
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

/**
 * Selects the newest resolvable PyTorch wheel tag for a CUDA version.
 * CUDA 13+ maps to cu128 (highest tag with ORT 1.26 + nvidia-*-cu12 pins).
 *
 * @param major - The CUDA major version
 * @param minor - The CUDA minor version
 * @returns The compatible CUDA wheel tag, or `"cpu"` when the version is below CUDA 11.8
 */
export function pickCudaTag(major: number, minor: number): string {
  const tiers = [
    { major: 12, minor: 8, tag: "cu128" },
    { major: 12, minor: 6, tag: "cu126" },
    { major: 12, minor: 4, tag: "cu124" },
    { major: 12, minor: 1, tag: "cu121" },
    { major: 11, minor: 8, tag: "cu118" },
  ];
  // Driver CUDA 13.x can run cu128 wheels; cu130/cu132 are not resolvable yet.
  if (major >= 13) return "cu128";
  for (const t of tiers) {
    if (major > t.major || (major === t.major && minor >= t.minor)) return t.tag;
  }
  return "cpu";
}

/**
 * Determine the CUDA tag (or "cpu") to use for PyTorch wheel selection.
 *
 * Order of precedence:
 *   1. Explicit `preferred` override (unless "auto")
 *   2. Existing torch CUDA version in venv
 *   3. nvidia-smi auto-detection
 *   4. Fallback to "cpu"
 */
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

  // Check existing torch in venv first — avoids reinstall when already correct
  const venvPython = getVenvPython();
  try {
    const { stdout } = await execFileAsync(venvPython, [
      "-c",
      "import torch; print(torch.version.cuda or 'NONE')",
    ]);
    const existing = stdout.trim();
    if (existing !== "NONE" && existing) {
      const parts = existing.split(".");
      const tag = pickCudaTag(parseInt(parts[0]), parseInt(parts[1] ?? "0"));
      onLine(`[deps] Existing torch CUDA ${existing} → using ${tag}`);
      return tag;
    }
  } catch {
    /* torch not installed */
  }

  // Auto-detect via nvidia-smi
  try {
    const { stdout } = await execFileAsync("nvidia-smi", []);
    const parsed = parseCudaVersionFromNvidiaSmi(stdout);
    if (parsed) {
      onLine(`[deps] nvidia-smi detected CUDA ${parsed.cudaVersion} → ${parsed.cudaTag}`);
      return parsed.cudaTag;
    }
  } catch {
    /* no GPU or nvidia-smi not in PATH */
  }

  onLine(`[deps] No GPU detected → CPU torch`);
  return "cpu";
}

// ─────────────────────────────────────────────────────────────────────────
// onnxruntime-gpu install path (mirrors TRT install UX in tensorrt.ts)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs `pip install` and forwards output line-by-line to the provided callback,
 * prepending each line with `[deps]`. Mirrors the helper in tensorrt.ts so the
 * NDJSON stream the UI receives has the same shape across all install paths.
 */
async function pipInstall(
  pip: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...args], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", (err: Error) =>
      reject(
        new Error(
          `Failed to launch ${pip}: ${err.message}. Create the project .venv via Setup runtime first.`,
        ),
      ),
    );
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`pip install ${args.join(" ")} failed (exit ${code})`)),
    );
  });
}

/**
 * Ensures the project virtual environment has the pinned onnxruntime-gpu
 * wheel with a usable CUDA execution provider. The probe script
 * `ORT_GPU_PROBE_SCRIPT` checks both the wheel version AND that the CUDA EP
 * is actually registered, so a successful run means the user can pick
 * CUDA as their IHV provider without further config.
 *
 * Returns `{ ok, error? }`; on success, `libsDir` carries the path the
 * caller can prepend so subsequent `pip install` invocations find cuBLAS /
 * cuDNN shared libs.
 *
 * @param onLine - Receives install + verification messages for the NDJSON stream
 */
export async function ensureOnnxRuntimeGpu(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvResult = await ensureVenv(onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the project .venv",
    };
  }
  const venvPython = getVenvPython();
  const pip = getVenvPip();
  if (!fs.existsSync(venvPython) || !fs.existsSync(pip)) {
    return {
      ok: false,
      error: `Project .venv is incomplete (missing ${!fs.existsSync(pip) ? "pip" : "python"}). Use Setup runtime, then retry.`,
    };
  }

  try {
    const { stdout } = await execFileAsync(venvPython, ["-c", ORT_GPU_PROBE_SCRIPT]);
    const probe = parseOrtGpuProbe(stdout);
    if (probe.ok) {
      onLine("[deps] onnxruntime-gpu already installed and CUDA EP registered ✓");
      return { ok: true };
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
  await pipInstall(pip, pinnedOrtGpuInstallArgs(), onLine);
  onLine(`[deps] ${pinnedOrtGpuLabel()} installed ✓`);

  // Verify after install — surfaces driver/wheel mismatch as a real error.
  try {
    const { stdout } = await execFileAsync(venvPython, ["-c", ORT_GPU_PROBE_SCRIPT]);
    const probe = parseOrtGpuProbe(stdout);
    if (probe.ok) {
      onLine("[deps] CUDA execution provider load verified after install ✓");
      return { ok: true };
    }
    return {
      ok: false,
      error:
        probe.cudaUsable === false
          ? `${pinnedOrtGpuLabel()} installed but the onnxruntime CUDA EP did not register — likely a driver / CUDA-version mismatch (probe reported: ${probe.distVersion ?? "?"} / ort ${probe.ortVersion ?? "?"}). Refresh the hardware probe and check the NVIDIA driver.`
          : `${pinnedOrtGpuLabel()} is not at the pinned version ${PINNED_ORT_GPU_VERSION} after install (got ${probe.distVersion ?? "?"} / ort ${probe.ortVersion ?? "?"}).`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `CUDA EP probe failed after install: ${msg}. Refresh the hardware probe and check the Python venv.`,
    };
  }
}
