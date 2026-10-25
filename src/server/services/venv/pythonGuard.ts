import path from "path";
import fs from "fs";
import os from "os";

export const PYTHON_BASENAME_RE = /^python(\d+(\.\d+)*)?(\.exe)?$/i;

/** Fixed PATH command names we will ever pass to execFile as the executable. */
export const PATH_PYTHON_COMMANDS = ["python3", "python"] as const;
export type PathPythonCommand = (typeof PATH_PYTHON_COMMANDS)[number];

/**
 * Trusted install roots for absolute Python interpreters.
 * Paths are re-joined from (root, relative) after a `..` check so CodeQL
 * treats the result as a sanitized path expression.
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
  if (process.platform === "darwin") {
    roots.push(path.resolve("/Library/Frameworks/Python.framework"));
  }
  return roots;
}

/**
 * Map a resolved absolute path onto an allowlisted root via path.relative /
 * path.join (CodeQL-recognized path-injection sanitizer).
 */
export function rebaseOntoAllowedPythonRoot(resolvedAbsPath: string): string | null {
  const normalized = path.normalize(resolvedAbsPath);
  if (normalized.includes("\0")) return null;

  for (const root of getAllowedPythonRoots()) {
    const rootNorm = path.normalize(root);
    const relative = path.relative(rootNorm, normalized);
    // Reject escape / absolute relatives (Windows can yield absolute relatives).
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      if (normalized === rootNorm) {
        // Exact root itself is not a python file; skip.
        continue;
      }
      continue;
    }
    if (relative.split(path.sep).includes("..")) continue;
    return path.join(rootNorm, relative);
  }
  return null;
}

export function isUnderAllowedPythonRoot(resolvedAbsPath: string): boolean {
  return rebaseOntoAllowedPythonRoot(resolvedAbsPath) != null;
}

export function isPathPythonCommand(value: string): value is PathPythonCommand {
  return (PATH_PYTHON_COMMANDS as readonly string[]).includes(value);
}

/**
 * Validate an absolute interpreter path: basename + allowed-root containment.
 * Filesystem access uses the rebased (root + relative) path only.
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
  const rawPath = pythonPath.trim();
  // Check absoluteness before resolve — path.resolve() always yields absolute.
  if (!path.isAbsolute(rawPath)) {
    return { ok: false, error: "pythonPath must be an absolute path" };
  }
  const resolved = path.resolve(rawPath);

  let safePath = rebaseOntoAllowedPythonRoot(resolved);
  if (!safePath) {
    return {
      ok: false,
      error: "pythonPath must be under an allowed install location (e.g. /usr, ~/.local, Program Files).",
    };
  }

  const base = path.basename(safePath);
  if (!PYTHON_BASENAME_RE.test(base)) {
    return {
      ok: false,
      error: "pythonPath basename must look like a Python interpreter (python, python3, python.exe, …)",
    };
  }

  let stat: fs.Stats;
  try {
    // Canonicalize symlinks, then re-verify containment before trusting the path.
    const real = fs.realpathSync(safePath);
    const realSafe = rebaseOntoAllowedPythonRoot(real);
    if (!realSafe) {
      return { ok: false, error: `pythonPath resolves outside allowed locations: ${safePath}` };
    }
    safePath = realSafe;
    stat = fs.statSync(safePath);
  } catch {
    return { ok: false, error: `File not found: ${safePath}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Not a file: ${safePath}` };
  }
  return { ok: true, path: safePath };
}
