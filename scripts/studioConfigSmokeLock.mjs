/**
 * Inter-process exclusive lock for mcp-agent-smoke config mutation.
 * Prevents overlapping smokes from snapshotting each other's temporary
 * allowJobSubmission / cancellation policy patches.
 */
import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish a fully-written lock file at `lockPath` without an empty-body window.
 * Prefer hard-linking a temp file (link fails with EEXIST and never overwrites).
 * Fall back to exclusive `write(..., { flag: "wx" })` of the same PID bytes when
 * hardlinks are unsupported.
 *
 * @param {string} lockPath
 * @param {string} body
 * @param {{
 *   writeFileSync: typeof writeFileSync,
 *   linkSync: typeof linkSync,
 *   unlinkSync: typeof unlinkSync,
 *   tempPath: string,
 * }} deps
 */
function publishLockFile(lockPath, body, deps) {
  const { writeFileSync: write, linkSync: link, unlinkSync: unlink, tempPath } = deps;
  write(tempPath, body);
  try {
    try {
      link(tempPath, lockPath);
      return;
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      if (code === "EEXIST") throw e;
      // ENOTSUP / EPERM / EINVAL / EXDEV: still publish full content exclusively.
      write(lockPath, body, { flag: "wx" });
    }
  } finally {
    try {
      unlink(tempPath);
    } catch {
      /* temp already gone */
    }
  }
}

/**
 * @param {string} lockPath
 * @param {{
 *   writeFileSync?: typeof writeFileSync,
 *   linkSync?: typeof linkSync,
 *   readFileSync?: typeof readFileSync,
 *   statSync?: typeof statSync,
 *   unlinkSync?: typeof unlinkSync,
 *   mkdirSync?: typeof mkdirSync,
 *   isProcessAlive?: (pid: number) => boolean,
 *   pid?: number,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   publishGraceMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   randomId?: () => string,
 * }} [deps]
 * @returns {Promise<{ release: () => void }>}
 */
export async function acquireStudioConfigSmokeLock(lockPath, deps = {}) {
  const write = deps.writeFileSync ?? writeFileSync;
  const link = deps.linkSync ?? linkSync;
  const read = deps.readFileSync ?? readFileSync;
  const stat = deps.statSync ?? statSync;
  const unlink = deps.unlinkSync ?? unlinkSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const alive = deps.isProcessAlive ?? isProcessAlive;
  const myPid = deps.pid ?? process.pid;
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const pollMs = deps.pollMs ?? 250;
  const publishGraceMs = deps.publishGraceMs ?? Math.max(1_000, pollMs * 4);
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? (() => randomBytes(6).toString("hex"));
  const sleep =
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = now() + timeoutMs;
  const body = `${myPid}\n`;

  while (now() < deadline) {
    const tempPath = path.join(
      path.dirname(lockPath),
      `.${path.basename(lockPath)}.${myPid}.${randomId()}.tmp`,
    );
    try {
      publishLockFile(lockPath, body, {
        writeFileSync: write,
        linkSync: link,
        unlinkSync: unlink,
        tempPath,
      });
      return {
        release() {
          try {
            const current = read(lockPath, "utf8");
            const holder = Number.parseInt(String(current).trim().split(/\r?\n/)[0] ?? "", 10);
            if (holder === myPid) unlink(lockPath);
          } catch {
            /* already gone or not ours */
          }
        },
      };
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      if (code !== "EEXIST") throw e;
      try {
        const current = read(lockPath, "utf8");
        const holder = Number.parseInt(String(current).trim().split(/\r?\n/)[0] ?? "", 10);
        // Fresh empty/malformed bodies can mean a concurrent publisher has not
        // finished yet (or a crash left an empty legacy lock). Only reclaim
        // after publishGraceMs. Finite dead PIDs reclaim immediately.
        const malformed = !Number.isFinite(holder);
        let reclaimable = !malformed && !alive(holder);
        if (malformed) {
          try {
            const ageMs = now() - stat(lockPath).mtimeMs;
            reclaimable = ageMs >= publishGraceMs;
          } catch {
            /* unable to establish age — leave the lock in place */
          }
        }
        // Only skip the poll sleep after unlink succeeds so failed reclaim
        // cannot busy-spin.
        if (reclaimable) {
          try {
            unlink(lockPath);
            continue;
          } catch {
            /* lost race / still held — fall through to poll */
          }
        }
      } catch {
        /* lock vanished mid-read */
      }
      await sleep(pollMs);
    }
  }

  throw new Error(
    `could not acquire Studio config smoke lock within ${timeoutMs}ms (${lockPath})`,
  );
}

/**
 * Best-effort removal of an empty `.olive-studio` dir after the lock file is gone.
 * @param {string} dir
 * @param {{ rmdirSync?: typeof rmdirSync }} [deps]
 */
export function tryRemoveEmptyStudioConfigDir(dir, deps = {}) {
  const rmdir = deps.rmdirSync ?? rmdirSync;
  try {
    rmdir(dir);
  } catch {
    /* not empty, missing, or busy */
  }
}
