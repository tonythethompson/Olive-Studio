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
 * Parse a fully published lock body (`"<pid>\\n"`). Rejects parseInt prefixes and
 * partial numeric writes (e.g. `"12"` while `"12345\\n"` is still publishing).
 * @param {string} raw
 * @returns {number | null} holder pid, or null when incomplete/malformed
 */
export function parsePublishedLockPid(raw) {
  const match = String(raw).match(/^(\d+)\n$/);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return pid;
}

/**
 * @param {unknown} err
 * @returns {string | undefined}
 */
function errorCode(err) {
  return err && typeof err === "object" && "code" in err ? /** @type {{ code?: string }} */ (err).code : undefined;
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
 *   mkdirSync: typeof mkdirSync,
 *   tempPath: string,
 * }} deps
 */
function publishLockFile(lockPath, body, deps) {
  const { writeFileSync: write, linkSync: link, unlinkSync: unlink, mkdirSync: mkdir, tempPath } =
    deps;

  const attempt = () => {
    write(tempPath, body);
    try {
      try {
        link(tempPath, lockPath);
        return;
      } catch (e) {
        const code = errorCode(e);
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
  };

  try {
    attempt();
  } catch (e) {
    // Peer cleanup may rmdir `.olive-studio` between our mkdir and temp create.
    if (errorCode(e) !== "ENOENT") throw e;
    mkdir(path.dirname(lockPath), { recursive: true });
    attempt();
  }
}

/**
 * Drop an abandoned `lockPath.reclaim` gate so later smokers are not stuck
 * waiting for a dead owner's mutex forever.
 *
 * - Complete PID + alive: leave alone (active reclaimer).
 * - Complete PID + dead: clear (crashed after publishing ownership).
 * - Incomplete body: clear only after publishGraceMs (crashed mid-write orphan).
 *   Fresh incomplete markers are left alone so a concurrent writer is not
 *   stripped mid-publish; reclaimers still re-verify gate ownership before
 *   unlinking the main lock.
 * @param {string} reclaimPath
 * @param {{
 *   readFileSync: typeof readFileSync,
 *   unlinkSync: typeof unlinkSync,
 *   statSync: typeof statSync,
 *   isProcessAlive: (pid: number) => boolean,
 *   now: () => number,
 *   publishGraceMs: number,
 * }} deps
 * @returns {boolean}
 */
function tryClearOrphanedReclaimMutex(reclaimPath, deps) {
  const {
    readFileSync: read,
    unlinkSync: unlink,
    statSync: stat,
    isProcessAlive: alive,
    now,
    publishGraceMs,
  } = deps;
  try {
    const holder = parsePublishedLockPid(read(reclaimPath, "utf8"));
    if (holder != null) {
      if (alive(holder)) return false;
      unlink(reclaimPath);
      return true;
    }
    const ageMs = now() - stat(reclaimPath).mtimeMs;
    if (ageMs < publishGraceMs) return false;
    unlink(reclaimPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize reclaimers so only one waiter may unlink a classified body.
 * @param {string} lockPath
 * @param {string} observed
 * @param {number} myPid
 * @param {{
 *   writeFileSync: typeof writeFileSync,
 *   readFileSync: typeof readFileSync,
 *   unlinkSync: typeof unlinkSync,
 *   mkdirSync: typeof mkdirSync,
 *   statSync: typeof statSync,
 *   isProcessAlive: (pid: number) => boolean,
 *   now: () => number,
 *   publishGraceMs: number,
 * }} deps
 * @returns {boolean}
 */
function tryReclaimObservedLock(lockPath, observed, myPid, deps) {
  const {
    writeFileSync: write,
    readFileSync: read,
    unlinkSync: unlink,
    mkdirSync: mkdir,
    statSync: stat,
    isProcessAlive: alive,
    now,
    publishGraceMs,
  } = deps;
  const reclaimPath = `${lockPath}.reclaim`;

  const ownsReclaimGate = () => parsePublishedLockPid(read(reclaimPath, "utf8")) === myPid;

  const tryAcquireReclaimGate = () => {
    try {
      write(reclaimPath, `${myPid}\n`, { flag: "wx" });
      return true;
    } catch (e) {
      if (errorCode(e) === "ENOENT") {
        mkdir(path.dirname(lockPath), { recursive: true });
        write(reclaimPath, `${myPid}\n`, { flag: "wx" });
        return true;
      }
      throw e;
    }
  };

  try {
    if (!tryAcquireReclaimGate()) return false;
  } catch (e) {
    if (errorCode(e) !== "EEXIST") throw e;
    const cleared = tryClearOrphanedReclaimMutex(reclaimPath, {
      readFileSync: read,
      unlinkSync: unlink,
      statSync: stat,
      isProcessAlive: alive,
      now,
      publishGraceMs,
    });
    if (!cleared) return false;
    try {
      if (!tryAcquireReclaimGate()) return false;
    } catch {
      return false;
    }
  }
  try {
    // Re-verify gate ownership before touching the main lock: another waiter
    // must not have replaced this mutex while we were paused.
    if (!ownsReclaimGate()) return false;
    const still = read(lockPath, "utf8");
    if (still !== observed) return false;
    if (!ownsReclaimGate()) return false;
    unlink(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (ownsReclaimGate()) unlink(reclaimPath);
    } catch {
      /* already gone / not ours */
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
        mkdirSync: mkdir,
        tempPath,
      });
      // Lost reclaim race? Another owner may have replaced the path after we linked.
      const published = parsePublishedLockPid(read(lockPath, "utf8"));
      if (published !== myPid) {
        await sleep(pollMs);
        continue;
      }
      return {
        release() {
          try {
            const holder = parsePublishedLockPid(read(lockPath, "utf8"));
            if (holder === myPid) unlink(lockPath);
          } catch {
            /* already gone or not ours */
          }
        },
      };
    } catch (e) {
      const code = errorCode(e);
      if (code === "ENOENT") {
        mkdir(path.dirname(lockPath), { recursive: true });
        await sleep(pollMs);
        continue;
      }
      if (code !== "EEXIST") throw e;
      try {
        // Snapshot the exact bytes we classified. Concurrent reclaim must only
        // unlink that same body — never a peer's newly published PID lock.
        const observed = read(lockPath, "utf8");
        const holder = parsePublishedLockPid(observed);
        // Incomplete bodies (empty, partial digits, parseInt prefixes) may mean
        // a concurrent publisher is still writing. Only reclaim after grace.
        // Fully published finite dead PIDs reclaim immediately.
        const incomplete = holder == null;
        let reclaimable = !incomplete && !alive(holder);
        if (incomplete) {
          try {
            const ageMs = now() - stat(lockPath).mtimeMs;
            reclaimable = ageMs >= publishGraceMs;
          } catch {
            /* unable to establish age — leave the lock in place */
          }
        }
        // Serialize reclaimers via lockPath.reclaim (wx). Only skip the poll
        // sleep after unlink succeeds so failed reclaim cannot busy-spin.
        if (
          reclaimable &&
          tryReclaimObservedLock(lockPath, observed, myPid, {
            writeFileSync: write,
            readFileSync: read,
            unlinkSync: unlink,
            mkdirSync: mkdir,
            statSync: stat,
            isProcessAlive: alive,
            now,
            publishGraceMs,
          })
        ) {
          continue;
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
