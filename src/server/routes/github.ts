/**
 * GitHub recipe proxy route handler.
 * Proxies raw.githubusercontent.com fetches to avoid browser CORS issues.
 * Includes server-side LRU cache + ETag support to reduce GitHub API usage.
 */
import type { Router, Request, Response } from "express";
import { createHash } from "node:crypto";
import { githubProxyRateLimit } from "../middleware/rateLimit.ts";

// ─── LRU Cache (50 entries, 5-min TTL) ────────────────────────────────────────
interface CacheEntry {
  body: string;
  etag: string;
  timestamp: number;
}

const CACHE_MAX = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Move to end (most recently used)
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, body: string): string {
  const etag = `"${createHash("md5").update(body).digest("hex").slice(0, 16)}"`;
  if (cache.size >= CACHE_MAX) {
    // Evict oldest (first key)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { body, etag, timestamp: Date.now() });
  return etag;
}

/** Middleware: respond 304 if client sends matching If-None-Match. */
function etagConditional(req: Request, res: Response, etag: string, body: string): boolean {
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=60");
  const clientEtag = req.headers["if-none-match"];
  // If-None-Match may be a comma-separated list or "*"; handle weak ETags (W/…)
  const matches =
    clientEtag === "*" ||
    (typeof clientEtag === "string" &&
      clientEtag.split(",").some((e) => e.trim().replace(/^W\//, "") === etag));
  if (matches) {
    res.status(304).end();
    return true;
  }
  res.setHeader("Content-Type", "application/json");
  res.send(body);
  return false;
}

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9_./-]+$/;
const FILE_PATH_RE = /^[A-Za-z0-9_./-]+$/;

function parseGitHubRepoQuery(owner?: string, repo?: string, repoSlug?: string) {
  if (owner && repo) {
    return { owner: owner.trim(), repo: repo.trim() };
  }
  if (!repoSlug) return null;
  const clean = repoSlug
    .trim()
    // Escape dots so "rawXgithubusercontent.com" cannot match.
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^https:\/\/raw\.githubusercontent\.com\//, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const [parsedOwner, parsedRepo] = clean.split("/");
  if (!parsedOwner || !parsedRepo) return null;
  return { owner: parsedOwner, repo: parsedRepo };
}

function isSafeGitHubComponent(value: string, pattern: RegExp): boolean {
  return pattern.test(value) && !value.includes("..");
}

export function mountGithubRoutes(router: Router): void {
  router.get("/github/raw", githubProxyRateLimit, async (req, res) => {
    const owner = String(req.query.owner || "");
    const repo = String(req.query.repo || "");
    const repoSlug = String(req.query.repoSlug || req.query.repoUrl || "");
    const branch = String(req.query.branch || "main");
    const filePath = String(req.query.path || "").replace(/^\/+/, "");

    const parsed = parseGitHubRepoQuery(owner, repo, repoSlug);
    if (!parsed || !filePath) {
      return res.status(400).json({ error: "Missing owner/repo and recipe path." });
    }

    if (
      !isSafeGitHubComponent(parsed.owner, OWNER_REPO_RE) ||
      !isSafeGitHubComponent(parsed.repo, OWNER_REPO_RE) ||
      !isSafeGitHubComponent(branch, BRANCH_RE) ||
      !isSafeGitHubComponent(filePath, FILE_PATH_RE)
    ) {
      return res.status(400).json({ error: "Invalid GitHub owner, repo, branch, or path." });
    }

    const rawUrl = new URL(
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${filePath}`,
    );
    if (rawUrl.hostname !== "raw.githubusercontent.com" || rawUrl.protocol !== "https:") {
      return res.status(400).json({ error: "Refusing to fetch from non-GitHub host." });
    }

    const cacheKey = `raw:${parsed.owner}/${parsed.repo}/${branch}/${filePath}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      etagConditional(req, res, cached.etag, cached.body);
      return;
    }

    try {
      const headers: Record<string, string> = { "User-Agent": "olive-studio" };
      // Use GITHUB_TOKEN for higher rate limits (5000 req/hr vs 60)
      const token = process.env.GITHUB_TOKEN;
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const upstream = await fetch(rawUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `Remote file not found at ${parsed.owner}/${parsed.repo}/${branch}/${filePath} (HTTP ${upstream.status}).`,
        });
      }
      const text = await upstream.text();
      // Cap payload size before JSON.parse to avoid memory spikes from huge blobs.
      if (text.length > 5_000_000) {
        return res.status(413).json({ error: "Remote file is too large to proxy." });
      }
      // Validate JSON before caching
      try {
        JSON.parse(text);
      } catch {
        return res.status(415).json({ error: "Remote file is not valid JSON." });
      }
      const etag = cacheSet(cacheKey, text);
      etagConditional(req, res, etag, text);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("GitHub raw proxy error:", error);
      return res.status(502).json({ error: msg || "Failed to fetch recipe from GitHub." });
    }
  });
}
