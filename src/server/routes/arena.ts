/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Router } from "express";
import { resolveCloudTimeoutMs } from "../../lib/arenaConstants.ts";

/**
 * Registers Arena routes on an Express router.
 *
 * Provides a cloud inference proxy that forwards requests to arbitrary
 * OpenAI-compatible endpoints, avoiding browser-side CORS issues.
 *
 * @param router - Express router on which to register the routes
 */
export function mountArenaRoutes(router: Router): void {
  router.post("/arena/cloud-inference", async (req, res) => {
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
      const upstream = await fetch(`${targetUrl.origin}${targetUrl.pathname}/chat/completions`, {
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
