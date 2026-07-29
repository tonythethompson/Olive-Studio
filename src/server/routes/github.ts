/**
 * GitHub recipe proxy route handler.
 * Proxies raw.githubusercontent.com fetches to avoid browser CORS issues.
 */
import type { Router } from "express";

function parseGitHubRepoQuery(owner?: string, repo?: string, repoSlug?: string) {
  if (owner && repo) {
    return { owner: owner.trim(), repo: repo.trim() };
  }
  if (!repoSlug) return null;
  const clean = repoSlug
    .trim()
    .replace(/^https:\/\/github.com\//, "")
    .replace(/^https:\/\/raw.githubusercontent.com\//, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const [parsedOwner, parsedRepo] = clean.split("/");
  if (!parsedOwner || !parsedRepo) return null;
  return { owner: parsedOwner, repo: parsedRepo };
}

export function mountGithubRoutes(router: Router): void {
  router.get("/github/raw", async (req, res) => {
    const owner = String(req.query.owner || "");
    const repo = String(req.query.repo || "");
    const repoSlug = String(req.query.repoSlug || req.query.repoUrl || "");
    const branch = String(req.query.branch || "main");
    const filePath = String(req.query.path || "").replace(/^\/+/, "");

    const parsed = parseGitHubRepoQuery(owner, repo, repoSlug);
    if (!parsed || !filePath) {
      return res.status(400).json({ error: "Missing owner/repo and recipe path." });
    }

    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${filePath}`;

    try {
      const upstream = await fetch(rawUrl, { headers: { "User-Agent": "olive-studio" } });
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `Remote file not found at ${parsed.owner}/${parsed.repo}/${branch}/${filePath} (HTTP ${upstream.status}).`,
        });
      }
      const text = await upstream.text();
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
