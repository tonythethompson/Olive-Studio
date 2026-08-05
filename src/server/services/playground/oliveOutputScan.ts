/**
 * Server-only Olive output scan + opaque id registry.
 * Do not import from the browser bundle.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasAllowedOliveOutputExtension,
  isPathInsideRoots,
  resolveOliveOutputRoots,
  type OliveOutputEntry,
  type OliveOutputRootSpec,
  type OliveRootLabel,
} from "../../../lib/arenaOliveOutputs.ts";

export const OLIVE_OUTPUT_MAX_DEPTH = 4;
export const OLIVE_OUTPUT_MAX_ENTRIES = 200;
/** Hard cap on directory nodes inspected (files + dirs), separate from matched models. */
export const OLIVE_OUTPUT_MAX_VISITED = 2_000;
export const OLIVE_OUTPUT_RECENT_LIMIT = 10;
/** Soft response-size cap for Arena convenience downloads (512 MiB). */
export const OLIVE_OUTPUT_MAX_BYTES = 512 * 1024 * 1024;

type RegistryEntry = {
  absolutePath: string;
  rootLabel: OliveRootLabel;
  displayPath: string;
};

/** Process-local id → path map (rebuilt on each list scan). */
const idRegistry = new Map<string, RegistryEntry>();

let rootsOverride: OliveOutputRootSpec[] | null = null;

/**
 * Sets test-only output roots and clears the registered output IDs.
 *
 * @param roots - The output roots to use for testing, or `null` to restore configured roots
 */
export function __setOliveOutputRootsForTests(roots: OliveOutputRootSpec[] | null): void {
  rootsOverride = roots;
  idRegistry.clear();
}

/**
 * Resolves the configured Olive output roots.
 *
 * @returns The configured Olive output root specifications.
 */
export function getOliveOutputRoots(): OliveOutputRootSpec[] {
  if (rootsOverride) return rootsOverride;
  return resolveOliveOutputRoots({
    cacheDir: process.env.OLIVE_CACHE_DIR ?? "",
    outputDir: process.env.OLIVE_OUTPUT_DIR,
    cwd: process.cwd(),
    homedir: os.homedir(),
  });
}

/**
 * Resolves a path to its canonical filesystem representation when it exists.
 *
 * @param p - The path to canonicalize
 * @returns The canonical filesystem path, or the resolved path if canonicalization fails
 */
