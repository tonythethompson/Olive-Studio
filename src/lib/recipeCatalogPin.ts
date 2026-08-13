/**
 * Recipe Catalog Version Pinning — utilities for resolving, tracking, and
 * validating the commit SHA at which recipe catalog entries were fetched.
 *
 * The catalog is fetched from the `microsoft/Olive` (or configured) recipes
 * repository. Each entry is pinned to a specific commit SHA so that loaded
 * recipes remain reproducible even when the upstream catalog updates.
 *
 * @module recipeCatalogPin
 */

import {
  getRecipesBranch,
  OLIVE_RECIPES_BRANCH_DEFAULT,
  OLIVE_RECIPES_REPO,
} from "@/lib/oliveRecipeHub";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CatalogMetadata {
  /** Branch name from which the catalog was fetched. */
  branch: string;
  /** Full 40-character hexadecimal Git commit SHA. */
  commitSha: string;
  /** ISO 8601 timestamp of when the catalog was fetched. */
  fetchedAt: string;
}

export interface CatalogEntry {
  /** Unique recipe identifier (typically derived from repo path). */
  id: string;
  /** Display name of the recipe. */
  name: string;
  /** Model architecture (e.g. "LLM", "Whisper", "Other"). */
  architecture: string;
  /** Target device/accelerator (e.g. "CPU", "CUDA", "TRT-RTX"). */
  deviceTarget: string;
  /** Full recipe content parsed from the repository, or null when not yet loaded (deferred). */
  content: Record<string, unknown> | null;
  /** Pinned metadata recording exact source revision. */
  pinned: CatalogMetadata;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Regex for a valid 40-character lowercase hexadecimal SHA. */
const SHA_HEX_RE = /^[0-9a-f]{40}$/;

/** GitHub API base URL for commit resolution. */
const GITHUB_API_BASE = "https://api.github.com";

/** Default fetch timeout in milliseconds. */
const FETCH_TIMEOUT_MS = 10_000;

// ─── SHA Validation ──────────────────────────────────────────────────────────

/**
 * Validates that a string is a well-formed 40-character hexadecimal Git SHA.
 *
 * @param sha - The string to validate.
 * @returns `true` if the SHA is valid, `false` otherwise.
 */
export function isValidSha(sha: string): boolean {
  return SHA_HEX_RE.test(sha);
}

// ─── Resolve HEAD SHA ────────────────────────────────────────────────────────

/**
 * Error class for catalog pin-related failures.
 */
export class CatalogPinError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "network"
      | "authentication"
      | "branch-not-found"
      | "invalid-response"
      | "rate-limit",
  ) {
    super(message);
    this.name = "CatalogPinError";
  }
}

/**
 * Resolves the HEAD commit SHA for the given branch of the recipes repository
 * via the GitHub API.
 *
 * @param branch - The branch to resolve (defaults to `getRecipesBranch()`).
 * @param repo - The GitHub repository (defaults to `OLIVE_RECIPES_REPO`).
 * @returns The 40-character lowercase hex commit SHA string.
 * @throws {CatalogPinError} If the request fails (network, auth, or branch not found).
 */
export async function resolveHeadSha(
  branch: string = getRecipesBranch(),
  repo: string = OLIVE_RECIPES_REPO,
  token?: string,
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/commits/${encodeURIComponent(branch)}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "olive-studio",
  };

  // Use caller-provided token for higher rate limits (server-side only).
  // WebView callers should not pass a token.
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CatalogPinError(
      `Failed to resolve HEAD sha for branch "${branch}": ${message}`,
      "network",
    );
  }

  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    throw new CatalogPinError(
      `Rate limit exceeded resolving HEAD SHA (HTTP ${response.status}).`,
      "rate-limit",
    );
  }

  if (response.status === 401) {
    throw new CatalogPinError(
      `Authentication error resolving HEAD SHA (HTTP ${response.status}).`,
      "authentication",
    );
  }

  if (response.status === 403) {
    // 403 can be rate-limit or auth; check ratelimit header first
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      throw new CatalogPinError(
        `Rate limit exceeded resolving HEAD SHA (HTTP 403).`,
        "rate-limit",
      );
    }
    throw new CatalogPinError(
      `Authentication error resolving HEAD SHA (HTTP 403).`,
      "authentication",
    );
  }

  if (response.status === 404 || response.status === 422) {
    throw new CatalogPinError(
      `Branch "${branch}" not found in repository "${repo}".`,
      "branch-not-found",
    );
  }

  if (!response.ok) {
    throw new CatalogPinError(
      `Failed to resolve HEAD SHA (HTTP ${response.status}).`,
      "network",
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CatalogPinError(
      "Invalid JSON response from GitHub API.",
      "invalid-response",
    );
  }

  const sha = typeof data.sha === "string" ? data.sha.toLowerCase() : "";

  if (!isValidSha(sha)) {
    throw new CatalogPinError(
      `Unexpected SHA format from GitHub API: "${sha}".`,
      "invalid-response",
    );
  }

  return sha;
}

