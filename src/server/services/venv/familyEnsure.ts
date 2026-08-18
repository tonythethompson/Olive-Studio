/**
 * Per-family ensure: create/install olive + canonical ORT via isolated build
 * when missing or contaminated, then transactional promote.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { execFileAsync } from "../shared/exec.ts";
import { findSystemPython, getPythonVersion } from "./systemPython.ts";
import { getVenvPython, pythonPathForRoot } from "./paths.ts";
import { envForVenvRoot } from "./pathIsolation.ts";
import {
  clearBuildingRoot,
  familyPythonExists,
  promoteBuildingToLive,
  readVenvManifest,
  rollbackPromotedFamily,
  writeVenvManifest,
} from "./promote.ts";
import {
  clearMigrationJournal,
  inspectDefaultVenvIntent,
  withMigrationLock,
  writeMigrationJournal,
} from "./migration.ts";
import {
  conflictingOrtDistributions,
  getFamilyBuildingRoot,
  getFamilyRoot,
  getFamilySpec,
  getLegacyGpuBackupRoot,
} from "./spec.ts";
import { invalidateRuntimeStatusCache, listInstalledOrtDistributions } from "./status.ts";
import {
  isQnnFamilyPythonMinor,
  PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION,
  PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION,
  qnnNumpyPinForPythonMinor,
} from "../../../lib/qnnDeps.ts";

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

export async function createVenvAt(root: string, systemPython: string, onLine: SetupListener): Promise<void> {
  fs.mkdirSync(path.dirname(root), { recursive: true });
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  onLine(`[setup] Creating virtual environment at ${root}...`);
  // Isolate from ambient live/building family Scripts so systemPython -m venv
  // does not inherit a contaminated PATH / VIRTUAL_ENV.
  const createEnv = envForVenvRoot(root, { ...process.env });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(systemPython, ["-m", "venv", root], { stdio: "pipe", env: createEnv });
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    proc.stdout.on("data", (d: Buffer) => onLine("[setup] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[setup] " + d.toString().trim()));
    proc.on("error", (err: Error) => settle(() => reject(err)));
    proc.on("close", (code) =>
      settle(() =>
        code === 0 ? resolve() : reject(new Error(`venv creation failed (exit ${code})`)),
      ),
    );
  });
}

function buildingPython(family: VenvFamily): string {
  return pythonPathForRoot(getFamilyBuildingRoot(family));
}

/**
 * Build a family into its `.building` root and validate imports.
 * Does not promote — callers promote after peer builds succeed when needed.
 */
async function assertQnnFamilyPythonGate(
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: true; minor: string; numpyPin: string } | { ok: false; error: string }> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      error:
        "QNN runtime install is Windows-first in this Studio release (Win ARM64 inference / Win x64 preparation). Other platforms are out of scope before .venvs/qnn.building is created.",
    };
  }
  const arch = process.arch.toLowerCase();
  if (!["x64", "arm64"].includes(arch)) {
    return {
      ok: false,
      error: `QNN runtime requires Windows x64 or ARM64 (got arch ${process.arch}). Rejected before creating .venvs/qnn.building.`,
    };
  }
  const ver = await getPythonVersion(systemPython);
  if (!ver) {
    return { ok: false, error: "Could not probe Python version for QNN family build." };
  }
  const minor = `${ver.major}.${ver.minor}`;
  if (!isQnnFamilyPythonMinor(minor)) {
    return {
      ok: false,
      error: `QNN runtime requires CPython 3.11–3.13 (got ${ver.text}). Python 3.10 is rejected before creating .venvs/qnn.building.`,
    };
  }
  const numpyPin = qnnNumpyPinForPythonMinor(minor);
  if (!numpyPin) {
    return { ok: false, error: `No tested NumPy pin for Python ${minor}.` };
  }
  onLine(
    `[setup] QNN family Python gate passed (${ver.text}, win32/${arch}); NumPy pin ${numpyPin}`,
  );
  return { ok: true, minor, numpyPin };
}

