/**
 * Process-local PATH isolation for a selected venv family.
 * Strips both known family Scripts dirs before prepending the selected one.
 */
import fs from "fs";
import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { VENV_FAMILIES } from "../../../lib/venvFamily.ts";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import { getVenvScriptsDir } from "./paths.ts";
import { appConfig } from "../../config.ts";

function normalizeDir(p: string): string {
  return path.resolve(p).replace(/[/\\]+$/, "").toLowerCase();
}

/** All known venv Scripts/bin directories (default + cuda), whether or not they exist. */
export function allFamilyScriptsDirs(): string[] {
  return VENV_FAMILIES.map((f) => getVenvScriptsDir(f));
}

/**
 * Build an env for running tools in `family`:
 * - remove both family Scripts dirs from inherited PATH
 * - prepend only the selected family's Scripts (if present)
 * - optionally prepend configured system Python dir
 */
export function envForFamily(
  family: VenvFamily,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const sep = process.platform === "win32" ? ";" : ":";
  const strip = new Set(allFamilyScriptsDirs().map(normalizeDir));
  const existing = (base[pathKey] ?? process.env[pathKey] ?? "")
    .split(sep)
    .filter(Boolean)
    .filter((p) => !strip.has(normalizeDir(p)));

  const env: NodeJS.ProcessEnv = { ...base, [pathKey]: existing.join(sep) };

  const dirs: string[] = [];
  const scripts = getVenvScriptsDir(family);
  if (fs.existsSync(scripts)) dirs.push(scripts);
  const cfgPy = appConfig.systemPython;
  if (cfgPy) {
    const dir = path.dirname(cfgPy);
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  return envWithPrependedPaths(env, dirs);
}

/** Shell convenience: prepend default Scripts only (never use for CUDA job routing). */
export function envWithDefaultVenvOnPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return envForFamily("default", base);
}
