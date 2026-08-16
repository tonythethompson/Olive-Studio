/**
 * MIGraphX capability ensure: installs `migraphx` into the default venv
 * on Linux x86_64 hosts with a compatible AMD ROCm stack.
 *
 * Platform gate: Linux x64 only. MIGraphX is not available on Windows or
 * macOS, and only targets x86_64 (not ARM64 Linux).
 */
import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";

type SetupListener = (line: string) => void;

/** Maximum time allowed for `pip install migraphx` (large wheel + ROCm deps). */
const MIGRAPHX_INSTALL_TIMEOUT_MS = 300_000;

/**
 * Ensures `migraphx` is installed in the default venv family.
 *
 * - Platform gate: returns early with an error on non-Linux or non-x64 hosts.
 * - Idempotent: skips if already importable.
 * - 300-second timeout: kills a hung pip process rather than blocking indefinitely.
 */
export async function ensureMigraphx(
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  // Platform gate: MIGraphX requires Linux x86_64 with ROCm
  if (process.platform !== "linux" || process.arch !== "x64") {
    return {
      ok: false,
      error: "MIGraphX requires a Linux host with a compatible AMD ROCm stack.",
    };
  }

  const python = getVenvPython("default");
  const env = envForFamily("default");

  // Idempotent check: skip if already importable
  try {
    await execFileAsync(python, ["-c", "import migraphx"], {
      env,
      timeout: 30_000,
    });
    onLine("[migraphx] migraphx already installed — skipping");
    return { ok: true };
  } catch {
    // Not installed — proceed with install
  }

  onLine("[migraphx] Installing migraphx (may take several minutes — requires ROCm)...");
  try {
    await Promise.race([
      pipInstallForFamily("default", python, ["migraphx"], onLine),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "migraphx installation timed out after 300s. Check network connectivity and ROCm availability.",
              ),
            ),
          MIGRAPHX_INSTALL_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `MIGraphX installation failed: ${msg}` };
  }

  // Verify the install succeeded by importing the module
  try {
    await execFileAsync(python, ["-c", "import migraphx"], {
      env,
      timeout: 30_000,
    });
  } catch {
    return {
      ok: false,
      error: "MIGraphX package installed but import failed — ROCm libraries may be missing from the host.",
    };
  }

  onLine("[migraphx] migraphx installed ✓");
  return { ok: true };
}
