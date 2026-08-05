/**
 * Normalizes a path and resolves relative paths against a base path.
 *
 * @param value - The path to normalize.
 * @param base - The base path for resolving relative values.
 * @returns The normalized path with redundant segments removed.
 */
/** Extract a Windows drive or UNC prefix from a slash-normalized path. */
function extractWindowsPrefix(
  normalized: string,
): { prefix: string; rest: string } | null {
  const driveMatch = normalized.match(/^([a-zA-Z]:)(\/.*)?$/);
  if (driveMatch) {
    return { prefix: driveMatch[1]!, rest: driveMatch[2] ?? "/" };
  }
  // //server/share[/...] — keep //server/share as the immutable root prefix.
  const uncMatch = normalized.match(/^(\/\/[^/]+\/[^/]+)(\/.*)?$/);
  if (uncMatch) {
    return { prefix: uncMatch[1]!, rest: uncMatch[2] ?? "/" };
  }
  return null;
}

function resolvePath(value: string, base = ""): string {
  const normalized = value.replace(/\\/g, "/");
  const baseNorm = base.replace(/\\/g, "/").replace(/\/+$/, "");

  const valueWin = extractWindowsPrefix(normalized);
  const isAbsolute = normalized.startsWith("/") || valueWin !== null;

  let prefix = "";
  let candidate: string;

  if (isAbsolute && valueWin) {
    prefix = valueWin.prefix;
    candidate = valueWin.rest;
  } else if (isAbsolute) {
    candidate = normalized;
  } else {
    // Relative: combine with base first, then detect Windows prefixes on the
    // result so `resolvePath("models/out", "C:\\workspace")` keeps `C:`.
    candidate = baseNorm ? `${baseNorm}/${normalized}` : normalized;
    const combinedWin = extractWindowsPrefix(candidate);
    if (combinedWin) {
      prefix = combinedWin.prefix;
      candidate = combinedWin.rest;
    }
  }

  const parts: string[] = [];
  for (const part of candidate.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return prefix + "/" + parts.join("/");
}

/**
 * Extracts the final component from a path.
 *
 * @param pathname - The path whose final component to extract
 * @returns The final path component, or an empty string when none exists
 */
function basename(pathname: string): string {
  return pathname.replace(/\\/g, "/").split("/").pop() ?? "";
}

export type OliveRootLabel = "cache" | "output";

/** Client-facing list entry — never includes absolute filesystem paths. */
export interface OliveOutputEntry {
  id: string;
  displayPath: string;
  sizeBytes: number;
  mtimeMs: number;
  rootLabel: OliveRootLabel;
}

export type OliveOutputRootSpec = {
  label: OliveRootLabel;
  absolutePath: string;
};

/**
 * Resolves the cache and output directories used for Olive artifacts.
 *
 * Empty `cacheDir` defaults to `.cache/olive` under `homedir`. A missing or
 * empty `outputDir` defaults to `models/optimized` under `cwd`. Duplicate
 * absolute paths are removed while preserving the first root label.
 *
 * @param opts - Directory configuration and home-directory path
 * @returns The resolved, deduplicated Olive output root specifications
 */
export function resolveOliveOutputRoots(opts: {
  cacheDir: string;
  outputDir?: string;
  cwd?: string;
  homedir: string;
}): OliveOutputRootSpec[] {
  const cwd = opts.cwd ?? process.cwd();
  const cacheAbsolute =
    opts.cacheDir.trim() === ""
      ? resolvePath(".cache/olive", opts.homedir)
      : resolvePath(opts.cacheDir, cwd);
  const outputAbsolute = resolvePath(opts.outputDir?.trim() || "models/optimized", cwd);

  const roots: OliveOutputRootSpec[] = [
    { label: "cache", absolutePath: cacheAbsolute },
    { label: "output", absolutePath: outputAbsolute },
  ];

  // Dedupe by absolute path while preserving first label.
  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.absolutePath)) return false;
    seen.add(root.absolutePath);
    return true;
  });
}

/** True when `resolvedPath` is equal to or strictly inside one of `roots`. */
export function isPathInsideRoots(resolvedPath: string, roots: string[]): boolean {
  const normalized = resolvePath(resolvedPath);
  for (const root of roots) {
    const normalizedRoot = resolvePath(root);
    if (normalized === normalizedRoot) return true;
    const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : normalizedRoot + "/";
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

export const OLIVE_OUTPUT_ALLOWED_EXTENSIONS = new Set([".onnx", ".ort"]);

/**
 * Determines whether a file path has an allowed Olive output extension.
 *
 * @param filePath - The file path to inspect
 * @returns `true` if the final extension is `.onnx` or `.ort`, `false` otherwise
 */
export function hasAllowedOliveOutputExtension(filePath: string): boolean {
  const file = basename(filePath);
  const dot = file.lastIndexOf(".");
  const ext = dot >= 0 ? file.slice(dot).toLowerCase() : "";
  return OLIVE_OUTPUT_ALLOWED_EXTENSIONS.has(ext);
}
