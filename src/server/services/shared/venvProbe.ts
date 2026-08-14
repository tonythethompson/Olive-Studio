/**
 * Shared venv Python probes used by runtime families (TensorRT, TensorRT RTX,
 * and any future ORT family). Extracted so each family's version/library-dir
 * queries don't duplicate the exec + parse + catch boilerplate.
 */
import fs from "fs";

import { execFileAsync } from "./exec.ts";

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Prints `<module>.<attr>` from a venv python and returns the trimmed value.
 * Returns `null` when the module is missing or the probe fails.
 *
 * @param python - Path to the Python executable to inspect
 * @param moduleName - Module to import (e.g. `tensorrt`, `tensorrt_rtx`)
 * @param attr - Attribute to print (defaults to `__version__`)
 * @returns The trimmed probe output, or `null` when unavailable
 */
export async function getInstalledModuleVersion(
  python: string,
  moduleName: string,
  attr = "__version__",
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      python,
      ["-c", `import ${moduleName}; print(${moduleName}.${attr})`],
      { timeout: PROBE_TIMEOUT_MS },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Prints the directory containing `<module>` (e.g. the native `tensorrt_libs`
 * package dir) and returns it when it exists on disk.
 *
 * @param python - Path to the Python executable to inspect
 * @param moduleName - Module whose `__file__` directory to locate
 * @returns The existing directory path, or `null` when it cannot be located
 */
export async function getModuleLibsDir(
  python: string,
  moduleName: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      python,
      ["-c", `import os, ${moduleName}; print(os.path.dirname(${moduleName}.__file__))`],
      { timeout: PROBE_TIMEOUT_MS },
    );
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}
