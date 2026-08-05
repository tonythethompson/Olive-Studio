/** OpenAI Codex routes: /codex/account, /codex/login, /codex/login/cancel, /codex/logout, /codex/rate-limits, /codex/ask. */
import type { Router } from "express";

import { getCodexAppServer } from "../../../lib/codex/CodexAppServerClient.ts";
import { codexAsk } from "../../../lib/codex/codexAgent.ts";
import { authActionRateLimit } from "../../middleware/rateLimit.ts";

export function mountCodexRoutes(router: Router): void {
  router.get("/codex/account", async (_req, res) => {
    try {
      const server = getCodexAppServer();
      // Olive Studio owns the app-server child process; start it on demand.
      await server.start();
      const account = await server.readAccount();
      return res.json({ ok: true, ready: true, account: account?.account ?? null });
    } catch (err: unknown) {
      return res.json({ ready: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/codex/login", authActionRateLimit, async (_req, res) => {
    try {
      const server = getCodexAppServer();
      await server.start();
      const login = await server.startChatGptLogin();
      return res.json({
        ok: true,
        authUrl: login.authUrl,
        loginId: login.loginId,
        message: "Open the URL in your browser to sign in, then refresh.",
      });
    } catch (err: unknown) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/codex/login/cancel", authActionRateLimit, async (req, res) => {
    try {
      const server = getCodexAppServer();
      if (server.isReady) {
        const { loginId } = req.body ?? {};
        if (loginId) await server.cancelLogin(loginId);
      }
      return res.json({ ok: true });
    } catch {
      return res.json({ ok: true });
    }
  });

  router.post("/codex/logout", async (_req, res) => {
    try {
      const server = getCodexAppServer();
      if (server.isReady) await server.logout();
      return res.json({ ok: true });
    } catch {
      return res.json({ ok: true });
    }
  });

  router.get("/codex/rate-limits", async (_req, res) => {
    try {
      const server = getCodexAppServer();
      if (!server.isReady) return res.json({});
      const limits = await server.readRateLimits();
      return res.json(limits ?? {});
    } catch {
      return res.json({});
    }
  });

  router.post("/codex/ask", async (req, res) => {
    const { prompt, model } = req.body ?? {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    try {
      const reply = await codexAsk(prompt, { workingDirectory: process.cwd(), model: model || undefined });
      return res.json({ reply });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
