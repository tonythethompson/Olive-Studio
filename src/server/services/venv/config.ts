import path from "path";
import fs from "fs";
import os from "os";
import { getVenvScriptsDir } from "./paths.ts";
import { execFileAsync } from "../shared/exec.ts";
import { envWithDefaultVenvOnPath } from "./pathIsolation.ts";

// Re-export the shared helper so existing importers keep working.
export { execFileAsync };

/**
 * Shell / run convenience: prepend default-family Scripts only.
 * Strips both known family Script dirs first (see pathIsolation).
 * Do not use this for CUDA-family job routing (PR2).
 */
export function envWithVenvOnPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return envWithDefaultVenvOnPath(base);
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

  // Target the shells the user actually loads. zsh (macOS default) does not read
  // ~/.profile for interactive shells, so also write ~/.zshrc there; keep ~/.profile
  // for bash/sh. Writing to a profile that is never sourced would report a false success.
  const home = os.homedir();
  const exportLine = `export PATH="${resolved}:$PATH"  # olive-studio .venv`;
  const targets = new Set<string>([path.join(home, ".profile")]);
  const shell = process.env.SHELL ?? "";
  if (process.platform === "darwin" || shell.endsWith("zsh")) {
    targets.add(path.join(home, ".zshrc"));
  }
  if (shell.endsWith("bash")) {
    // Interactive non-login bash reads ~/.bashrc; login bash reads the first of
    // ~/.bash_profile / ~/.bash_login / ~/.profile. Cover an existing login
    // profile when present. Never create ~/.bash_profile: that would shadow
    // ~/.profile (already in targets) and drop the user's login setup.
    targets.add(path.join(home, ".bashrc"));
    const loginProfile = [".bash_profile", ".bash_login"]
      .map((f) => path.join(home, f))
      .find((p) => fs.existsSync(p));
    if (loginProfile) targets.add(loginProfile);
  }

  try {
    let allAlready = true;
    for (const profile of targets) {
      const existing = fs.existsSync(profile) ? fs.readFileSync(profile, "utf-8") : "";
      // Match the exact export line we write, not a bare path substring (comments
      // or superstring paths would otherwise false-skip the append).
      if (existing.split(/\r?\n/).some((l) => l.trim() === exportLine)) continue;
      fs.appendFileSync(profile, `\n${exportLine}\n`, "utf-8");
      allAlready = false;
    }
    process.env.PATH = envWithVenvOnPath(process.env).PATH ?? process.env.PATH;
    return { ok: true, already: allAlready };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// Backward-compat re-exports (prefer importing from src/server/config.ts directly)
export { readStudioConfig, writeStudioConfig } from "../../config.ts";
