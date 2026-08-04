/**
 * Per-family ensure: create/install olive + canonical ORT via isolated build
 * when missing or contaminated, then transactional promote.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { execFileAsync } from "../shared/exec.ts";
import { findSystemPython } from "./systemPython.ts";
import { getVenvPython } from "./paths.ts";
import { envForFamily } from "./pathIsolation.ts";
import {
  clearBuildingRoot,
  familyPythonExists,
  promoteBuildingToLive,
  readVenvManifest,
  writeVenvManifest,
} from "./promote.ts";
import {
  clearMigrationJournal,
  inspectDefaultVenvIntent,
  withMigrationLock,
  writeMigrationJournal,
} from "./migration.ts";
import {
  getFamilyBuildingRoot,
  getFamilyRoot,
  getFamilySpec,
  getLegacyGpuBackupRoot,
} from "./spec.ts";
import { invalidateRuntimeStatusCache, listInstalledOrtDistributions } from "./status.ts";

type SetupListener = (line: string) => void;

interface FamilyInFlight {
  promise: Promise<{ ok: boolean; error?: string }>;
  listeners: Set<SetupListener>;
}

const familyInFlight = new Map<VenvFamily, FamilyInFlight>();

function notifyListener(listeners: Set<SetupListener>, listener: SetupListener, line: string): void {
  try {
    listener(line);
  } catch {
    listeners.delete(listener);
  }
}

function runPythonModule(
  python: string,
  args: string[],
  onLine: SetupListener,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(python, args, { stdio: "pipe", env });
    proc.stdout.on("data", (d: Buffer) => onLine(`[${label}] ${d.toString().trim()}`));
    proc.stderr.on("data", (d: Buffer) => onLine(`[${label}] ${d.toString().trim()}`));
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code})`)),
    );
  });
}

async function createVenvAt(root: string, systemPython: string, onLine: SetupListener): Promise<void> {
  fs.mkdirSync(path.dirname(root), { recursive: true });
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  onLine(`[setup] Creating virtual environment at ${root}...`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(systemPython, ["-m", "venv", root], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[setup] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[setup] " + d.toString().trim()));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`venv creation failed (exit ${code})`)),
    );
  });
}

function buildingPython(family: VenvFamily): string {
  const root = getFamilyBuildingRoot(family);
  return process.platform === "win32"
    ? path.join(root, "Scripts", "python.exe")
    : path.join(root, "bin", "python");
}

async function buildFamilyIsolated(
  family: VenvFamily,
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  try {
    clearBuildingRoot(family);
    await createVenvAt(getFamilyBuildingRoot(family), systemPython, onLine);
    const py = buildingPython(family);
    const spec = getFamilySpec(family);
    const buildEnv = envForFamily(family, { ...process.env });
    onLine(`[setup] Installing olive-ai into ${family} building tree...`);
    await runPythonModule(py, ["-m", "pip", "install", "--upgrade", "pip"], onLine, buildEnv, "pip");
    await runPythonModule(py, ["-m", "pip", "install", "olive-ai", "requests"], onLine, buildEnv, "pip");
    onLine(`[setup] Installing canonical ORT (${spec.ortDistribution})...`);
    await runPythonModule(
      py,
      ["-m", "pip", "uninstall", "-y", "onnxruntime", "onnxruntime-gpu", "onnxruntime-directml"],
      onLine,
      buildEnv,
      "pip",
    ).catch(() => undefined);
    await runPythonModule(
      py,
      ["-m", "pip", "install", ...spec.packageConstraints],
      onLine,
      buildEnv,
      "pip",
    );
    await execFileAsync(py, ["-c", "import olive, onnxruntime"], { timeout: 30_000 });
    writeVenvManifest(getFamilyBuildingRoot(family), {
      family,
      specVersion: spec.specVersion,
      ortDistribution: spec.ortDistribution,
      ortVersionSpec: spec.ortVersionSpec,
      createdAt: new Date().toISOString(),
    });
    const promoted = promoteBuildingToLive(family);
    if (!promoted.ok) return promoted;
    onLine(`[setup] ${family} runtime ready at ${getFamilyRoot(family)}`);
    invalidateRuntimeStatusCache();
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function familyNeedsRebuild(family: VenvFamily): Promise<boolean> {
  if (!familyPythonExists(family)) return true;
  const root = getFamilyRoot(family);
  const manifest = readVenvManifest(root);
  const spec = getFamilySpec(family);
  if (!manifest || manifest.specVersion !== spec.specVersion) return true;
  if (manifest.ortDistribution !== spec.ortDistribution) return true;
  const py = getVenvPython(family);
  try {
    await execFileAsync(py, ["-c", "import olive"], { timeout: 15_000 });
  } catch {
    return true;
  }
  const dists = await listInstalledOrtDistributions(py);
  if (!dists.includes(spec.ortDistribution)) return true;
  if (dists.some((d) => d !== spec.ortDistribution && (d.startsWith("onnxruntime")))) {
    // conflicting ORT flavor present
    const others = dists.filter((d) => d !== spec.ortDistribution);
    if (others.length > 0) return true;
  }
  return false;
}

/**
 * Migrate a GPU-contaminated `.venv` into dual-family layout (build first, swap last).
 */
