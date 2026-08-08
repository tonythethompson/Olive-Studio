/**
 * Exact on-disk snapshot/restore for `.olive-studio/config.json`.
 * Used by mcp-agent-smoke so policy patches never leave lossy booleans or a
 * newly created config file behind.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Top-level marker written while mcp-agent-smoke owns policy patches. */
export const SMOKE_OWNER_KEY = "__mcpAgentSmokeOwner";

/**
 * @typedef {{ existed: false, contents: null } | { existed: true, contents: string }} StudioConfigSnapshot
 * @typedef {{ pid: number, startedAt: string }} SmokeOwnerStamp
 */

/**
 * Capture whether the Studio config file exists and its exact bytes.
 * @param {string} configPath
 * @returns {StudioConfigSnapshot}
 */
export function snapshotStudioConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return { existed: false, contents: null };
  }
  return {
    existed: true,
    contents: readFileSync(configPath, "utf8"),
  };
}

/**
 * Read current on-disk bytes, or null when the file is absent.
 * @param {string} configPath
 * @returns {string | null}
 */
export function readStudioConfigFileContents(configPath) {
  if (!existsSync(configPath)) return null;
  return readFileSync(configPath, "utf8");
}

/**
 * @param {string} configPath
 * @returns {SmokeOwnerStamp | null}
 */
export function readSmokeOwnerStamp(configPath) {
  const raw = readStudioConfigFileContents(configPath);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    const stamp = parsed?.[SMOKE_OWNER_KEY];
    if (!stamp || typeof stamp !== "object") return null;
    const pid = Number(stamp.pid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      pid,
      startedAt: typeof stamp.startedAt === "string" ? stamp.startedAt : "",
    };
  } catch {
    return null;
  }
}

/**
 * Refuse to proceed when another live smoke still stamps this config.
 * @param {string} configPath
 * @param {number} myPid
 * @param {(pid: number) => boolean} [isAlive]
 */
export function assertNoLiveForeignSmokeOwner(
  configPath,
  myPid,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
) {
  const owner = readSmokeOwnerStamp(configPath);
  if (!owner || owner.pid === myPid) return;
  if (!isAlive(owner.pid)) return;
  throw new Error(
    `refusing to mutate Studio config: live mcp-agent-smoke owner pid=${owner.pid} still stamped on ${configPath}`,
  );
}

/**
 * Restore a prior snapshot: rewrite exact contents, or delete a file the smoke created.
 *
 * When `expectedContents` is provided (including `null` for "file must be absent"),
 * restore only if the on-disk bytes still match. Otherwise throw so callers do not
 * clobber a concurrent update from another Studio process or administrator.
 *
 * @param {string} configPath
 * @param {StudioConfigSnapshot | null | undefined} snapshot
 * @param {{ expectedContents?: string | null }} [opts]
 */
export function restoreStudioConfigFile(configPath, snapshot, opts = {}) {
  if (!snapshot) return;
  if (Object.prototype.hasOwnProperty.call(opts, "expectedContents")) {
    const current = readStudioConfigFileContents(configPath);
    if (current !== opts.expectedContents) {
      throw new Error(
        `refusing to restore Studio config: on-disk bytes changed since smoke last wrote them (${configPath})`,
      );
    }
  }
  if (!snapshot.existed) {
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
    }
    // If smoke created `.olive-studio/` solely for the patch, drop the empty dir.
    const dir = path.dirname(configPath);
    try {
      rmdirSync(dir);
    } catch {
      /* dir missing, not empty, or not removable — leave alone */
    }
    return;
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, snapshot.contents, "utf8");
}