// ─── Fetch Catalog at SHA ────────────────────────────────────────────────────

/**
 * Fetches the recipe catalog content at a specific commit SHA.
 *
 * This retrieves the catalog items from the repository at the exact revision
 * identified by `sha`, ensuring reproducibility. Each returned entry is pinned
 * with the commit metadata.
 *
 * @param sha - The 40-character hex commit SHA to fetch at.
 * @param branch - The branch name (recorded in metadata).
 * @param repo - The GitHub repository (defaults to `OLIVE_RECIPES_REPO`).
 * @returns Array of catalog entries pinned to the given SHA.
 * @throws {CatalogPinError} If the SHA is invalid or the fetch fails.
 */
export async function fetchCatalogAtSha(
  sha: string,
  branch: string = getRecipesBranch(),
  repo: string = OLIVE_RECIPES_REPO,
  token?: string,
): Promise<CatalogEntry[]> {
  if (!isValidSha(sha)) {
    throw new CatalogPinError(
      `Invalid commit SHA: "${sha}" (must be 40-char hex).`,
      "invalid-response",
    );
  }

  // Fetch the repository tree at the given SHA to discover recipe files.
  // Using the Git Trees API with recursive mode to list all files.
  const treeUrl = `${GITHUB_API_BASE}/repos/${repo}/git/trees/${sha}?recursive=1`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "olive-studio",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(treeUrl, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CatalogPinError(
      `Failed to fetch catalog tree at SHA "${sha}": ${message}`,
      "network",
    );
  }

  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    throw new CatalogPinError(
      `Rate limit exceeded fetching catalog at SHA "${sha}" (HTTP ${response.status}).`,
      "rate-limit",
    );
  }

  if (response.status === 401) {
    throw new CatalogPinError(
      `Authentication error fetching catalog at SHA "${sha}" (HTTP ${response.status}).`,
      "authentication",
    );
  }

  if (response.status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      throw new CatalogPinError(
        `Rate limit exceeded fetching catalog at SHA "${sha}" (HTTP 403).`,
        "rate-limit",
      );
    }
    throw new CatalogPinError(
      `Authentication error fetching catalog at SHA "${sha}" (HTTP 403).`,
      "authentication",
    );
  }

  if (response.status === 404) {
    throw new CatalogPinError(
      `Commit SHA "${sha}" not found in repository "${repo}".`,
      "branch-not-found",
    );
  }

  if (!response.ok) {
    throw new CatalogPinError(
      `Failed to fetch catalog tree (HTTP ${response.status}).`,
      "network",
    );
  }

  let treeData: Record<string, unknown>;
  try {
    treeData = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CatalogPinError(
      "Invalid JSON response when fetching catalog tree.",
      "invalid-response",
    );
  }

  const tree = Array.isArray(treeData.tree) ? treeData.tree : [];
  const metadata = formatCatalogMetadata(sha, branch);

  // Handle the Git Trees API truncated flag: when true, the tree is partial
  // and must not be pinned (would produce an incomplete catalog).
  if (treeData.truncated === true) {
    throw new CatalogPinError(
      `Catalog tree at SHA "${sha}" is truncated — cannot pin a partial catalog.`,
      "invalid-response",
    );
  }

  // Filter for JSON recipe files (exclude non-recipe files like README, etc.)
  // Guard each item as a non-null object before reading path/type.
  const recipeFiles = tree.filter(
    (item: unknown) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.path === "string" &&
        obj.path.endsWith(".json") &&
        obj.type === "blob" &&
        !obj.path.startsWith(".") &&
        !obj.path.includes("node_modules")
      );
    },
  );

  // Convert tree entries into CatalogEntry records.
  // The full recipe content is NOT fetched eagerly here — `content` is left as
  // a stub. The caller (task 10.4) fetches individual recipe content on demand
  // via the existing `fetchOliveRecipesCatalogItem` pattern.
  const entries: CatalogEntry[] = recipeFiles.map(
    (item: Record<string, unknown>) => {
      const path = String(item.path);
      const parts = path.split("/");
      const fileName = parts[parts.length - 1].replace(/\.json$/, "");
      const architecture = parts.length > 1 ? parts[0] : "Other";
      const deviceFolder = parts.length > 2 ? parts[1] : "";
      const deviceTarget = inferDeviceTarget(deviceFolder);

      return {
        id: path,
        name: `${architecture} / ${fileName}`,
        architecture,
        deviceTarget,
        content: null,
        pinned: metadata,
      };
    },
  );

  return entries;
}