function canonicalizeExisting(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Generates a stable opaque identifier for a canonical file path.
 *
 * @param absolutePath - The canonical file path to identify
 * @returns A SHA-256 hexadecimal identifier derived from the path
 */
function mintOpaqueId(absolutePath: string): string {
  // Stable for the same canonical path so refreshes do not invalidate entries.
  return createHash("sha256").update(absolutePath).digest("hex");
}

type ScannedFile = {
  absolutePath: string;
  rootLabel: OliveRootLabel;
  displayPath: string;
  sizeBytes: number;
  mtimeMs: number;
};

/**
 * Scans a configured output root and appends eligible files to the provided collection.
 *
 * @param root - The output root to scan
 * @param maxDepth - The maximum directory depth to traverse
 * @param maxEntries - The maximum number of files to collect
 * @param maxVisited - The maximum number of directory entries to inspect
 * @param out - The collection receiving scanned file metadata
 * @param visitState - The shared count of inspected directory entries
 */
function walkRoot(
  root: OliveOutputRootSpec,
  maxDepth: number,
  maxEntries: number,
  maxVisited: number,
  out: ScannedFile[],
  visitState: { count: number },
): void {
  if (out.length >= maxEntries || visitState.count >= maxVisited) return;
  if (!fs.existsSync(root.absolutePath)) return;

  const rootReal = canonicalizeExisting(root.absolutePath);
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootReal, depth: 0 }];

  while (stack.length > 0 && out.length < maxEntries && visitState.count < maxVisited) {
    const { dir, depth } = stack.pop()!;
    let directory: fs.Dir;
    try {
      directory = fs.opendirSync(dir);
    } catch {
      continue;
    }

    try {
      for (
        let entry = directory.readSync();
        entry !== null && out.length < maxEntries && visitState.count < maxVisited;
        entry = directory.readSync()
      ) {
        visitState.count += 1;
        const child = path.join(dir, entry.name);
        let realChild: string;
        try {
          realChild = fs.realpathSync.native(child);
        } catch {
          continue;
        }

        if (!isPathInsideRoots(realChild, [rootReal])) continue;

        if (entry.isDirectory()) {
          if (depth + 1 <= maxDepth) stack.push({ dir: realChild, depth: depth + 1 });
          continue;
        }

        if (!entry.isFile()) continue;
        if (!hasAllowedOliveOutputExtension(realChild)) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(realChild);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;

        out.push({
          absolutePath: realChild,
          rootLabel: root.label,
          displayPath: path.relative(rootReal, realChild).split(path.sep).join("/"),
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    } finally {
      directory.closeSync();
    }
  }
}

export type OliveOutputsListResult = {
  roots: Array<{ label: OliveRootLabel }>;
  recent: OliveOutputEntry[];
  entries: OliveOutputEntry[];
};

/**
 * Scans configured Olive output roots and refreshes the opaque ID registry.
 *
 * @returns The configured root labels, recent output entries, and complete output entry list
 */
export function listOliveOutputs(): OliveOutputsListResult {
  idRegistry.clear();
  const roots = getOliveOutputRoots();
  const scanned: ScannedFile[] = [];
  const visitState = { count: 0 };
  for (const root of roots) {
    walkRoot(
      root,
      OLIVE_OUTPUT_MAX_DEPTH,
      OLIVE_OUTPUT_MAX_ENTRIES,
      OLIVE_OUTPUT_MAX_VISITED,
      scanned,
      visitState,
    );
  }

  const entries: OliveOutputEntry[] = scanned.map((file) => {
    const id = mintOpaqueId(file.absolutePath);
    idRegistry.set(id, {
      absolutePath: file.absolutePath,
      rootLabel: file.rootLabel,
      displayPath: file.displayPath,
    });
    return {
      id,
      displayPath: file.displayPath,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      rootLabel: file.rootLabel,
    };
  });

  const recent = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, OLIVE_OUTPUT_RECENT_LIMIT);

  return {
    roots: roots.map((r) => ({ label: r.label })),
    recent,
    entries,
  };
}

export type OliveOutputResolveOk = {
  ok: true;
  absolutePath: string;
  basename: string;
  sizeBytes: number;
};

export type OliveOutputResolveErr = {
  ok: false;
  status: 400 | 403;
};

/**
 * Resolves a registered Olive output for download after revalidating its location and file properties.
 *
 * @param id - The opaque identifier for the registered output
 * @returns The validated file path, basename, and size when authorized; otherwise, an error status
 */
export function resolveOliveOutputForDownload(id: unknown): OliveOutputResolveOk | OliveOutputResolveErr {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, status: 400 };
  }

  const registered = idRegistry.get(id);
  if (!registered) {
    return { ok: false, status: 400 };
  }

  const roots = getOliveOutputRoots().map((r) => canonicalizeExisting(r.absolutePath));
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(registered.absolutePath);
  } catch {
    return { ok: false, status: 403 };
  }

  if (!isPathInsideRoots(realPath, roots)) {
    return { ok: false, status: 403 };
  }
  if (!hasAllowedOliveOutputExtension(realPath)) {
    return { ok: false, status: 403 };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, status: 403 };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 403 };
  }
  // Empty models are not useful for Arena convenience fill (Req 18.4 / Property 20).
  if (stat.size <= 0) {
    return { ok: false, status: 403 };
  }
  if (stat.size > OLIVE_OUTPUT_MAX_BYTES) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    absolutePath: realPath,
    basename: path.basename(realPath),
    sizeBytes: stat.size,
  };
}

/** Query keys that must never drive list/download root selection. */
export const REJECTED_OLIVE_OUTPUT_QUERY_KEYS = [
  "path",
  "absolutePath",
  "cacheDir",
  "outputDir",
] as const;

/**
 * Determines whether a query contains a parameter that cannot control Olive output selection.
 *
 * @param query - The query parameters to inspect
 * @returns `true` if the query contains a rejected parameter, `false` otherwise
 */
export function hasRejectedOliveOutputQuery(query: Record<string, unknown>): boolean {
  return REJECTED_OLIVE_OUTPUT_QUERY_KEYS.some((key) => key in query);
}
