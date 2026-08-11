#!/usr/bin/env node
// Removes dangling symlinks under node_modules/.pnpm left behind when a pnpm
// install for another OS (e.g. WSL) touches this same checkout. A dangling
// symlink here makes pnpm's own prune step throw EACCES on Windows before it
// ever gets to delete the thing that's broken, wedging every future install.
import { lstatSync, readlinkSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pnpmDir = join(root, "node_modules", ".pnpm");

if (!existsSync(pnpmDir)) {
  process.exit(0);
}

let output;
try {
  output = execSync(`find "${pnpmDir}" -xtype l`, { encoding: "utf8" });
} catch {
  // `find` unavailable (no POSIX shell) — nothing to do, skip silently.
  process.exit(0);
}

// Only target native platform-binary packages (esbuild's linux-x64, sharp's
// darwin-arm64, etc). Never touch pnpm's own `.ignored_*` dedup markers —
// those are expected to dangle by design and get relinked on install.
const platformBinaryPattern = /(^|[-/])(linux|darwin|freebsd|android|win32)(-|_|$)/i;
const dangling = output
  .split("\n")
  .filter(Boolean)
  .filter((link) => !link.includes(`${sep}.ignored_`) && !link.includes("/.ignored_"))
  .filter((link) => platformBinaryPattern.test(link));
if (dangling.length === 0) {
  process.exit(0);
}

console.warn(`[fix-stale-symlinks] removing ${dangling.length} dangling symlink(s) from a cross-platform install:`);
for (const link of dangling) {
  try {
    const stat = lstatSync(link);
    if (stat.isSymbolicLink()) {
      console.warn(`  - ${link} -> ${readlinkSync(link)}`);
      rmSync(link, { force: true });
    }
  } catch {
    // Already gone or inaccessible — ignore.
  }
}
