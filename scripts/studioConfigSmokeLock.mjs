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
 * Publish a fully-written lock file at `lockPath` without replacing a live peer.
 * Prefer hard-linking a temp file (link fails with EEXIST and never overwrites).
 * When hardlinks are unsupported, exclusive `write(..., { flag: "wx" })` of the
 * full body (all platforms). Never rename onto the final path — POSIX rename
 * replaces an existing dest, and a guarded exists-check would be TOCTOU.
 * Incomplete bodies at the final path are never age-reclaimed (a paused wx
 * publisher must keep exclusivity until timeout).
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
  const {
    writeFileSync: write,
    linkSync: link,
    unlinkSync: unlink,
    mkdirSync: mkdir,
    tempPath,
  } = deps;

  const attempt = () => {
    write(tempPath, body);
    try {
      try {
        link(tempPath, lockPath);
      } catch (e) {
        const code = errorCode(e);
        if (code === "EEXIST") throw e;
        // ENOTSUP / EPERM / EINVAL / EXDEV: exclusive create, never overwrite.
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
 * - Incomplete body: never clear. A live `wx` publisher may be paused mid-write
 *   past `publishGraceMs`; age-clearing would steal the name and break exclusivity.
 *   Smokers wait out `timeoutMs` instead.
 * @param {string} reclaimPath
 * @param {{
 *   readFileSync: typeof readFileSync,
 *   unlinkSync: typeof unlinkSync,
 *   isProcessAlive: (pid: number) => boolean,
 * }} deps
 * @returns {boolean}
 */
function tryClearOrphanedReclaimMutex(reclaimPath, deps) {
  const {
    readFileSync: read,
    unlinkSync: unlink,
    isProcessAlive: alive,
  } = deps;
  try {
    const holder = parsePublishedLockPid(read(reclaimPath, "utf8"));
    // Incomplete: leave in place (may be a delayed live wx publish).
    if (holder == null) return false;
    if (alive(holder)) return false;
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
 *   linkSync: typeof linkSync,
 *   readFileSync: typeof readFileSync,
 *   unlinkSync: typeof unlinkSync,
 *   mkdirSync: typeof mkdirSync,
 *   isProcessAlive: (pid: number) => boolean,
 *   randomId: () => string,
 * }} deps
 * @returns {boolean}
 */
function tryReclaimObservedLock(lockPath, observed, myPid, deps) {
  const {
    writeFileSync: write,
    linkSync: link,
    readFileSync: read,
    unlinkSync: unlink,
    mkdirSync: mkdir,
    isProcessAlive: alive,
    randomId,
  } = deps;
  const reclaimPath = `${lockPath}.reclaim`;

  const ownsReclaimGate = () => parsePublishedLockPid(read(reclaimPath, "utf8")) === myPid;

  const acquireReclaimGate = () => {
    const tempPath = path.join(
      path.dirname(reclaimPath),
      `.${path.basename(reclaimPath)}.${myPid}.${randomId()}.tmp`,
    );
    publishLockFile(reclaimPath, `${myPid}\n`, {
      writeFileSync: write,
      linkSync: link,
      unlinkSync: unlink,
      mkdirSync: mkdir,
      tempPath,
    });
  };

  try {
    acquireReclaimGate();
  } catch (e) {
    if (errorCode(e) !== "EEXIST") throw e;
    const cleared = tryClearOrphanedReclaimMutex(reclaimPath, {
      readFileSync: read,
      unlinkSync: unlink,
      isProcessAlive: alive,
    });
    if (!cleared) return false;
    try {
      acquireReclaimGate();
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
 *   unlinkSync?: typeof unlinkSync,
 *   mkdirSync?: typeof mkdirSync,
 *   isProcessAlive?: (pid: number) => boolean,
 *   pid?: number,
 *   timeoutMs?: number,
 *   pollMs?: number,
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
  const unlink = deps.unlinkSync ?? unlinkSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const alive = deps.isProcessAlive ?? isProcessAlive;
  const myPid = deps.pid ?? process.pid;
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const pollMs = deps.pollMs ?? 250;
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
        // Incomplete bodies (empty, partial digits) may be a live wx publish.
        // Never age-reclaim them — peers wait out timeoutMs instead.
        // Fully published finite dead PIDs reclaim immediately.
        const incomplete = holder == null;
        const reclaimable = !incomplete && !alive(holder);
        // Serialize reclaimers via lockPath.reclaim (temp+link publish). Only
        // skip the poll sleep after unlink succeeds so failed reclaim cannot
        // busy-spin.
        if (
          reclaimable &&
          tryReclaimObservedLock(lockPath, observed, myPid, {
            writeFileSync: write,
            linkSync: link,
            readFileSync: read,
            unlinkSync: unlink,
            mkdirSync: mkdir,
            isProcessAlive: alive,
            randomId,
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
