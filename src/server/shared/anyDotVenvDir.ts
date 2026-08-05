/**
 * Regex matching any `.venv*` directory variant. Both `vite.config.ts`
 * (which configures the development middleware HMR file watcher) and
 * `server.ts` (which configures Vite's middleware watch for the same
 * reason) add this to their chokidar `ignored` list, so the regex must
 * live in a single place — otherwise a rename/back-up of the venv
 * reintroduces file-watch noise on whichever side forgot to update.
 *
 * Handles `.venv`, `.venv.bak`, `.venv.old`, `.venv-rename`, etc.
 * Anchored to a path separator on either side (or string start/end)
 * so it doesn't match unrelated folders such as `notavenv`.
 */
export const ANY_DOT_VENV_DIR = /(?:^|[\\/])\.venv(?:[._-][^\\/]+)?(?:[\\/]|$)/;
