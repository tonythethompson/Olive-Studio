/**
 * First-boot GPU migration journal + recovery.
 * Journal lives outside either venv so it survives directory swaps.
 */
import fs from "fs";
import path from "path";
import {
  getFamilyBuildingRoot,
  getFamilyRoot,
  getLegacyGpuBackupRoot,
  MIGRATION_JOURNAL_PATH,
} from "./spec.ts";

export type MigrationPhase =
  | "idle"
  | "building"
  | "cuda_built"
  | "default_built"
  | "legacy_renamed"
  | "cuda_promoted"
  | "default_promoted"
  | "complete";

export type RuntimeMigrationState = {
  version: 1;
  phase: MigrationPhase;
  updatedAt: string;
  error?: string;
};

let migrationLock: Promise<unknown> = Promise.resolve();

export function withMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = migrationLock.then(fn, fn);
  migrationLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function readMigrationJournal(): RuntimeMigrationState | null {
  if (!fs.existsSync(MIGRATION_JOURNAL_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MIGRATION_JOURNAL_PATH, "utf-8")) as RuntimeMigrationState;
  } catch {
    return null;
  }
}

export function writeMigrationJournal(phase: MigrationPhase, error?: string): void {
  fs.mkdirSync(path.dirname(MIGRATION_JOURNAL_PATH), { recursive: true });
  const state: RuntimeMigrationState = {
    version: 1,
    phase,
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  fs.writeFileSync(MIGRATION_JOURNAL_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function clearMigrationJournal(): void {
  if (fs.existsSync(MIGRATION_JOURNAL_PATH)) fs.unlinkSync(MIGRATION_JOURNAL_PATH);
}

/**
 * Detect whether an existing default `.venv` looks CUDA/GPU-ORT contaminated
 * (needs migration into dual-family layout).
 */
export async function inspectDefaultVenvIntent(
  probeOrtDists: (python: string) => Promise<string[]>,
): Promise<"default" | "cuda-contaminated" | "missing"> {
  const root = getFamilyRoot("default");
  const py =
    process.platform === "win32"
      ? path.join(root, "Scripts", "python.exe")
      : path.join(root, "bin", "python");
  if (!fs.existsSync(py)) return "missing";
  try {
    const dists = await probeOrtDists(py);
    if (dists.includes("onnxruntime-gpu")) return "cuda-contaminated";
    return "default";
  } catch {
    return "default";
  }
}

export function migrationArtifactSummary(): {
  journal: RuntimeMigrationState | null;
  buildingDefault: boolean;
  buildingCuda: boolean;
  legacyGpu: boolean;
  liveDefault: boolean;
  liveCuda: boolean;
} {
  return {
    journal: readMigrationJournal(),
    buildingDefault: fs.existsSync(getFamilyBuildingRoot("default")),
    buildingCuda: fs.existsSync(getFamilyBuildingRoot("cuda")),
    legacyGpu: fs.existsSync(getLegacyGpuBackupRoot()),
    liveDefault: fs.existsSync(getFamilyRoot("default")),
    liveCuda: fs.existsSync(getFamilyRoot("cuda")),
  };
}
