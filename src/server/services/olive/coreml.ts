/**
 * CoreML supplemental dependency: ensures `coremltools` is installed
 * in the default venv family for CoreML-targeted Olive optimizations.
 *
 * Much simpler than CUDA/OpenVINO/QNN — no GPU runtime detection, no
 * version pinning, no dedicated venv family. Just an idempotent pip
 * install of the `coremltools` package.
 */
import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";

type SetupListener = (line: string) => void;

/**
 * Ensures `coremltools` is installed in the default venv.
 * Idempotent: skips if already present, installs otherwise.
 */
export async function ensureCoremltools(
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  const python = getVenvPython("default");
  const env = envForFamily("default");

  // Idempotent check: skip if already installed
  try {
    await execFileAsync(python, ["-m", "pip", "show", "coremltools"], {
      env,
      timeout: 30_000,
    });
    onLine("[coreml] coremltools already installed — skipping");
    return { ok: true };
  } catch {
    // Not installed — proceed with install
  }

  onLine("[coreml] Installing coremltools...");
  try {
    await pipInstallForFamily("default", python, ["coremltools"], onLine);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `coremltools installation failed: ${msg}` };
  }

  onLine("[coreml] coremltools installed ✓");
  return { ok: true };
}
