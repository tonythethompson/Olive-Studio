import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import { getVenvPython, getVenvPip, getVenvScriptsDir } from "./paths.ts";
import { appConfig } from "../../config.ts";

export const execFileAsync = promisify(execFile);

/** Prepend project .venv Scripts/bin (and optional python dir) so Olive works without system PATH. */
export function envWithVenvOnPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const dirs: string[] = [];
  const scripts = getVenvScriptsDir();
  if (fs.existsSync(scripts)) dirs.push(scripts);
  const cfgPy = appConfig.systemPython;
  if (cfgPy) {
    const dir = path.dirname(cfgPy);
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  return envWithPrependedPaths(base, dirs);
}

/** Permanently prepend project .venv Scripts/bin to the current user's PATH. */
export async function addVenvToUserPath(): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const scripts = getVenvScriptsDir();
  if (!fs.existsSync(scripts)) {
    return {
      ok: false,
      error: "Project .venv not found yet. Run Execute Live once (or create the venv) first.",
    };
  }
  const resolved = path.resolve(scripts);

  if (process.platform === "win32") {
    // Single-quoted PowerShell literal: JSON.stringify would leave `$` expandable in "..." strings.
    const psLiteral = `'${resolved.replace(/'/g, "''")}'`;
    const ps = `
$scripts = ${psLiteral}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -ne '' }
if ($parts | Where-Object { $_.TrimEnd('\\') -ieq $scripts.TrimEnd('\\') }) {
  Write-Output 'ALREADY'
  exit 0
}
$newPath = if ($userPath) { "$scripts;$userPath" } else { $scripts }
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
Write-Output 'ADDED'
`;
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], {
        timeout: 15_000,
      });
      const line = stdout.trim();
      if (line.includes("ALREADY")) return { ok: true, already: true };
      process.env.Path = envWithVenvOnPath(process.env).Path ?? process.env.Path;
      return { ok: true, already: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  const profile = path.join(os.homedir(), ".profile");
  const exportLine = `export PATH="${resolved}:$PATH"  # olive-studio .venv`;
  try {
    const existing = fs.existsSync(profile) ? fs.readFileSync(profile, "utf-8") : "";
    if (existing.includes(resolved)) {
      return { ok: true, already: true };
    }
    fs.appendFileSync(profile, `\n${exportLine}\n`, "utf-8");
    process.env.PATH = envWithVenvOnPath(process.env).PATH ?? process.env.PATH;
    return { ok: true, already: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export { getVenvPython, getVenvPip, getVenvScriptsDir };

// Backward-compat re-exports (prefer importing from src/server/config.ts directly)
export { readStudioConfig, writeStudioConfig } from "../../config.ts";