// ─── Staleness Detection ─────────────────────────────────────────────────────

/**
 * Determines whether the stored catalog is stale relative to the upstream SHA.
 *
 * @param stored - The currently persisted catalog metadata.
 * @param upstreamSha - The latest HEAD SHA from the upstream repository.
 * @returns `true` if the stored catalog is outdated, `false` if it matches upstream.
 */
export function isCatalogStale(stored: CatalogMetadata, upstreamSha: string): boolean {
  // Normalize both SHAs to the same case before comparing.
  return stored.commitSha.toLowerCase() !== upstreamSha.toLowerCase();
}

// ─── Metadata Construction ───────────────────────────────────────────────────

/**
 * Constructs a `CatalogMetadata` object from a resolved SHA and branch name.
 *
 * @param sha - The 40-character hex commit SHA (must be validated beforehand).
 * @param branch - The branch name from which the SHA was resolved.
 * @returns A fully populated `CatalogMetadata` with the current ISO 8601 timestamp.
 */
export function formatCatalogMetadata(sha: string, branch: string): CatalogMetadata {
  return {
    branch,
    commitSha: sha.toLowerCase(),
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Default Branch Helper ───────────────────────────────────────────────────

/**
 * Returns the currently configured recipes branch.
 * Re-exports `getRecipesBranch()` for convenience alongside the pinning utilities.
 *
 * @returns The active branch name (from localStorage pin or `OLIVE_RECIPES_BRANCH_DEFAULT`).
 */
export function getDefaultBranch(): string {
  return getRecipesBranch();
}

/** Re-export the default branch constant for external consumption. */
export { OLIVE_RECIPES_BRANCH_DEFAULT };

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Infers a device target label from a folder name in the recipe repository tree.
 * Uses common naming conventions from the `microsoft/olive-recipes` layout.
 */
function inferDeviceTarget(folder: string): string {
  const lower = folder.toLowerCase();
  if (lower.includes("cpu")) return "CPU";
  if (lower.includes("cuda")) return "CUDA";
  if (lower.includes("tensorrtrtx") || lower.includes("nvtensorrtrtx") || lower.includes("trt-rtx") || lower.includes("trtrtx")) return "TRT-RTX";
  if (lower.includes("tensorrt") || lower.includes("trt")) return "TensorRT";
  if (lower.includes("directml") || lower.includes("dml")) return "DirectML";
  if (lower.includes("qnn")) return "QNN";
  if (lower.includes("openvino")) return "OpenVINO";
  if (lower.includes("webgpu")) return "WebGPU";
  if (lower.includes("rocm")) return "ROCm";
  if (lower.includes("coreml")) return "CoreML";
  if (lower.includes("quant")) return "CPU";
  if (lower.includes("baseline")) return "CPU";
  return "Other";
}
