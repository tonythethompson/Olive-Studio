/**
 * Isolated build + transactional directory promotion for venv families.
 * Not claimed as a single filesystem-atomic replace (especially on Windows).
 */
import fs from "fs";
import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import {
  getFamilyBackupRoot,
  getFamilyBuildingRoot,
  getFamilyRoot,
  getFamilySpec,
  type VenvManifest,
  VENV_MANIFEST_NAME,
} from "./spec.ts";

export type PromoteResult = { ok: true } | { ok: false; error: string };

function renameDir(from: string, to: string): void {
  fs.renameSync(from, to);
}

function rmDirSafe(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeVenvManifest(root: string, manifest: VenvManifest): void {
  const file = path.join(root, VENV_MANIFEST_NAME);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), "utf-8");
}

export function readVenvManifest(root: string): VenvManifest | null {
  const file = path.join(root, VENV_MANIFEST_NAME);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as VenvManifest;
  } catch {
    return null;
  }
}

/**
 * Promote a validated `.building` tree to the live family root.
 * live → backup, building → live; rollback on failure.
 */
export function promoteBuildingToLive(family: VenvFamily): PromoteResult {
  const live = getFamilyRoot(family);
  const building = getFamilyBuildingRoot(family);
  if (!fs.existsSync(building)) {
    return { ok: false, error: `Building root missing for ${family}: ${building}` };
  }

  const backup = getFamilyBackupRoot(family);
  let liveMoved = false;
  let buildingMoved = false;

  try {
    if (fs.existsSync(live)) {
      if (fs.existsSync(backup)) rmDirSafe(backup);
      renameDir(live, backup);
      liveMoved = true;
    }
    renameDir(building, live);
    buildingMoved = true;
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Rollback best-effort
    try {
      if (buildingMoved && fs.existsSync(live) && !fs.existsSync(building)) {
        renameDir(live, building);
      }
      if (liveMoved && fs.existsSync(backup) && !fs.existsSync(live)) {
        renameDir(backup, live);
      }
    } catch {
      /* leave artifacts for recovery */
    }
    return {
      ok: false,
      error: `Promotion failed for ${family} (old env preserved when possible): ${msg}`,
    };
  }
}

/** Remove a successful backup after validation (optional cleanup). */
export function discardBackup(family: VenvFamily, backupPath?: string): void {
  const target = backupPath ?? getFamilyBackupRoot(family);
  // Only remove paths that look like our backup naming.
  if (!target.includes(".backup-") && !target.includes(".legacy-")) return;
  rmDirSafe(target);
}

export function ensureParentDir(dir: string): void {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
}

export function clearBuildingRoot(family: VenvFamily): void {
  rmDirSafe(getFamilyBuildingRoot(family));
}

export function familyPythonExists(family: VenvFamily): boolean {
  const root = getFamilyRoot(family);
  const py =
    process.platform === "win32"
      ? path.join(root, "Scripts", "python.exe")
      : path.join(root, "bin", "python");
  return fs.existsSync(py);
}

export function buildingPythonExists(family: VenvFamily): boolean {
  const root = getFamilyBuildingRoot(family);
  const py =
    process.platform === "win32"
      ? path.join(root, "Scripts", "python.exe")
      : path.join(root, "bin", "python");
  return fs.existsSync(py);
}

export function getSpecForFamily(family: VenvFamily) {
  return getFamilySpec(family);
}
