/**
 * Process-local PATH isolation for a selected venv family.
 * Strips both known family Scripts dirs before prepending the selected one.
 */
import fs from "fs";
import path from "path";
import { VENV_FAMILIES, type VenvFamily } from "../../../lib/venvFamily.ts";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import { getVenvScriptsDir } from "./paths.ts";
import { getFamilyBuildingRoot, getFamilyRoot } from "./spec.ts";
import { appConfig } from "../../config.ts";

function normalizeDir(p: string): string {
  return path.resolve(p).replace(/[/\\]+$/, "").toLowerCase();
}

function scriptsDirForRoot(root: string): string {
  return process.platform === "win32"
    ? path.join(root, "Scripts")
    : path.join(root, "bin");
}

/** All known venv Scripts/bin directories (live + building), whether or not they exist. */
export function allFamilyScriptsDirs(): string[] {
  const dirs: string[] = [];
  for (const family of VENV_FAMILIES) {
    dirs.push(getVenvScriptsDir(family));
    dirs.push(scriptsDirForRoot(getFamilyBuildingRoot(family)));
  }
  return dirs;
}

/**
 * Build an env for running tools against an explicit venv root (live or building):
 * - remove known family Scripts dirs from inherited PATH
 * - prepend only that root's Scripts/bin (if present)
 * - optionally prepend configured system Python dir
 * - clear PYTHONPATH / PYTHONHOME and set VIRTUAL_ENV to the root
 */
export function envForVenvRoot(
  root: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const sep = process.platform === "win32" ? ";" : ":";
  const strip = new Set(allFamilyScriptsDirs().map(normalizeDir));

  let inherited: string | undefined;
  for (const [key, value] of Object.entries(base)) {
    if (key.toLowerCase() === "path" && typeof value === "string") {
      inherited = value;
      break;
    }
  }
  if (inherited === undefined) {
    inherited = process.env[pathKey] ?? process.env.PATH ?? process.env.Path ?? "";
  }

  const existing = inherited
    .split(sep)
    .filter(Boolean)
    .filter((p) => !strip.has(normalizeDir(p)));

  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  env[pathKey] = existing.join(sep);
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  env.VIRTUAL_ENV = root;

  const dirs: string[] = [];
  const scripts = scriptsDirForRoot(root);
  if (fs.existsSync(scripts)) dirs.push(scripts);
  const cfgPy = appConfig.systemPython;
  if (cfgPy) {
    const dir = path.dirname(cfgPy);
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  return envWithPrependedPaths(env, dirs);
}

/**
 * Build an env for running tools in `family`'s live root.
 */
export function envForFamily(
  family: VenvFamily,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return envForVenvRoot(getFamilyRoot(family), base);
}

/** Shell convenience: prepend default Scripts only (never use for CUDA job routing). */
export function envWithDefaultVenvOnPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return envForFamily("default", base);
}
