import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { IHVProvider } from "../../../types.ts";
import { execFileAsync, readStudioConfig } from "./config.ts";
import {
  getVenvPython,
  getVenvScriptsDir,
  OLIVE_GPU_LAUNCHER,
} from "./paths.ts";
import { isGpuExecutionProvider } from "../../../lib/oliveGpuRuntime.ts";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import { getNativeGpuLibPaths } from "./gpu.ts";
import { pythonInstallGuidance } from "../../../lib/pythonPrerequisite.ts";
import { brewExecutable, readOsReleaseText } from "./installPython.ts";
import { findSystemPython, getPythonVersion, isSupportedOlivePython } from "./systemPython.ts";
import {
  detachAnyFamilyVenvListener,
  detachFamilyVenvListener,
  ensureVenvFamily,
} from "./familyEnsure.ts";
import { envForFamily } from "./pathIsolation.ts";
import { getDualRuntimeStatus } from "./status.ts";
import { resolveVenvFamily, humanFamilyLabel, type VenvFamily } from "../../../lib/venvFamily.ts";
import { ensureProviderCapability } from "./capabilityEnsure.ts";

export { findSystemPython, getPythonVersion, isSupportedOlivePython };
export { ensureVenvFamily, detachFamilyVenvListener, detachAnyFamilyVenvListener };
export { ensureProviderCapability };
export {
  getDualRuntimeStatus,
  invalidateRuntimeStatusCache,
  probeFamilyStatus,
  familyFlagsFromStatus,
  capabilityForProvider,
} from "./status.ts";
export type { RuntimeFamilyStatus, DualRuntimeStatus, CapabilityStatus } from "./status.ts";
export type { EnsureProviderCapabilityResult } from "./capabilityEnsure.ts";
export {
  assertFamilyOrtConstraints,
  enforcePackageConstraintsOrThrow,
  findForbiddenOrtInstallArgs,
  packageNameFromPipArg,
} from "./packageConstraints.ts";
export { getFamilySpec } from "./spec.ts";

type SetupListener = (line: string) => void;

/**
 * Ensures the default-family `.venv` exists with olive-ai + canonical ORT.
 * Compat wrapper: existing callers (OpenVINO/TRT/olive run) keep working via
 * the default-family resolver seam until PR2 routes by provider.
 */
export function ensureVenv(onLine: SetupListener): Promise<{ ok: boolean; error?: string }> {
  return ensureVenvFamily("default", onLine);
}

/**
 * Detach a previously-registered `ensureVenv` progress listener.
 * Also clears any in-flight family listeners (cancel during setup).
 */
export function detachVenvListener(onLine: SetupListener): void {
  detachFamilyVenvListener("default", onLine);
  detachAnyFamilyVenvListener(onLine);
}

export async function getRuntimeEnvStatus() {
  const venvPython = getVenvPython("default");
  const venvScripts = getVenvScriptsDir("default");
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

  const dual = await getDualRuntimeStatus({
    systemPython,
    configuredPython: cfg.systemPython ?? null,
    venvOnUserPath,
  });
  const def = dual.families.default;
  const pythonPrerequisite = systemPython
    ? null
    : pythonInstallGuidance(process.platform, {
        brewPresent: Boolean(brewExecutable()),
        osReleaseText: process.platform === "linux" ? readOsReleaseText() : "",
      });

  return {
    // Legacy single-venv fields (default family) — keep for existing UI.
    venvExists: def.exists,
    venvPython: def.python ?? (def.exists ? venvPython : null),
    venvScripts,
    oliveInstalled: def.oliveInstalled,
    oliveVersion: def.oliveVersion,
    systemPython,
    configuredPython: cfg.systemPython ?? null,
    venvOnUserPath,
    platform: process.platform,
    hint: dual.hint,
    pythonPrerequisite,
    // Additive dual-family status (PR1).
    families: dual.families,
  };
}

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
  /** Explicit family wins over provider-derived default. */
  family: VenvFamily = resolveVenvFamily(provider),
): { executable: string; args: string[]; family: VenvFamily } {
  const venvPython = getVenvPython(family);
  const oliveArgs = oliveSpawnArgs(configPath, listPackages);
  if (isGpuExecutionProvider(provider) && fs.existsSync(OLIVE_GPU_LAUNCHER)) {
    return { executable: venvPython, args: [OLIVE_GPU_LAUNCHER, ...oliveArgs], family };
  }
  return { executable: venvPython, args: ["-m", "olive", ...oliveArgs], family };
}

export async function buildOliveRunEnvironment(
  python: string,
  provider: IHVProvider,
  base: NodeJS.ProcessEnv,
  /** Explicit family wins over provider-derived default. */
  family: VenvFamily = resolveVenvFamily(provider),
): Promise<NodeJS.ProcessEnv> {
  let env = envForFamily(family, base);
  if (!isGpuExecutionProvider(provider)) {
    return env;
  }
  const libPaths = await getNativeGpuLibPaths(python);
  env = envWithPrependedPaths(env, libPaths);
  return env;
}

export { humanFamilyLabel, resolveVenvFamily };
