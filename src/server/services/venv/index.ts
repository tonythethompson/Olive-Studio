import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { IHVProvider } from "../../../types.ts";
import { execFileAsync, readStudioConfig, envWithVenvOnPath } from "./config.ts";
import {
  getVenvPython,
  getVenvPip,
  getVenvScriptsDir,
  VENV_DIR,
  OLIVE_GPU_LAUNCHER,
  PYTHON_MIN,
  PYTHON_MAX_RECOMMENDED,
} from "./paths.ts";
import { isGpuExecutionProvider } from "../../../lib/oliveGpuRuntime.ts";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import { getNativeGpuLibPaths } from "./gpu.ts";

async function getPythonVersion(
  candidate: string,
): Promise<{ major: number; minor: number; text: string } | null> {
  try {
    const { stdout, stderr } = await execFileAsync(candidate, ["--version"], { timeout: 8_000 });
    const text = `${stdout} ${stderr}`.trim();
    const m = text.match(/Python\s+(\d+)\.(\d+)/i);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), text };
  } catch {
    return null;
  }
}

function isSupportedOlivePython(v: { major: number; minor: number }): boolean {
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
  const candidates: string[] = [];

  const envPy = process.env.OLIVE_STUDIO_PYTHON?.trim();
  if (envPy) candidates.push(envPy);

  const cfgPy = readStudioConfig().systemPython?.trim();
  if (cfgPy) candidates.push(cfgPy);

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    for (const ver of ["312", "311", "313", "310"]) {
      if (localAppData) {
        candidates.push(path.join(localAppData, "Programs", "Python", `Python${ver}`, "python.exe"));
      }
      candidates.push(path.join(programFiles, "Python" + ver, "python.exe"));
    }
  }

  candidates.push("python", "python3");

  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if ((c.includes("/") || c.includes("\\")) && !fs.existsSync(c)) continue;
    if (await isRunnablePython(c)) return c;
  }
  return null;
}

/**
 * Ensures the .venv exists and olive-ai is installed.
 * Streams progress lines through the provided callback.
 */
export async function ensureVenv(onLine: (line: string) => void): Promise<{ ok: boolean; error?: string }> {
  const systemPython = await findSystemPython();
  if (!systemPython) {
    return {
      ok: false,
      error:
        "Python not found. Install Python 3.10–3.13 (3.12 recommended for torch/CUDA wheels), set a path in Runtime → Set Python, or set OLIVE_STUDIO_PYTHON.",
    };
  }

  if (!fs.existsSync(VENV_DIR)) {
    onLine("[setup] Creating Python virtual environment (.venv)...");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(systemPython, ["-m", "venv", VENV_DIR], { stdio: "pipe" });
      proc.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      proc.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`venv creation failed (exit ${code})`)),
      );
    });
    onLine("[setup] Virtual environment created.");
  }

  const venvPython = getVenvPython();
  let oliveInstalled = false;
  try {
    await execFileAsync(venvPython, ["-c", "import olive"]);
    oliveInstalled = true;
  } catch {
    /* not installed */
  }

  if (!oliveInstalled) {
    onLine("[setup] Installing olive-ai (this may take a few minutes)...");
    await new Promise<void>((resolve, reject) => {
      const pip = spawn(getVenvPip(), ["install", "olive-ai"], { stdio: "pipe" });
      pip.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`pip install failed (exit ${code})`)),
      );
    });
    onLine("[setup] olive-ai installed successfully.");
  }

  try {
    await execFileAsync(venvPython, ["-c", "import requests"]);
  } catch {
    onLine("[setup] Installing requests (Olive CLI dependency)...");
    await new Promise<void>((resolve, reject) => {
      const pip = spawn(getVenvPip(), ["install", "requests"], { stdio: "pipe" });
      pip.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`requests install failed (exit ${code})`)),
      );
    });
  }

  return { ok: true };
}

