/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Router } from "express";
import { resolveCloudTimeoutMs } from "../../lib/arenaConstants.ts";
import { arenaProxyRateLimit } from "../middleware/rateLimit.ts";

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  // IPv4 private / link-local / CGNAT ranges
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  ) {
    return true;
  }
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Registers Arena routes on an Express router.
 *
 * Provides a cloud inference proxy that forwards requests to arbitrary
 * OpenAI-compatible endpoints, avoiding browser-side CORS issues.
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
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:")
        throw new Error("Only http/https endpoints are supported");
      if (targetUrl.username || targetUrl.password)
        throw new Error("Credentialed endpoints are not supported");

      const hostname = targetUrl.hostname;
      const loopback = isLoopbackHostname(hostname);
      const allowLoopbackHttp =
        loopback &&
        targetUrl.protocol === "http:" &&
        process.env.OLIVE_ALLOW_LOOPBACK_HTTP === "true";

      if (targetUrl.protocol !== "https:" && !allowLoopbackHttp)
        throw new Error("HTTPS endpoints are required");

      if (isPrivateOrLocalHostname(hostname) && !allowLoopbackHttp)
        throw new Error("Private endpoints are not supported");
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid endpointUrl" });
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

      // Keep abort timer active through response *body* consumption so a
      // headers-then-stall upstream still times out (review: cloud timeout).
      const upstream = await fetch(targetUrl.toString(), {
        method: "POST",
        headers,
        body,
        signal: ac.signal,
        redirect: "error",
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
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout
          ? `Request timed out after ${resolvedTimeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
