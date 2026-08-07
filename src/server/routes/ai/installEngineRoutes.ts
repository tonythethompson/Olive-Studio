/**
 * Engine installation route: POST /ai/install-engine (streams setup progress
 * for LM Studio or Ollama).
 *
 * Concurrent install requests share one in-flight `ensure*` setup. Shared work
 * is cancelled only when every waiting client disconnects; a late client's tab
 * close does not abort setup others are still waiting on.
 */
import type { Router } from "express";
import rateLimit from "express-rate-limit";

import { ensureOllamaReady, ensureLmsReady } from "./localEngines.ts";
import { beginNdjsonStream, endNdjson, trackStreamClient } from "./streamHelpers.ts";
import { parseBody, isParseBodyError } from "../../middleware/bodyGuard.ts";

const installEngineRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many engine install requests. Please wait 5 minutes and try again." },
});

export function mountInstallEngineRoutes(router: Router): void {
  router.post("/ai/install-engine", installEngineRateLimiter, async (req, res) => {
    const body = parseBody<{ engine: string }>(req.body, {
      engine: { type: "string", message: "engine must be 'lms' or 'ollama'" },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { engine } = body.parsed;
    if (engine !== "lms" && engine !== "ollama")
      return res.status(400).json({ error: "engine must be 'lms' or 'ollama'" });
    const guard = trackStreamClient(req, res);
    const rawSend = beginNdjsonStream(res);
    const send = (evt: Record<string, unknown>) => {
      if (guard.disconnected()) return;
      rawSend(evt);
    };
    try {
      if (engine === "ollama") {
        send({ type: "step", message: "Ensuring Ollama is installed…", percent: 0 });
        const result = await ensureOllamaReady((evt) => send(evt), guard.signal);
        if (guard.disconnected()) {
          guard.endOnce();
          return;
        }
        if (!result.ok) {
          endNdjson(res, { type: "error", error: result.error });
          return;
        }
        endNdjson(res, { type: "done", ok: true, message: "Ollama is ready.", percent: 100 });
      } else {
        send({ type: "step", message: "Ensuring LM Studio is installed…", percent: 0 });
        const result = await ensureLmsReady((evt) => send(evt), guard.signal);
        if (guard.disconnected()) {
          guard.endOnce();
          return;
        }
        if (!result.ok) {
          endNdjson(res, {
            type: "error",
            error: result.error,
            openedUrl: result.openedUrl ?? "https://lmstudio.ai",
          });
          return;
        }
        endNdjson(res, { type: "done", ok: true, message: "LM Studio is ready.", percent: 100 });
      }
    } catch (err: unknown) {
      if (!guard.disconnected()) {
        endNdjson(res, { type: "error", error: err instanceof Error ? err.message : String(err) });
      } else {
        guard.endOnce();
      }
    }
  });
}
