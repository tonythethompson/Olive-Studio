/**
 * CUDA version detection helpers.
 *
 * parseCudaVersionFromNvidiaSmi and pickCudaTag are the canonical implementations.
 * routes/system.ts was duplicating them — it should import from here instead.
 */
import { isResolvableCudaTag } from "../../../lib/oliveGpuRuntime.ts";
import { execFileAsync } from "../shared/exec.ts";
import { getVenvPython } from "../venv/paths.ts";

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
