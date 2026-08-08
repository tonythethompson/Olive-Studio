/**
 * Inter-process exclusive lock for mcp-agent-smoke config mutation.
 * Prevents overlapping smokes from snapshotting each other's temporary
 * allowJobSubmission / cancellation policy patches.
 */
import {
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
 * @param {string} lockPath
 * @param {{
 *   writeFileSync?: typeof writeFileSync,
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
 * }} [deps]
 * @returns {Promise<{ release: () => void }>}
 */
export async function acquireStudioConfigSmokeLock(lockPath, deps = {}) {
  // Atomic create+publish: write PID with O_EXCL so waiters never observe an
  // empty live lock from this process. Malformed bodies still get a grace
  // window for abandoned mid-write files from older crash paths.
  const write = deps.writeFileSync ?? writeFileSync;
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
  const sleep =
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    try {
      write(lockPath, `${myPid}\n`, { flag: "wx" });
      return {
        release() {
          try {
            const body = read(lockPath, "utf8");
            const holder = Number.parseInt(String(body).trim().split(/\r?\n/)[0] ?? "", 10);
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
        const body = read(lockPath, "utf8");
        const holder = Number.parseInt(String(body).trim().split(/\r?\n/)[0] ?? "", 10);
        // Fresh empty/malformed bodies can mean "writer still publishing" (legacy
        // open-then-write callers / crash mid-write). Only reclaim after grace.
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
