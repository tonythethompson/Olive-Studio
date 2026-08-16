/**
 * Runtime path roots for the Express server.
 *
 * Packaged Tauri builds start the Node server with the resource directory as
 * its working directory (see spawn_node_server in src-tauri/src/lib.rs).
 * Installed resource directories are read-only in common deployments
 * (DEB/AppImage, macOS app bundle, Windows Program Files), so anything the
 * server must write — the GenAI venv, the model cache, S3 pull destinations
 * — is anchored to a per-user writable root instead of process.cwd().
 * Development and plain `node dist/server.mjs` runs keep project-root paths.
 */

import os from "node:os";
import path from "node:path";

/**
 * Whether this server is running inside a packaged Tauri application.
 * The shell exports OLIVE_DIST_DIR (the bundled dist resource) only for
 * packaged builds, and production mode rules out `pnpm dev`.
 */
export function isPackagedApp(): boolean {
  return process.env.NODE_ENV === "production" && Boolean(process.env.OLIVE_DIST_DIR?.trim());
}

/** Per-user writable root for app-managed data (venvs, caches, downloads). */
export function writableRoot(): string {
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "olive-studio");
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "olive-studio");
    default:
      return path.join(
        process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"),
        "olive-studio",
      );
  }
}

/**
 * Root that user-supplied destination paths (e.g. /s3/pull destDir) are
 * resolved and validated against: the project directory for dev/unpackaged
 * runs, the writable root for installed apps.
 */
export function containmentRoot(): string {
  return isPackagedApp() ? writableRoot() : process.cwd();
}
