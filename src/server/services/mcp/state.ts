import type { KbStatusCache } from "../../types.ts";

/** Cached KB status (from /api/mcp/kb-status). */
let kbStatusCache: KbStatusCache | null = null;

/** True while a KB sync is in progress. */
let kbSyncInProgress = false;

export function getKbStatusCache(): KbStatusCache | null {
  return kbStatusCache;
}

export function setKbStatusCache(cache: KbStatusCache | null): void {
  kbStatusCache = cache;
}

export function isKbSyncInProgress(): boolean {
  return kbSyncInProgress;
}

export function setKbSyncInProgress(v: boolean): void {
  kbSyncInProgress = v;
}
