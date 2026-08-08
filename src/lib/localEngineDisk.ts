/**
 * Disk-space checks for local engine model downloads (LM Studio / Ollama).
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  type LocalEngine,
} from "./localEngineStarters.ts";

/** Require this multiple of the estimated download size free before starting. */
export const LOCAL_PULL_DISK_HEADROOM = 1.15;

export function lmsModelsDir(): string {
  return path.join(os.homedir(), ".lmstudio", "models");
}

export function ollamaModelsDir(): string {
  const fromEnv = process.env.OLLAMA_MODELS?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".ollama", "models");
}

export function modelsDirForEngine(engine: LocalEngine): string {
  return engine === "ollama" ? ollamaModelsDir() : lmsModelsDir();
}

/** Free bytes on the volume that holds `dir` (creates no directories). Null if unknown. */
export function freeBytesForPath(dir: string): number | null {
  try {
    let target = dir;
    while (target && !fs.existsSync(target)) {
      const parent = path.dirname(target);
      if (parent === target) break;
      target = parent;
    }
    if (!target || !fs.existsSync(target)) {
      target = os.homedir();
    }
    if (typeof fs.statfsSync !== "function") return null;
    const s = fs.statfsSync(target);
    const bavail = Number(s.bavail);
    const bsize = Number(s.bsize);
    if (!Number.isFinite(bavail) || !Number.isFinite(bsize) || bsize <= 0) return null;
    return bavail * bsize;
  } catch {
    return null;
  }
}

export function freeBytesForEngine(engine: LocalEngine): number | null {
  return freeBytesForPath(modelsDirForEngine(engine));
}

/** Estimated download size for a known starter tag, or null for custom tags. */
export function starterApproxBytes(tag: string, engine: LocalEngine): number | null {
  const list = engine === "ollama" ? OLLAMA_STARTER_MODELS : LMS_STARTER_MODELS;
  const hit = list.find((m) => m.tag === tag);
  return hit?.approxBytes ?? null;
}

export function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export type DiskSpaceGate =
  | { ok: true; freeBytes: number | null; needBytes: number | null }
  | { ok: false; error: string; hint: string; freeBytes: number; needBytes: number };

/** Pure gate used by `gateLocalPullDiskSpace` (and unit tests). */
export function evaluateDiskGate(
  engine: LocalEngine,
  freeBytes: number | null,
  needBytes: number | null,
): DiskSpaceGate {
  if (needBytes === null) return { ok: true, freeBytes, needBytes: null };
  if (freeBytes === null) return { ok: true, freeBytes: null, needBytes };

  const required = Math.ceil(needBytes * LOCAL_PULL_DISK_HEADROOM);
  if (freeBytes >= required) return { ok: true, freeBytes, needBytes };

  const engineName = engine === "ollama" ? "Ollama" : "LM Studio";
  return {
    ok: false,
    freeBytes,
    needBytes: required,
    error: `Not enough disk space for this ${engineName} download.`,
    hint: `Need about ${formatBytesShort(required)} free near ${modelsDirForEngine(engine)}; only ${formatBytesShort(freeBytes)} available. Free space, then retry.`,
  };
}

/**
 * Block downloads when free disk for the engine models dir is below estimated need × headroom.
 * Unknown free space or unknown estimate → allow (engines will still fail mid-download if truly full).
 */
export function gateLocalPullDiskSpace(engine: LocalEngine, modelTag: string): DiskSpaceGate {
  return evaluateDiskGate(engine, freeBytesForEngine(engine), starterApproxBytes(modelTag, engine));
}