export async function getRuntimeEnvStatus() {
  const venvPython = getVenvPython();
  const venvScripts = getVenvScriptsDir();
  const venvExists = fs.existsSync(venvPython);
  let oliveInstalled = false;
  let oliveVersion: string | null = null;
  if (venvExists) {
    try {
      const { stdout } = await execFileAsync(
        venvPython,
        ["-c", "import olive; print(getattr(olive, '__version__', 'unknown'))"],
        { timeout: 15_000 },
      );
      oliveInstalled = true;
      oliveVersion = stdout.trim() || "unknown";
    } catch {
      oliveInstalled = false;
    }
  }
  const systemPython = await findSystemPython();
  const cfg = readStudioConfig();
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const userPath =
    process.platform === "win32"
      ? await (async () => {
          try {
            const { stdout } = await execFileAsync(
              "powershell.exe",
              ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"],
              { timeout: 10_000 },
            );
            return stdout.trim();
          } catch {
            return "";
          }
        })()
      : (process.env[pathKey] ?? "");
  const venvOnUserPath =
    Boolean(userPath) &&
    userPath
      .split(process.platform === "win32" ? ";" : ":")
      .some((p) => path.resolve(p) === path.resolve(venvScripts));

  return {
    venvExists,
    venvPython: venvExists ? venvPython : null,
    venvScripts,
    oliveInstalled,
    oliveVersion,
    systemPython,
    configuredPython: cfg.systemPython ?? null,
    venvOnUserPath,
    platform: process.platform,
    hint: !systemPython
      ? "No system Python found. Need 3.10–3.13 (3.12 recommended). Set python.exe below or OLIVE_STUDIO_PYTHON."
      : !venvExists
        ? "Project .venv missing — Install Olive venv now, or first Execute Live will create it."
        : !oliveInstalled
          ? "olive-ai not in .venv — Install Olive venv now, or first Execute Live will install it."
          : venvOnUserPath
            ? "Runtime ready. Project .venv is on your user PATH."
            : "Runtime ready inside the app. Optionally add .venv to user PATH for terminals.",
  };
}

export { getPythonVersion, isSupportedOlivePython };

/** Olive RunConfig parse + package scan without starting optimization. */
export async function runOliveConfigPreflight(
  configPath: string,
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  provider: IHVProvider = "CUDAExecutionProvider",
): Promise<{ ok: boolean; error?: string }> {
  const { executable, args } = resolveOliveCommand(provider, configPath, true);

  return new Promise((resolve) => {
    const proc = spawn(executable, args, { stdio: "pipe", env });
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => {
      data
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLine(`[preflight] ${line}`));
    });
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLine(`[preflight] ${line}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        onLine("[preflight] Olive RunConfig accepted (schema parse + package scan OK).");
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        error: stderr.trim() || `Olive preflight exited with code ${code ?? "unknown"}`,
      });
    });
    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to start Olive preflight: ${err.message}` });
    });
  });
}

function oliveSpawnArgs(configPath: string, listPackages: boolean): string[] {
  return listPackages
    ? ["run", "--config", configPath, "--list_required_packages"]
    : ["run", "--config", configPath];
}

export function resolveOliveCommand(
  provider: IHVProvider,
  configPath: string,
  listPackages: boolean,
): { executable: string; args: string[] } {
  const venvPython = getVenvPython();
  const oliveArgs = oliveSpawnArgs(configPath, listPackages);
  if (isGpuExecutionProvider(provider) && fs.existsSync(OLIVE_GPU_LAUNCHER)) {
    return { executable: venvPython, args: [OLIVE_GPU_LAUNCHER, ...oliveArgs] };
  }
  return { executable: venvPython, args: ["-m", "olive", ...oliveArgs] };
}

export async function buildOliveRunEnvironment(
  python: string,
  provider: IHVProvider,
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  let env = envWithVenvOnPath(base);
  if (!isGpuExecutionProvider(provider)) {
    return env;
  }
  const libPaths = await getNativeGpuLibPaths(python);
  env = envWithPrependedPaths(env, libPaths);
  return env;
}
