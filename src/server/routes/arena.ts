/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Router } from "express";
import { resolveCloudTimeoutMs } from "../../lib/arenaConstants.ts";
import { githubProxyRateLimit } from "../middleware/rateLimit.ts";

/**
 * Registers Arena routes on an Express router.
 *
 * Provides a cloud inference proxy that forwards requests to arbitrary
 * OpenAI-compatible endpoints, avoiding browser-side CORS issues.
 *
 * @param router - Express router on which to register the routes
 */
export function mountArenaRoutes(router: Router): void {
  router.post("/arena/cloud-inference", githubProxyRateLimit, async (req, res) => {
    const { endpointUrl, apiKey, modelId, prompt, timeoutMs } = req.body ?? {};
    const resolvedTimeoutMs = resolveCloudTimeoutMs(timeoutMs);

    // Validate required fields
    if (!endpointUrl || typeof endpointUrl !== "string")
      return res.status(400).json({ error: "endpointUrl is required" });
    if (!prompt || typeof prompt !== "string")
      return res.status(400).json({ error: "prompt is required" });

    // Restrict to http/https only — no file://, data:, javascript:, etc.
    let targetUrl: URL;
    try {
      targetUrl = new URL(endpointUrl);
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:")
        throw new Error("Only http/https endpoints are supported");
      if (targetUrl.username || targetUrl.password)
        throw new Error("Credentialed endpoints are not supported");
      const hostname = targetUrl.hostname.toLowerCase();
      const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
      if (targetUrl.protocol !== "https:" && !(isLoopback && process.env.OLIVE_ALLOW_LOOPBACK_HTTP === "true"))
        throw new Error("HTTPS endpoints are required");
      if ((!isLoopback || targetUrl.protocol !== "http:" || process.env.OLIVE_ALLOW_LOOPBACK_HTTP !== "true") &&
          (isLoopback || hostname.endsWith(".local") || hostname === "0.0.0.0" || hostname === "::1") ||
          /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname))
        throw new Error("Private endpoints are not supported");
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid endpointUrl" });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: modelId || undefined,
      messages: [{ role: "user", content: prompt }],
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), resolvedTimeoutMs);

    try {
      const basePath = targetUrl.pathname.replace(/\/+$/, "");
      targetUrl.pathname = basePath.endsWith("/chat/completions")
        ? basePath
        : `${basePath}/chat/completions`;
      const upstream = await fetch(targetUrl.toString(), {
        method: "POST",
        headers,
        body,
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status).json({
          error: `Upstream error ${upstream.status}`,
          detail: errText.slice(0, 500),
        });
      }

      const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return res.json({ output: text });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isTimeout = err instanceof Error && err.name === "AbortError";
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout
          ? `Request timed out after ${resolvedTimeoutMs}ms`
          : (err instanceof Error ? err.message : String(err)),
      });
    }
  });
}
