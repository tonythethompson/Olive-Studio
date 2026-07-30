import fs from "fs";
import type { OliveJob } from "../../types.ts";
import { appConfig } from "../../config.ts";

/** Central job registry — all active Olive jobs. */
export const jobRegistry = new Map<string, OliveJob>();

/** Runtime HF token (backed by appConfig so callers share one source of truth). */
export function getRuntimeHfToken(): string | null {
  return appConfig.hfToken;
}

export function setRuntimeHfToken(token: string | null): void {
  appConfig.hfToken = token;
}

// ─── Job lifecycle / cleanup ────────────────────────────────────────────────

/** Keep terminal jobs this long so the UI can still poll status/logs. */
const JOB_TTL_MS = 30 * 60_000;
/** How often the sweeper runs. */
const SWEEP_INTERVAL_MS = 5 * 60_000;

const TERMINAL_STATUSES = new Set<OliveJob["status"]>(["completed", "failed", "cancelled"]);

/** Best-effort removal of a job's temp recipe file. */
export function cleanupJobArtifacts(job: OliveJob): void {
  if (job.tempRecipePath) {
    try {
      fs.rmSync(job.tempRecipePath, { force: true });
    } catch {
      /* already gone */
    }
    job.tempRecipePath = null;
  }
}

/** Remove terminal jobs older than the TTL and reclaim their temp files. */
export function sweepJobRegistry(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, job] of jobRegistry) {
    if (job.finishedAt != null && TERMINAL_STATUSES.has(job.status) && now - job.finishedAt > JOB_TTL_MS) {
      cleanupJobArtifacts(job);
      jobRegistry.delete(id);
      removed += 1;
    }
  }
  return removed;
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Start the periodic TTL sweeper once. Safe to call multiple times. */
export function startJobRegistrySweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => sweepJobRegistry(), SWEEP_INTERVAL_MS);
  // Don't keep the process (or tests) alive just for the sweeper.
  if (typeof sweeper.unref === "function") sweeper.unref();
}
