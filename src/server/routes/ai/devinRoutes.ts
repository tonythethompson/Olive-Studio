/** Devin routes: /devin/account, /devin/login, /devin/login/complete, /devin/logout, /devin/models. */
import type { Router } from "express";

import {
  finishDevinLogin,
  getDevinAccountStatus,
  getDevinSignInUrl,
  listDevinModels,
  logoutDevin,
} from "../../../lib/devin/client.ts";
import { authActionRateLimit } from "../../middleware/rateLimit.ts";
import { parseBody, isParseBodyError } from "../../middleware/bodyGuard.ts";

export function mountDevinRoutes(router: Router): void {
  router.get("/devin/account", (_req, res) => {
    return res.json(getDevinAccountStatus());
  });

  router.get("/devin/login", (_req, res) => {
    const url = getDevinSignInUrl();
    return res.json({ ok: true, authUrl: url });
  });

  router.post("/devin/login/complete", authActionRateLimit, async (req, res) => {
    const body = parseBody<{ token: string }>(req.body, {
      token: { type: "string", message: "Missing token" },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });
    try {
      const result = await finishDevinLogin(body.parsed.token);
      return res.json({ ok: true, ...result });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/devin/logout", (_req, res) => {
    logoutDevin();
    return res.json({ ok: true });
  });

  router.get("/devin/models", async (_req, res) => {
    try {
      const catalog = await listDevinModels();
      return res.json({ models: catalog.models, source: catalog.source, error: catalog.error });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
