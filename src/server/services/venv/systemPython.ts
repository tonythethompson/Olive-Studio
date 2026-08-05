/**
 * System Python discovery for creating project venvs.
 * Extracted from index.ts so familyEnsure can import without a cycle.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileAsync, readStudioConfig } from "./config.ts";
import { PYTHON_MIN, PYTHON_MAX_RECOMMENDED } from "./paths.ts";
import { isPathPythonCommand, resolveAllowedPythonFile, type PathPythonCommand } from "./pythonGuard.ts";

function resolveProbeScript(): string {
  const cwdPath = path.join(process.cwd(), "scripts", "probe-python-version.mjs");
  if (fs.existsSync(cwdPath)) return cwdPath;
  const modulePath = fileURLToPath(new URL("../../../../scripts/probe-python-version.mjs", import.meta.url));
  return modulePath;
}

const PROBE_SCRIPT = resolveProbeScript();

function parsePythonVersionText(text: string): { major: number; minor: number; text: string } | null {
  const m = text.match(/Python\s+(\d+)\.(\d+)/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), text: text.trim() };
}

async function execPythonVersionFromPathCmd(
  cmd: PathPythonCommand,
): Promise<{ major: number; minor: number; text: string } | null> {
  try {
    // Call sites must pass string literals only (`"python3"` / `"python"`) so CodeQL
    // does not treat the executable as data-dependent.
    const { stdout, stderr } =
      cmd === "python3"
        ? await execFileAsync("python3", ["--version"], { timeout: 8_000 })
        : await execFileAsync("python", ["--version"], { timeout: 8_000 });
    return parsePythonVersionText(`${stdout} ${stderr}`);
  } catch {
    return null;
  }
}

async function execPythonVersionFromFile(
  absolutePython: string,
): Promise<{ major: number; minor: number; text: string } | null> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [PROBE_SCRIPT, absolutePython], {
      timeout: 10_000,
    });
    return parsePythonVersionText(`${stdout} ${stderr}`);
  } catch (err: unknown) {
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    return parsePythonVersionText(`${stdout} ${stderr}`);
  }
}

/**
 * Probe `python --version` for a candidate.
 * PATH names must be exact literals; absolute paths must pass allowlisted-root checks.
 */
export async function getPythonVersion(
  candidate: string,
): Promise<{ major: number; minor: number; text: string } | null> {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) return null;
  const trimmed = candidate.trim();

  if (!trimmed.includes("/") && !trimmed.includes("\\")) {
    if (!isPathPythonCommand(trimmed)) return null;
    return execPythonVersionFromPathCmd(trimmed);
  }

  const allowed = resolveAllowedPythonFile(trimmed);
  if (!allowed.ok) return null;
  return execPythonVersionFromFile(allowed.path);
}

export function isSupportedOlivePython(v: { major: number; minor: number }): boolean {
  if (v.major !== PYTHON_MIN.major) return false;
  return v.minor >= PYTHON_MIN.minor && v.minor <= PYTHON_MAX_RECOMMENDED.minor;
}

async function isRunnablePython(candidate: string): Promise<boolean> {
  const v = await getPythonVersion(candidate);
  return v != null && isSupportedOlivePython(v);
}

/**
 * Resolve a system Python for creating the project venv.
 * Order: env OLIVE_STUDIO_PYTHON → saved config → preferred installs (3.12 first) → PATH.
 */
export async function findSystemPython(): Promise<string | null> {
  const fileCandidates: string[] = [];

  const envPy = process.env.OLIVE_STUDIO_PYTHON?.trim();
  if (envPy) fileCandidates.push(envPy);

  const cfgPy = readStudioConfig().systemPython?.trim();
  if (cfgPy) fileCandidates.push(cfgPy);

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    for (const ver of ["312", "311", "313", "310"]) {
      if (localAppData) {
        fileCandidates.push(path.join(localAppData, "Programs", "Python", `Python${ver}`, "python.exe"));
      }
      fileCandidates.push(path.join(programFiles, "Python" + ver, "python.exe"));
    }
  }

  const seen = new Set<string>();
  for (const c of fileCandidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const allowed = resolveAllowedPythonFile(c);
    if (!allowed.ok) continue;
    if (await isRunnablePython(allowed.path)) return allowed.path;
  }

  if (await isRunnablePython("python3")) return "python3";
  if (await isRunnablePython("python")) return "python";
  return null;
}
