/**
 * GitHub recipe proxy route handler.
 * Proxies raw.githubusercontent.com fetches to avoid browser CORS issues.
 */
import type { Router } from "express";
import { githubProxyRateLimit } from "../middleware/rateLimit.ts";

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

    try {
      const upstream = await fetch(rawUrl, {
        headers: { "User-Agent": "olive-studio" },
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
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.status(415).json({ error: "Remote file is not valid JSON." });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("GitHub raw proxy error:", error);
      return res.status(502).json({ error: msg || "Failed to fetch recipe from GitHub." });
    }
  });
}
