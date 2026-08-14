/**
 * Optional system-Python install for first-run / missing-interpreter cases.
 * Windows: winget, then pymanager. macOS: Homebrew when present.
 * Linux: never auto-installs (needs root); returns a copyable package command.
 */
import fs from "fs";
import {
  OLIVE_PYTHON_BREW_FORMULA,
  OLIVE_PYTHON_RECOMMENDED,
  OLIVE_PYTHON_WINGET_ID,
  pythonDownloadUrl,
  pythonInstallGuidance,
} from "../../../lib/pythonPrerequisite.ts";
import { writeStudioConfig } from "../../config.ts";
import { execFileAsync } from "./config.ts";
import { resolveAllowedPythonFile } from "./pythonGuard.ts";
import { findSystemPython } from "./systemPython.ts";
import { invalidateRuntimeStatusCache } from "./status.ts";

export type InstallPythonResult = {
  ok: boolean;
  error?: string;
  python?: string | null;
  method?: "winget" | "pymanager" | "brew" | "manual";
  downloadUrl: string;
  command?: string;
};

const INSTALL_TIMEOUT_MS = 600_000;

export function brewExecutable(): string | null {
  const candidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/home/linuxbrew/.linuxbrew/bin/brew"];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function readOsReleaseText(): string {
  try {
    return fs.readFileSync("/etc/os-release", "utf-8");
  } catch {
    return "";
  }
}

export function persistDiscoveredPython(python: string): string | null {
  if (!python.includes("/") && !python.includes("\\")) return null;
  const safe = resolveAllowedPythonFile(python);
  if (!safe.ok) return null;
  writeStudioConfig({ systemPython: safe.path });
  process.env.OLIVE_STUDIO_PYTHON = safe.path;
  invalidateRuntimeStatusCache();
  return safe.path;
}

async function runLiteral(
  file: "winget" | "pymanager" | string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: INSTALL_TIMEOUT_MS,
      windowsHide: true,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err: unknown) {
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: `${stdout}\n${stderr}\n${msg}`.trim() };
  }
}

async function rediscover(): Promise<string | null> {
  const found = await findSystemPython();
  if (!found) return null;
  return persistDiscoveredPython(found) ?? found;
}

export async function installSystemPython(onLine: (line: string) => void): Promise<InstallPythonResult> {
  const downloadUrl = pythonDownloadUrl(process.platform);
  const existing = await findSystemPython();
  if (existing) {
    const persisted = persistDiscoveredPython(existing) ?? existing;
    onLine(`Using existing Python at ${persisted}.`);
    return { ok: true, python: persisted, downloadUrl, method: "manual" };
  }

  if (process.platform === "win32") {
    onLine(`Installing Python ${OLIVE_PYTHON_RECOMMENDED} with Windows Package Manager…`);
    const winget = await runLiteral("winget", [
      "install",
      "-e",
      "--id",
      OLIVE_PYTHON_WINGET_ID,
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--disable-interactivity",
      "--silent",
    ]);
    if (winget.ok) {
      const found = await rediscover();
      if (found) {
        onLine(`Installed with winget: ${found}`);
        return { ok: true, python: found, method: "winget", downloadUrl };
      }
    } else {
      onLine("winget did not install Python. Trying the Python install manager…");
    }

    const manager = await runLiteral("pymanager", ["install", OLIVE_PYTHON_RECOMMENDED]);
    if (manager.ok) {
      const found = await rediscover();
      if (found) {
        onLine(`Installed with pymanager: ${found}`);
        return { ok: true, python: found, method: "pymanager", downloadUrl };
      }
    }

    return {
      ok: false,
      method: "manual",
      downloadUrl,
      command: pythonInstallGuidance("win32").command,
      error:
        `Could not install Python automatically. Download ${OLIVE_PYTHON_RECOMMENDED} from ${downloadUrl}, ` +
        "tick “Add python.exe to PATH”, then click Refresh.",
    };
  }

  if (process.platform === "darwin") {
    const brew = brewExecutable();
    if (brew) {
      onLine(`Installing ${OLIVE_PYTHON_BREW_FORMULA} with Homebrew…`);
      const result = await runLiteral(brew, ["install", OLIVE_PYTHON_BREW_FORMULA]);
      if (result.ok) {
        const found = await rediscover();
        if (found) {
          onLine(`Installed with Homebrew: ${found}`);
          return { ok: true, python: found, method: "brew", downloadUrl };
        }
      }
    }
    const guidance = pythonInstallGuidance("darwin", { brewPresent: Boolean(brew) });
    return {
      ok: false,
      method: "manual",
      downloadUrl,
      command: guidance.command,
      error: `Install Python ${OLIVE_PYTHON_RECOMMENDED} with Homebrew (${guidance.command}) or from ${downloadUrl}.`,
    };
  }

  const guidance = pythonInstallGuidance("linux", { osReleaseText: readOsReleaseText() });
  onLine("Linux package installs need administrator access. Use the command below, then Refresh.");
  return {
    ok: false,
    method: "manual",
    downloadUrl,
    command: guidance.command,
    error: `Install Python with your package manager, then Refresh. Example: ${guidance.command}`,
  };
}
