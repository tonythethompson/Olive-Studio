/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Router } from "express";
import { resolveCloudTimeoutMs } from "../../lib/arenaConstants.ts";
import { arenaLocalOnly } from "../middleware/localOnly.ts";
import { arenaProxyRateLimit } from "../middleware/rateLimit.ts";
import { pinnedFetch, SsrfPolicyError } from "../services/arena/ssrfGuard.ts";

/** True when pinnedFetch/readBody rejected an oversized upstream payload. */
function isUpstreamBodySizeLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("exceeded maximum allowed size");
}

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
  // Local-first access boundary (loopback) before rate limit / proxy work.
  // Override with OLIVE_ARENA_ALLOW_REMOTE=true when intentionally exposing the API.
  router.post("/arena/cloud-inference", arenaLocalOnly, arenaProxyRateLimit, async (req, res) => {
    const { endpointUrl, apiKey, modelId, prompt, timeoutMs } = req.body ?? {};

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

    // Exact clamp (preserve in-range values like 1001) — same semantics as the client.
    // CodeQL js/resource-exhaustion treats any setTimeout/setInterval delay derived from
    // request body as tainted even after clamp; schedule with a fixed literal tick and
    // compare against a Date.now() deadline so the sink is not user-controlled.
    const resolvedTimeoutMs = resolveCloudTimeoutMs(timeoutMs);
    const ac = new AbortController();
    const deadlineMs = Date.now() + resolvedTimeoutMs;
    const timer = setInterval(() => {
      if (Date.now() >= deadlineMs) {
        clearInterval(timer);
        if (!ac.signal.aborted) ac.abort();
      }
    }, 50);

    // Abort upstream work on client gone, but distinguish disconnect from a normal
    // response completion (`res` "close" also fires after a finished write).
    let clientDisconnected = false;
    const onClientGone = () => {
      if (res.writableEnded) return;
      clientDisconnected = true;
      if (!ac.signal.aborted) ac.abort();
    };
    req.on("aborted", onClientGone);
    res.on("close", onClientGone);

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

      if (clientDisconnected || res.writableEnded || res.destroyed) return;

      if (!upstream.ok) {
        let errText = "";
        try {
          errText = await upstream.text();
        } catch (readErr: unknown) {
          // Preserve timeout / disconnect AbortError for the outer catch (do not
          // convert abort into an empty upstream-error detail).
          if (readErr instanceof Error && readErr.name === "AbortError") throw readErr;
          // Oversized upstream error bodies → controlled 502 (not the upstream status).
          if (isUpstreamBodySizeLimitError(readErr)) throw readErr;
          // Other read failures: fall through with empty detail, preserve upstream status.
        }
        if (clientDisconnected || res.writableEnded || res.destroyed) return;
        return res.status(upstream.status).json({
          error: `Upstream error ${upstream.status}`,
          detail: errText.slice(0, 500),
        });
      }

      let data: { choices?: Array<{ message?: { content?: string } }> };
      try {
        data = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
      } catch (readErr: unknown) {
        // AbortError and size-limit errors are classified in the outer catch.
        throw readErr instanceof Error ? readErr : new Error(String(readErr));
      }
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return res.json({ output: text });
    } catch (err: unknown) {
      // Client already left — do not serialize timeout/gateway JSON onto a closed socket.
      if (clientDisconnected || res.writableEnded || res.destroyed || res.headersSent) return;
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const isSizeLimit = isUpstreamBodySizeLimitError(err);
      const message = err instanceof Error ? err.message : String(err);
      // Policy / SSRF rejections are client errors, not bad gateway
      const isPolicy = err instanceof SsrfPolicyError;
      return res.status(isTimeout ? 504 : isPolicy ? 400 : 502).json({
        error: isTimeout
          ? `Request timed out after ${resolvedTimeoutMs}ms`
          : isSizeLimit
            ? "Upstream response exceeded maximum allowed size"
            : message,
      });
    } finally {
      clearInterval(timer);
      req.off("aborted", onClientGone);
      res.off("close", onClientGone);
    }
  });
}
