#!/usr/bin/env node
// Removes dangling symlinks under node_modules/.pnpm left behind when a pnpm
// install for another OS (e.g. WSL) touches this same checkout. A dangling
// symlink here makes pnpm's own prune step throw EACCES on Windows before it
// ever gets to delete the thing that's broken, wedging every future install.
import { existsSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmDir = join(root, "node_modules", ".pnpm");

if (!existsSync(pnpmDir)) {
  process.exit(0);
}

function findDanglingSymlinks(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.error(
      `[fix-stale-symlinks] unable to scan ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return [];
  }

  const links = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(entryPath)) links.push(entryPath);
    } else if (entry.isDirectory()) {
      links.push(...findDanglingSymlinks(entryPath));
    }
  }
  return links;
}

// Only target native platform-binary packages (esbuild's linux-x64, sharp's
// darwin-arm64, etc). Never touch pnpm's own `.ignored_*` dedup markers —
// those are expected to dangle by design and get relinked on install.
const platformBinaryPattern = /(^|[-/])(linux|darwin|freebsd|android|win32)(-|_|$)/i;
const dangling = findDanglingSymlinks(pnpmDir)
  .filter((link) => !link.includes(`${sep}.ignored_`) && !link.includes("/.ignored_"))
  .filter((link) => platformBinaryPattern.test(relative(pnpmDir, link).replaceAll("\\", "/")));
if (dangling.length === 0) {
  process.exit(0);
}

console.warn(
  `[fix-stale-symlinks] removing ${dangling.length} dangling symlink(s) from a cross-platform install:`,
);
for (const link of dangling) {
  try {
    console.warn(`  - ${link} -> ${readlinkSync(link)}`);
    rmSync(link, { force: true });
  } catch (error) {
    console.error(
      `[fix-stale-symlinks] unable to remove ${link}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
