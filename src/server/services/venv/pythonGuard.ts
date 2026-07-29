import path from "path";
import fs from "fs";
import os from "os";

const PYTHON_BASENAME_RE = /^python(\d+(\.\d+)*)?(\.exe)?$/i;

/** Fixed PATH command names we will ever pass to execFile as the executable. */
export const PATH_PYTHON_COMMANDS = ["python3", "python"] as const;
export type PathPythonCommand = (typeof PATH_PYTHON_COMMANDS)[number];

/**
 * Trusted install roots for absolute Python interpreters.
 * Containment checks (`resolved === root || resolved.startsWith(root + sep)`)
 * are recognized by CodeQL as path-injection sanitizers.
 */
export function getAllowedPythonRoots(): string[] {
  const roots: string[] = [
    path.resolve("/usr"),
    path.resolve("/usr/local"),
    path.resolve("/opt"),
    path.resolve("/home"),
    path.resolve(os.homedir()),
    path.resolve(process.cwd(), ".venv"),
  ];
  if (process.platform === "win32") {
    for (const key of ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "USERPROFILE"] as const) {
      const v = process.env[key];
      if (v) roots.push(path.resolve(v));
    }
    roots.push(path.resolve("C:\\Python310"));
    roots.push(path.resolve("C:\\Python311"));
    roots.push(path.resolve("C:\\Python312"));
    roots.push(path.resolve("C:\\Python313"));
  }
  return roots;
}

export function isUnderAllowedPythonRoot(resolvedAbsPath: string): boolean {
  const normalized = path.normalize(resolvedAbsPath);
  if (normalized.includes("\0") || normalized.includes("..")) return false;
  for (const root of getAllowedPythonRoots()) {
    const rootNorm = path.normalize(root);
    if (normalized === rootNorm) return true;
    const prefix = rootNorm.endsWith(path.sep) ? rootNorm : rootNorm + path.sep;
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

export function isPathPythonCommand(value: string): value is PathPythonCommand {
  return (PATH_PYTHON_COMMANDS as readonly string[]).includes(value);
}

/**
 * Validate an absolute interpreter path: basename + allowed-root containment.
 * Does not touch the filesystem until containment succeeds.
 */
export function resolveAllowedPythonFile(
  pythonPath: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof pythonPath !== "string" || !pythonPath.trim()) {
    return { ok: false, error: "Missing pythonPath" };
  }
  if (pythonPath.includes("\0")) {
    return { ok: false, error: "Invalid pythonPath" };
  }
  const resolved = path.resolve(pythonPath.trim());
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: "pythonPath must be an absolute path" };
  }
  if (!isUnderAllowedPythonRoot(resolved)) {
    return {
      ok: false,
      error: "pythonPath must be under an allowed install location (e.g. /usr, ~/.local, Program Files).",
    };
  }
  const base = path.basename(resolved);
  if (!PYTHON_BASENAME_RE.test(base)) {
    return {
      ok: false,
      error: "pythonPath basename must look like a Python interpreter (python, python3, python.exe, …)",
    };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: `File not found: ${resolved}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Not a file: ${resolved}` };
  }
  return { ok: true, path: resolved };
}
