/**
 * Exact on-disk snapshot/restore for `.olive-studio/config.json`.
 * Used by mcp-agent-smoke so policy patches never leave lossy booleans or a
 * newly created config file behind.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {{ existed: false, contents: null } | { existed: true, contents: string }} StudioConfigSnapshot
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
      rmSync(dir, { recursive: false });
    } catch {
      /* dir missing, not empty, or not removable — leave alone */
    }
    return;
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, snapshot.contents, "utf8");
}