async function migrateGpuContaminatedVenv(
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  return withMigrationLock(async () => {
    try {
      writeMigrationJournal("building");
      onLine("[migrate] GPU-contaminated .venv detected — building dual runtimes from scratch...");

      // 1) Build cuda.building
      clearBuildingRoot("cuda");
      const cudaBuild = await buildFamilyIsolated("cuda", systemPython, onLine);
      // buildFamilyIsolated already promotes — for migration we need BOTH built before swapping default.
      // Re-implement migration-specific sequence without promoting default yet.

      // Actually buildFamilyIsolated promotes immediately. For migration we need a custom path:
      // build cuda.building + validate (don't promote yet if live cuda missing), build default.building,
      // then rename live default → legacy, promote both.

      // Simpler approach for v1: 
      // - build+promote cuda first into .venvs/cuda (no conflict with .venv)
      // - then rebuild default via isolated build+promote (moves .venv → backup, promotes new default)
      if (!cudaBuild.ok) {
        writeMigrationJournal("building", cudaBuild.error);
        return cudaBuild;
      }
      writeMigrationJournal("cuda_built");
      writeMigrationJournal("cuda_promoted");

      // Rebuild default: isolated build promotes over .venv (backs up old)
      onLine("[migrate] Rebuilding default runtime (previous .venv kept as backup)...");
      writeMigrationJournal("building");
      const defBuild = await buildFamilyIsolated("default", systemPython, onLine);
      if (!defBuild.ok) {
        writeMigrationJournal("default_built", defBuild.error);
        return defBuild;
      }
      writeMigrationJournal("default_promoted");

      // Rename leftover backup to legacy-gpu if present
      const backups = fs
        .readdirSync(process.cwd())
        .filter((n) => n.startsWith(".venv.backup-"))
        .map((n) => path.join(process.cwd(), n));
      const legacy = getLegacyGpuBackupRoot();
      if (backups.length > 0 && !fs.existsSync(legacy)) {
        try {
          fs.renameSync(backups[0]!, legacy);
          writeMigrationJournal("legacy_renamed");
        } catch {
          /* keep backup name */
        }
      }

      writeMigrationJournal("complete");
      clearMigrationJournal();
      onLine("[migrate] Dual-runtime migration complete.");
      invalidateRuntimeStatusCache();
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeMigrationJournal("building", msg);
      return { ok: false, error: msg };
    }
  });
}

async function ensureVenvFamilyInner(
  family: VenvFamily,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  const systemPython = await findSystemPython();
  if (!systemPython) {
    return {
      ok: false,
      error:
        "Python not found. Install Python 3.10–3.13 (3.12 recommended for torch/CUDA wheels), set a path in Runtime → Set Python, or set OLIVE_STUDIO_PYTHON.",
    };
  }

  // First ensure on default: maybe migrate contaminated .venv
  if (family === "default" || family === "cuda") {
    const intent = await inspectDefaultVenvIntent(listInstalledOrtDistributions);
    if (intent === "cuda-contaminated" && !familyPythonExists("cuda")) {
      onLine("[migrate] Existing .venv has onnxruntime-gpu — migrating to dual-runtime layout...");
      const migrated = await migrateGpuContaminatedVenv(systemPython, onLine);
      if (!migrated.ok) return migrated;
      if (family === "cuda" && familyPythonExists("cuda")) {
        const needs = await familyNeedsRebuild("cuda");
        if (!needs) return { ok: true };
      }
      if (family === "default" && familyPythonExists("default")) {
        const needs = await familyNeedsRebuild("default");
        if (!needs) return { ok: true };
      }
    }
  }

  const needs = await familyNeedsRebuild(family);
  if (!needs) {
    onLine(`[setup] ${family} runtime already healthy.`);
    return { ok: true };
  }

  onLine(`[setup] Preparing ${family} runtime (isolated build)...`);
  return buildFamilyIsolated(family, systemPython, onLine);
}

/**
 * Ensure a venv family exists with olive-ai + canonical ORT.
 * Concurrent callers for the same family share one in-flight promise.
 */
export function ensureVenvFamily(
  family: VenvFamily,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  const existing = familyInFlight.get(family);
  if (existing) {
    existing.listeners.add(onLine);
    notifyListener(
      existing.listeners,
      onLine,
      `[setup] ${family} environment setup already in progress — attaching...`,
    );
    return existing.promise;
  }

  const listeners = new Set<SetupListener>([onLine]);
  const broadcast = (line: string) => {
    for (const listener of Array.from(listeners)) notifyListener(listeners, listener, line);
  };

  const promise = ensureVenvFamilyInner(family, broadcast).finally(() => {
    familyInFlight.delete(family);
  });
  familyInFlight.set(family, { promise, listeners });
  return promise;
}

export function detachFamilyVenvListener(family: VenvFamily, onLine: SetupListener): void {
  familyInFlight.get(family)?.listeners.delete(onLine);
}

/** Detach from any in-flight family setup (cancel during setup). */
export function detachAnyFamilyVenvListener(onLine: SetupListener): void {
  for (const flight of familyInFlight.values()) {
    flight.listeners.delete(onLine);
  }
}
