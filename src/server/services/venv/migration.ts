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
  getMigrationJournalPath,
} from "./spec.ts";
import { pythonPathForRoot } from "./paths.ts";

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

const KNOWN_MIGRATION_PHASES = new Set<MigrationPhase>([
  "idle",
  "building",
  "cuda_built",
  "default_built",
  "legacy_renamed",
  "cuda_promoted",
  "default_promoted",
  "complete",
]);

export function readMigrationJournal(): RuntimeMigrationState | null {
  const journalPath = getMigrationJournalPath();
  if (!fs.existsSync(journalPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as RuntimeMigrationState).version !== 1 ||
      !KNOWN_MIGRATION_PHASES.has((parsed as RuntimeMigrationState).phase)
    ) {
      return null;
    }
    return parsed as RuntimeMigrationState;
  } catch {
    return null;
  }
}

export function writeMigrationJournal(phase: MigrationPhase, error?: string): void {
  const journalPath = getMigrationJournalPath();
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const state: RuntimeMigrationState = {
    version: 1,
    phase,
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  fs.writeFileSync(journalPath, JSON.stringify(state, null, 2), "utf-8");
}

export function clearMigrationJournal(): void {
  const journalPath = getMigrationJournalPath();
  fs.rmSync(journalPath, { force: true });
}

/**
 * Detect whether an existing default `.venv` looks CUDA/GPU-ORT contaminated
 * (needs migration into dual-family layout).
 * Probe failures return `"unknown"` (fail-closed) rather than assuming healthy default.
 */
export async function inspectDefaultVenvIntent(
  probeOrtDists: (python: string) => Promise<string[]>,
): Promise<"default" | "cuda-contaminated" | "missing" | "unknown"> {
  const root = getFamilyRoot("default");
  const py = pythonPathForRoot(root);
  if (!fs.existsSync(py)) return "missing";
  try {
    const dists = await probeOrtDists(py);
    if (dists.includes("onnxruntime-gpu")) return "cuda-contaminated";
    return "default";
  } catch {
    return "unknown";
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
