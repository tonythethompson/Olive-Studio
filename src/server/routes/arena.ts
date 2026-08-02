/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Router } from "express";
import { resolveCloudTimeoutMs } from "../../lib/arenaConstants.ts";
import { arenaProxyRateLimit } from "../middleware/rateLimit.ts";
import { pinnedFetch } from "../services/arena/ssrfGuard.ts";

/**
 * Registers Arena routes on an Express router.
 *
 * Provides a cloud inference proxy that forwards requests to arbitrary
 * OpenAI-compatible endpoints, avoiding browser-side CORS issues.
 * Outbound fetches use DNS resolve-and-pin SSRF protection.
 *
 * @param router - Express router on which to register the routes
 */
export function mountArenaRoutes(router: Router): void {
  router.post("/arena/cloud-inference", arenaProxyRateLimit, async (req, res) => {
    const { endpointUrl, apiKey, modelId, prompt, timeoutMs } = req.body ?? {};
    const resolvedTimeoutMs = resolveCloudTimeoutMs(timeoutMs);

    if (!endpointUrl || typeof endpointUrl !== "string")
      return res.status(400).json({ error: "endpointUrl is required" });
    if (!prompt || typeof prompt !== "string")
      return res.status(400).json({ error: "prompt is required" });
    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== "string")
      return res.status(400).json({ error: "apiKey must be a string" });
    if (modelId !== undefined && modelId !== null && typeof modelId !== "string")
      return res.status(400).json({ error: "modelId must be a string" });

    let targetUrl: URL;
    try {
      targetUrl = new URL(endpointUrl);
    } catch {
      return res.status(400).json({ error: "Invalid endpointUrl" });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof apiKey === "string" && apiKey.length > 0) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const body = JSON.stringify({
      model: typeof modelId === "string" && modelId.length > 0 ? modelId : undefined,
      messages: [{ role: "user", content: prompt }],
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), resolvedTimeoutMs);

    try {
      const basePath = targetUrl.pathname.replace(/\/+$/, "");
      targetUrl.pathname = basePath.endsWith("/chat/completions")
        ? basePath
        : `${basePath}/chat/completions`;

      // DNS resolve → reject private IPs → connect to pinned IP with Host/SNI
      // (see ssrfGuard.pinnedFetch). Timer stays active through body read.
      const upstream = await pinnedFetch(targetUrl, {
        method: "POST",
        headers,
        body,
        signal: ac.signal,
      });

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status).json({
          error: `Upstream error ${upstream.status}`,
          detail: errText.slice(0, 500),
        });
      }

      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return res.json({ output: text });
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const message = err instanceof Error ? err.message : String(err);
      // Policy / SSRF rejections are client errors, not bad gateway
      const isPolicy =
        /not (supported|allowed)|HTTPS|Credentialed|Private|DNS resolution|redirect refused/i.test(
          message,
        );
      return res.status(isTimeout ? 504 : isPolicy ? 400 : 502).json({
        error: isTimeout ? `Request timed out after ${resolvedTimeoutMs}ms` : message,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
