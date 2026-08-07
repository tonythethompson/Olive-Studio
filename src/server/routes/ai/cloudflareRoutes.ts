/**
 * Cloudflare Workers AI routes: /cloudflare/account, /cloudflare/login,
 * /cloudflare/sync, /cloudflare/login/manual, /cloudflare/logout, /cloudflare/models.
 */
import type { Router } from "express";

import {
  getCloudflareAccountStatus,
  listCloudflareModels,
  logoutCloudflare,
  saveManualCloudflareCredentials,
  startCloudflareLogin,
  syncCloudflareFromWrangler,
} from "../../../lib/cloudflare/client.ts";
import { isValidCloudflareAccountId } from "../../../lib/cloudflare/credentials.ts";
import { isParseBodyError, parseBody } from "../../middleware/bodyGuard.ts";
import { authActionRateLimit } from "../../middleware/rateLimit.ts";

export function mountCloudflareRoutes(router: Router): void {
  router.get("/cloudflare/account", (_req, res) => {
    return res.json(getCloudflareAccountStatus());
  });

  router.post("/cloudflare/login", authActionRateLimit, async (_req, res) => {
    const result = await startCloudflareLogin();
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  });

  router.post("/cloudflare/sync", authActionRateLimit, async (req, res) => {
    // express.json() leaves body undefined when the client sends no payload;
    // optional accountId means an empty object is a valid default sync.
    const body = parseBody<{ accountId?: string }>(req.body ?? {}, {
      accountId: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });
    try {
      const preferredAccountId = body.parsed.accountId?.trim() || undefined;
      const creds = await syncCloudflareFromWrangler(preferredAccountId);
      return res.json({
        ok: true,
        accountId: creds.accountId,
        accountName: creds.accountName,
        email: creds.email,
        authType: creds.authType,
      });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/cloudflare/login/manual", authActionRateLimit, (req, res) => {
    const body = parseBody<{ apiToken: unknown; accountId: unknown }>(req.body, {
      apiToken: { type: "unknown", message: "apiToken and accountId are required." },
      accountId: { type: "unknown", message: "apiToken and accountId are required." },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });
    try {
      const { apiToken: rawApiToken, accountId: rawAccountId } = body.parsed;
      const apiToken = typeof rawApiToken === "string" ? rawApiToken.trim() : "";
      const accountId = typeof rawAccountId === "string" ? rawAccountId.trim() : "";
      if (!apiToken || !accountId) {
        return res.status(400).json({ ok: false, error: "apiToken and accountId are required." });
      }
      if (!isValidCloudflareAccountId(accountId)) {
        return res
          .status(400)
          .json({ ok: false, error: "accountId must be a 32-character hex Cloudflare account id." });
      }
      const creds = saveManualCloudflareCredentials({ apiToken, accountId });
      return res.json({ ok: true, accountId: creds.accountId });
    } catch (err: unknown) {
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/cloudflare/logout", (_req, res) => {
    logoutCloudflare();
    return res.json({ ok: true });
  });

  router.get("/cloudflare/models", async (_req, res) => {
    try {
      const catalog = await listCloudflareModels();
      return res.json({ models: catalog.models, source: catalog.source, error: catalog.error });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
