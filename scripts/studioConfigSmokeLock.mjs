/**
 * Inter-process exclusive lock for mcp-agent-smoke config mutation.
 * Prevents overlapping smokes from snapshotting each other's temporary
 * allowJobSubmission / cancellation policy patches.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
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
 *   openSync?: typeof openSync,
 *   closeSync?: typeof closeSync,
 *   writeFileSync?: typeof writeFileSync,
 *   readFileSync?: typeof readFileSync,
 *   unlinkSync?: typeof unlinkSync,
 *   mkdirSync?: typeof mkdirSync,
 *   isProcessAlive?: (pid: number) => boolean,
 *   pid?: number,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [deps]
 * @returns {Promise<{ release: () => void }>}
 */
export async function acquireStudioConfigSmokeLock(lockPath, deps = {}) {
  const open = deps.openSync ?? openSync;
  const close = deps.closeSync ?? closeSync;
  const write = deps.writeFileSync ?? writeFileSync;
  const read = deps.readFileSync ?? readFileSync;
  const unlink = deps.unlinkSync ?? unlinkSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const alive = deps.isProcessAlive ?? isProcessAlive;
  const myPid = deps.pid ?? process.pid;
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const pollMs = deps.pollMs ?? 250;
  const sleep =
    deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const fd = open(lockPath, "wx");
      try {
        write(fd, `${myPid}\n`);
      } finally {
        close(fd);
      }
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
        // Empty/malformed bodies and dead holders are reclaimable. Only skip the
        // poll sleep after unlink succeeds so failed reclaim cannot busy-spin.
        const reclaimable = !Number.isFinite(holder) || !alive(holder);
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