async function buildFamilyTree(
  family: VenvFamily,
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  try {
    let qnnNumpyPin: string | undefined;
    if (family === "qnn") {
      const gate = await assertQnnFamilyPythonGate(systemPython, onLine);
      if (!gate.ok) return { ok: false, error: gate.error };
      qnnNumpyPin = gate.numpyPin;
    }

    await clearBuildingRoot(family);
    await createVenvAt(getFamilyBuildingRoot(family), systemPython, onLine);
    const py = buildingPython(family);
    const spec = getFamilySpec(family);
    // Isolate against the building root (not live). envForFamily would point
    // VIRTUAL_ENV/PATH at the existing live tree and break isolation.
    const buildEnv = envForVenvRoot(getFamilyBuildingRoot(family), { ...process.env });
    onLine(`[setup] Installing olive-ai into ${family} building tree...`);
    await runPythonModule(py, ["-m", "pip", "install", "--upgrade", "pip"], onLine, buildEnv, "pip");
    await runPythonModule(py, ["-m", "pip", "install", ...spec.oliveInstallArgs], onLine, buildEnv, "pip");
    onLine(`[setup] Installing canonical ORT (${spec.ortDistribution})...`);
    await runPythonModule(
      py,
      ["-m", "pip", "uninstall", "-y", "onnxruntime", "onnxruntime-gpu", "onnxruntime-directml", "onnxruntime-openvino"],
      onLine,
      buildEnv,
      "pip",
    ).catch(() => undefined);
    await runPythonModule(
      py,
      ["-m", "pip", "install", ...spec.ortInstallArgs],
      onLine,
      buildEnv,
      "pip",
    );

    if (spec.supplementalInstallArgs?.length) {
      onLine(`[setup] Installing supplemental packages for ${family}...`);
      await runPythonModule(
        py,
        ["-m", "pip", "install", ...spec.supplementalInstallArgs],
        onLine,
        buildEnv,
        "pip",
      );
    }

    const importCheck =
      family === "qnn"
        ? "import olive, onnxruntime, onnxruntime_qnn, numpy"
        : "import olive, onnxruntime";
    await execFileAsync(py, ["-c", importCheck], {
      env: buildEnv,
      timeout: 30_000,
    });
    writeVenvManifest(getFamilyBuildingRoot(family), {
      family,
      specVersion: spec.specVersion,
      ortDistribution: spec.ortDistribution,
      ortVersionSpec: spec.ortVersionSpec,
      createdAt: new Date().toISOString(),
      ...(family === "qnn"
        ? {
            packages: {
              onnxruntime: PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION,
              onnxruntimeQnn: PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION,
              numpy: qnnNumpyPin,
            },
          }
        : {}),
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function buildFamilyIsolated(
  family: VenvFamily,
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  const built = await buildFamilyTree(family, systemPython, onLine);
  if (!built.ok) return built;
  const promoted = await promoteBuildingToLive(family);
  if (!promoted.ok) return { ok: false, error: promoted.error };
  onLine(`[setup] ${family} runtime ready at ${getFamilyRoot(family)}`);
  invalidateRuntimeStatusCache();
  return { ok: true };
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
  if (conflictingOrtDistributions(spec.ortDistribution).some((c) => dists.includes(c))) {
    return true;
  }
  if (family === "qnn") {
    try {
      await execFileAsync(py, ["-c", "import onnxruntime_qnn, numpy"], { timeout: 15_000 });
    } catch {
      return true;
    }
    const packages = manifest.packages;
    if (
      !packages?.onnxruntimeQnn ||
      packages.onnxruntimeQnn !== PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION ||
      !packages.onnxruntime ||
      packages.onnxruntime !== PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Migrate a GPU-contaminated `.venv` into dual-family layout.
 * Builds into `.building` trees first; promotes only after both peers validate
 * so a failed default rebuild does not leave a half-applied CUDA promote.
 *
 * Concurrent callers (e.g. default + cuda ensure) serialize on `withMigrationLock`.
 * Re-check contamination under the lock so a second queued migration fast-paths
 * when the first already promoted a clean default — otherwise it would rewrite
 * the journal to "building" and rebuild for minutes, risking a stale partial
 * journal if interrupted.
 */
async function migrateGpuContaminatedVenv(
  systemPython: string,
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  return withMigrationLock(async () => {
    // Fresh probe under the lock: a prior migration may have already cleaned default.
    const intent = await inspectDefaultVenvIntent(listInstalledOrtDistributions);
    if (intent === "default") {
      onLine(
        "[migrate] Default runtime already free of onnxruntime-gpu — skipping GPU migration.",
      );
      return { ok: true };
    }

    let cudaBackupPath: string | undefined;
    let cudaPromoted = false;
    try {
      writeMigrationJournal("building");
      onLine("[migrate] GPU-contaminated .venv detected — repairing dual-runtime layout...");

      const cudaNeedsBuild =
        !familyPythonExists("cuda") || (await familyNeedsRebuild("cuda"));

      if (cudaNeedsBuild) {
        onLine("[migrate] Building CUDA runtime tree (not live yet)...");
        const cudaBuild = await buildFamilyTree("cuda", systemPython, onLine);
        if (!cudaBuild.ok) {
          writeMigrationJournal("building", cudaBuild.error);
          await clearBuildingRoot("cuda");
          return cudaBuild;
        }
        writeMigrationJournal("cuda_built");
      } else {
        onLine("[migrate] CUDA runtime already healthy — rebuilding default only.");
      }

      onLine("[migrate] Building default runtime tree (not live yet)...");
      const defBuild = await buildFamilyTree("default", systemPython, onLine);
      if (!defBuild.ok) {
        writeMigrationJournal("building", defBuild.error);
        await clearBuildingRoot("default");
        if (cudaNeedsBuild) await clearBuildingRoot("cuda");
        return defBuild;
      }
      writeMigrationJournal("default_built");

      if (cudaNeedsBuild) {
        const cudaPromote = await promoteBuildingToLive("cuda");
        if (!cudaPromote.ok) {
          writeMigrationJournal("building", cudaPromote.error);
          await clearBuildingRoot("default");
          await clearBuildingRoot("cuda");
          return { ok: false, error: cudaPromote.error };
        }
        cudaBackupPath = cudaPromote.backupPath;
        cudaPromoted = true;
        writeMigrationJournal("cuda_promoted");
      }

      const defPromote = await promoteBuildingToLive("default");
      if (!defPromote.ok) {
        // Do not write "default_promoted" on failure — that phase means success.
        // If CUDA was already live and rollback fails, leave journal at
        // "cuda_promoted" (actual state). After a successful CUDA rollback,
        // return to "building" so recovery knows neither promote finished.
        if (cudaPromoted) {
          onLine("[migrate] Default promote failed — rolling back CUDA promotion...");
          const rolled = await rollbackPromotedFamily("cuda", cudaBackupPath);
          if (!rolled.ok) {
            const err = `${defPromote.error}; CUDA rollback also failed: ${rolled.error}`;
            writeMigrationJournal("cuda_promoted", err);
            return { ok: false, error: err };
          }
        }
        writeMigrationJournal("building", defPromote.error);
        await clearBuildingRoot("default");
        return { ok: false, error: defPromote.error };
      }
      writeMigrationJournal("default_promoted");

      // Rename newest leftover default backup to legacy-gpu if present
      const backups = fs
        .readdirSync(process.cwd())
        .filter((n) => n.startsWith(".venv.backup-"))
        .map((n) => path.join(process.cwd(), n))
        .sort((a, b) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        });
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
      if (cudaPromoted) {
        onLine("[migrate] Migration failed — rolling back CUDA promotion...");
        const rolled = await rollbackPromotedFamily("cuda", cudaBackupPath);
        if (!rolled.ok) {
          writeMigrationJournal("cuda_promoted", `${msg}; CUDA rollback also failed: ${rolled.error}`);
          return {
            ok: false,
            error: `${msg}; CUDA rollback also failed: ${rolled.error}`,
          };
        }
      }
      await clearBuildingRoot("default");
      await clearBuildingRoot("cuda");
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
        "Python not found. Install Python 3.10–3.13 (3.12 recommended) from Runtime → Setup runtime, or set OLIVE_STUDIO_PYTHON.",
    };
  }

  // All families: check whether default `.venv` is GPU-contaminated or unprobeable.
  const intent = await inspectDefaultVenvIntent(listInstalledOrtDistributions);
  if (intent === "unknown") {
    onLine(
      "[migrate] Could not probe default .venv ORT state — rebuilding default runtime (fail-closed)...",
    );
    const rebuilt = await buildFamilyIsolated("default", systemPython, onLine);
    if (!rebuilt.ok) return rebuilt;
  } else if (intent === "cuda-contaminated") {
    onLine(
      familyPythonExists("cuda")
        ? "[migrate] Existing .venv still has onnxruntime-gpu — rebuilding default (CUDA family present)..."
        : "[migrate] Existing .venv has onnxruntime-gpu — migrating to dual-runtime layout...",
    );
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

/** @internal Whether a family ensure is currently in flight (tests). */
export function isFamilyEnsureInFlight(family: VenvFamily): boolean {
  return familyInFlight.has(family);
}

/** Detach from any in-flight family setup (cancel during setup). */
export function detachAnyFamilyVenvListener(onLine: SetupListener): void {
  for (const flight of familyInFlight.values()) {
    flight.listeners.delete(onLine);
  }
}
