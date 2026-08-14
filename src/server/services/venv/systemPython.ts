/**
 * System Python discovery for creating project venvs.
 * Extracted from index.ts so familyEnsure can import without a cycle.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PREFERRED_PYTHON_MINORS } from "../../../lib/pythonPrerequisite.ts";
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

/** Pull absolute python.exe paths out of `pymanager` / `py` list output. */
export function parsePythonExeLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    const hits: string[] = [];
    if (/^[A-Za-z]:[\\/].+\.exe$/i.test(trimmed) || /(^|[/\\])python(\d+(\.\d+)*)?(\.exe)?$/i.test(trimmed)) {
      if (trimmed.includes("/") || trimmed.includes("\\")) hits.push(trimmed);
    }
    const win = trimmed.matchAll(/([A-Za-z]:\\[^\s*"']+python(?:\d+(?:\.\d+)*)?\.exe)/gi);
    for (const m of win) hits.push(m[1]!);
    const posix = trimmed.matchAll(/((?:\/[\w.+-]+)+\/python(?:\d+(?:\.\d+)*)?)/g);
    for (const m of posix) hits.push(m[1]!);
    for (const hit of hits) {
      if (seen.has(hit)) continue;
      seen.add(hit);
      out.push(hit);
    }
  }
  return out;
}

function pushUnique(list: string[], value: string | undefined): void {
  if (!value) return;
  if (list.includes(value)) return;
  list.push(value);
}

function listImmediateSubdirInterpreters(root: string, nameRe: RegExp, relPython: string[]): string[] {
  const found: string[] = [];
  try {
    const ents = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of ents) {
      if (!ent.isDirectory() || ent.name.includes("\0")) continue;
      if (!nameRe.test(ent.name)) continue;
      for (const rel of relPython) {
        found.push(path.join(root, ent.name, rel));
      }
    }
  } catch {
    /* missing dir */
  }
  return found;
}

/**
 * Known-good install locations, 3.12 first.
 * Exported for unit tests (no process spawn).
 */
export function collectPreferredPythonFileCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const fileCandidates: string[] = [];
  const home = os.homedir();

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "";
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    for (const ver of ["312", "311", "313", "310"]) {
      if (localAppData) {
        pushUnique(fileCandidates, path.join(localAppData, "Programs", "Python", `Python${ver}`, "python.exe"));
        pushUnique(fileCandidates, path.join(localAppData, "Python", "bin", `python3.${ver.slice(1)}.exe`));
        pushUnique(fileCandidates, path.join(localAppData, "Python", "bin", "python.exe"));
      }
      pushUnique(fileCandidates, path.join(programFiles, "Python" + ver, "python.exe"));
      pushUnique(fileCandidates, path.join(programFilesX86, "Python" + ver, "python.exe"));
      pushUnique(fileCandidates, path.join(`C:\\Python${ver}`, "python.exe"));
    }
    if (localAppData) {
      const managerRoot = path.join(localAppData, "Python");
      for (const p of listImmediateSubdirInterpreters(
        managerRoot,
        /^pythoncore-3\.(10|11|12|13)\b/i,
        ["python.exe"],
      )) {
        pushUnique(fileCandidates, p);
      }
    }
    if (home) {
      pushUnique(fileCandidates, path.join(home, "scoop", "apps", "python", "current", "python.exe"));
      pushUnique(fileCandidates, path.join(home, "scoop", "apps", "python312", "current", "python.exe"));
    }
    return fileCandidates;
  }

  const versionedNames = PREFERRED_PYTHON_MINORS.flatMap((minor) => [`python3.${minor}`, `python${minor}`]);
  const binDirs = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin"];
  if (home) {
    binDirs.push(path.join(home, ".local", "bin"));
  }
  for (const dir of binDirs) {
    for (const name of versionedNames) {
      pushUnique(fileCandidates, path.join(dir, name));
    }
  }

  if (platform === "darwin") {
    for (const minor of PREFERRED_PYTHON_MINORS) {
      pushUnique(
        fileCandidates,
        `/Library/Frameworks/Python.framework/Versions/3.${minor}/bin/python3`,
      );
      pushUnique(
        fileCandidates,
        `/Library/Frameworks/Python.framework/Versions/3.${minor}/bin/python3.${minor}`,
      );
    }
  }

  if (home) {
    for (const p of listImmediateSubdirInterpreters(
      path.join(home, ".pyenv", "versions"),
      /^3\.(10|11|12|13)(\.|$)/,
      ["bin/python", "bin/python3"],
    )) {
      pushUnique(fileCandidates, p);
    }
  }

  return fileCandidates;
}

async function execLiteralList(
  cmd: "pymanager" | "py",
  args: string[],
): Promise<string> {
  try {
    const { stdout, stderr } =
      cmd === "pymanager"
        ? await execFileAsync("pymanager", args, { timeout: 8_000, windowsHide: true })
        : await execFileAsync("py", args, { timeout: 8_000, windowsHide: true });
    return `${stdout}\n${stderr}`;
  } catch (err: unknown) {
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    return `${stdout}\n${stderr}`;
  }
}

/** Ask the Windows Python install manager / legacy launcher for interpreter paths. */
export async function listWindowsManagedPythonPaths(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const attempts: Array<{ cmd: "pymanager" | "py"; args: string[] }> = [
    { cmd: "pymanager", args: ["list", "--format=exe"] },
    { cmd: "py", args: ["list", "--format=exe"] },
    { cmd: "py", args: ["-0p"] },
  ];
  for (const attempt of attempts) {
    const text = await execLiteralList(attempt.cmd, attempt.args);
    const paths = parsePythonExeLines(text);
    if (paths.length > 0) return paths;
  }
  return [];
}

/**
 * Resolve a system Python for creating the project venv.
 * Order: env OLIVE_STUDIO_PYTHON → saved config → preferred installs (3.12 first)
 * → Windows install manager / py launcher → PATH.
 */
export async function findSystemPython(): Promise<string | null> {
  const fileCandidates: string[] = [];

  const envPy = process.env.OLIVE_STUDIO_PYTHON?.trim();
  if (envPy) fileCandidates.push(envPy);

  const cfgPy = readStudioConfig().systemPython?.trim();
  if (cfgPy) fileCandidates.push(cfgPy);

  fileCandidates.push(...collectPreferredPythonFileCandidates(process.platform));

  const seen = new Set<string>();
  const tryCandidates = async (candidates: string[]): Promise<string | null> => {
    for (const c of candidates) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      const allowed = resolveAllowedPythonFile(c);
      if (!allowed.ok) continue;
      if (await isRunnablePython(allowed.path)) return allowed.path;
    }
    return null;
  };

  const fromFiles = await tryCandidates(fileCandidates);
  if (fromFiles) return fromFiles;

  if (process.platform === "win32") {
    const fromManager = await tryCandidates(await listWindowsManagedPythonPaths());
    if (fromManager) return fromManager;
  }

  if (await isRunnablePython("python3")) return "python3";
  if (await isRunnablePython("python")) return "python";
  return null;
}
