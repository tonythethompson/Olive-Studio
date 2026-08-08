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
 * Restore a prior snapshot: rewrite exact contents, or delete a file the smoke created.
 * @param {string} configPath
 * @param {StudioConfigSnapshot | null | undefined} snapshot
 */
export function restoreStudioConfigFile(configPath, snapshot) {
  if (!snapshot) return;
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
