/**
 * Arena route handlers.
 * Cloud inference proxy for the Arena sub-view in the Playground tab.
 */
import type { Request, Response, Router } from "express";
import fs from "node:fs";
import { resolveCloudTimeoutMs, ARENA_PROMPT_MAX_CHARS } from "../../lib/arenaConstants.ts";
import { arenaLocalOnly } from "../middleware/localOnly.ts";
import { arenaProxyRateLimit } from "../middleware/rateLimit.ts";
import {
  pinnedFetch,
  SsrfPolicyError,
  UpstreamBodyTooLargeError,
} from "../services/arena/ssrfGuard.ts";
import {
  hasRejectedOliveOutputQuery,
  listOliveOutputs,
  resolveOliveOutputForDownload,
} from "../services/playground/oliveOutputScan.ts";

/**
 * Starts an abort timer that invokes the callback after the specified duration.
 *
 * @param abort - Callback invoked when the deadline is reached
 * @param ms - Duration before invoking the callback, in milliseconds
 * @returns The interval handle used to monitor the deadline
 */
function armCloudAbort(abort: () => void, ms: number): ReturnType<typeof setInterval> {
  const deadline = Date.now() + ms;
  const timer = setInterval(() => {
    if (Date.now() >= deadline) {
      clearInterval(timer);
      abort();
    }
  }, 25);
  return timer;
}

/**
 * Determines whether an error represents an aborted operation.
 *
 * @param err - The value to inspect
 * @returns `true` if `err` is an error named `AbortError`, `false` otherwise.
 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Determines whether an error indicates that an upstream response body exceeded its permitted size.
 *
 * @param err - The value to inspect
 * @returns `true` if the error indicates an oversized response body, `false` otherwise.
 */
function isBodyTooLarge(err: unknown): boolean {
  if (err instanceof UpstreamBodyTooLargeError) return true;
  // Also accept plain Error messages from older/mocked size-limit paths.
  return err instanceof Error && err.message.includes("exceeded maximum allowed size");
}

/**
 * Determines whether the response client can no longer receive a response.
 *
 * @param res - The response to inspect
 * @param clientDisconnected - Whether the client has disconnected
 * @returns `true` if the client is disconnected or the response is no longer writable, `false` otherwise
 */
function clientGone(res: Response, clientDisconnected: boolean): boolean {
  return clientDisconnected || res.writableEnded || res.destroyed || res.headersSent;
}

/**
 * Ends the response with a rejection status.
 *
 * @param status - The rejection status code, either 400 or 403
 */
function emptyReject(res: Response, status: 400 | 403): void {
  res.status(status).end();
}

/**
 * Registers Arena routes for cloud inference and Olive output access.
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
    if (prompt.length > ARENA_PROMPT_MAX_CHARS) {
      return res.status(400).json({
        error: `prompt must be at most ${ARENA_PROMPT_MAX_CHARS} characters`,
      });
    }
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
    const timer = armCloudAbort(() => {
      if (!ac.signal.aborted) ac.abort();
    }, resolvedTimeoutMs);
    // Abort upstream work on client gone, but distinguish disconnect from a normal
    // response completion (`res` "close" also fires after a finished write).
    let clientDisconnected = false;
    const onClientGone = () => {
      // Successful completion ends the writable side first. A premature client
      // disconnect may already set `destroyed` before this listener runs — still abort.
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

      if (clientGone(res, clientDisconnected)) return;

      if (!upstream.ok) {
        let errText = "";
        try {
          errText = await upstream.text();
        } catch (readErr: unknown) {
          // Preserve timeout / disconnect AbortError for the outer catch.
          if (isAbortError(readErr)) throw readErr;
          // Oversized upstream error bodies → controlled 502 (not the upstream status).
          if (isBodyTooLarge(readErr)) throw readErr;
          // Other read failures: fall through with empty detail, preserve upstream status.
          errText = "";
        }
        if (clientGone(res, clientDisconnected)) return;
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
        if (isAbortError(readErr) || isBodyTooLarge(readErr)) throw readErr;
        throw readErr instanceof Error ? readErr : new Error(String(readErr));
      }
      if (clientGone(res, clientDisconnected)) return;
      const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return res.json({ output: text });
    } catch (err: unknown) {
      // Client already left — do not serialize timeout/gateway JSON onto a closed socket.
      if (clientGone(res, clientDisconnected)) return;
      const isTimeout = isAbortError(err);
      const tooLarge = isBodyTooLarge(err);
      const message = err instanceof Error ? err.message : String(err);
      // Policy / SSRF rejections are client errors, not bad gateway
      const isPolicy = err instanceof SsrfPolicyError;
      return res.status(isTimeout ? 504 : isPolicy ? 400 : 502).json({
        error: isTimeout
          ? `Request timed out after ${resolvedTimeoutMs}ms`
          : tooLarge
            ? "Upstream response exceeded maximum allowed size"
            : message,
      });
    } finally {
      clearInterval(timer);
      req.off("aborted", onClientGone);
      res.off("close", onClientGone);
    }
  });

  router.get("/arena/olive-outputs", arenaLocalOnly, arenaProxyRateLimit, (req: Request, res: Response) => {
    if (hasRejectedOliveOutputQuery(req.query as Record<string, unknown>)) {
      return emptyReject(res, 400);
    }
    try {
      const payload = listOliveOutputs();
      return res.json(payload);
    } catch (err: unknown) {
      // Keep the empty 403 client contract; log so scan failures are distinguishable
      // from middleware access-boundary rejections in server logs.
      console.error("[arena/olive-outputs] listOliveOutputs failed:", err);
      return emptyReject(res, 403);
    }
  });

  router.get(
    "/arena/olive-outputs/file",
    arenaLocalOnly,
    arenaProxyRateLimit,
    (req: Request, res: Response) => {
      if (hasRejectedOliveOutputQuery(req.query as Record<string, unknown>)) {
        return emptyReject(res, 400);
      }
      let resolved: ReturnType<typeof resolveOliveOutputForDownload>;
      try {
        resolved = resolveOliveOutputForDownload(req.query.id);
      } catch (err: unknown) {
        // Sync FS / traversal throws must not fall through to Express's default handler.
        console.error("[arena/olive-outputs/file] resolveOliveOutputForDownload failed:", err);
        return emptyReject(res, 400);
      }
      if (!resolved.ok) {
        return emptyReject(res, resolved.status);
      }

      res.setHeader("Content-Type", "application/octet-stream");
      const safeBasename = resolved.basename.replace(/[\u0000-\u001f\u007f"\\]/g, "_");
      const asciiFallback = safeBasename.replace(/[^\x20-\x7e]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeBasename)}`,
      );
      // Omit Content-Length: Olive jobs may still be writing these files, so a
      // pre-declared length can silently truncate under chunked transfer instead.
      const stream = fs.createReadStream(resolved.absolutePath);
      const onClose = () => stream.destroy();
      res.once("close", onClose);
      stream.on("error", () => {
        if (!res.headersSent) {
          emptyReject(res, 403);
        } else res.destroy();
      });
      stream.pipe(res);
    },
  );
}
