/**
 * Ollama local model routes: /ai/ollama-models, /ai/ollama-model-sizes,
 * /ai/ollama-health, /ai/ollama-pull, /ai/ollama-load, /ai/ollama-unload.
 */
import type { Router } from "express";

import { isValidLocalModelTag } from "../../../lib/localModelTag.ts";
import { gateLocalPullDiskSpace } from "../../../lib/localEngineDisk.ts";
import { heavyCommandRateLimit } from "../../middleware/rateLimit.ts";
import { localEngineRuntime } from "../../services/ai/localEngineState.ts";
import {
  OLLAMA_PORT,
  isOllamaRunning,
  ensureOllamaReady,
  listOllamaInstalledNames,
  verifyInstalledAfterPull,
  OLLAMA_PULL_MAX_MS,
} from "./localEngines.ts";
import { trackStreamClient, beginPullSse } from "./streamHelpers.ts";

export function mountOllamaRoutes(router: Router): void {
  router.get("/ai/ollama-models", async (_req, res) => {
    try {
      const [tagsRes, psRes] = await Promise.all([
        fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`),
        fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/ps`),
      ]);
      if (!tagsRes.ok) return res.json({ installedModels: [], runningModels: [] });
      const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
      const installedModels = (data.models ?? []).map((m) => m.name);
      const psData = psRes.ok
        ? ((await psRes.json()) as { models?: Array<{ name: string }> })
        : { models: [] };
      const runningModels = (psData.models ?? []).map((m) => m.name);
      return res.json({ installedModels, runningModels });
    } catch {
      return res.json({ installedModels: [], runningModels: [] });
    }
  });

  router.get("/ai/ollama-model-sizes", async (_req, res) => {
    try {
      const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`);
      const sizes: Record<string, number> = {};
      if (r.ok) {
        const data = (await r.json()) as { models?: Array<{ name: string; size: number }> };
        for (const m of data.models ?? []) {
          if (m.size) sizes[m.name] = m.size;
        }
      }
      return res.json({ sizes });
    } catch {
      return res.json({ sizes: {} });
    }
  });

  router.get("/ai/ollama-health", async (_req, res) => {
    const healthy = await isOllamaRunning();
    return res.json({ healthy });
  });

  router.post("/ai/ollama-pull", heavyCommandRateLimit, async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    const guard = trackStreamClient(req, res);
    const rawSend = beginPullSse(res);
    const send = (evt: Record<string, unknown>) => {
      if (guard.disconnected()) return;
      rawSend(evt);
    };
    const tag = String(modelTag);
    let ownsBusy = false;
    const releaseBusy = () => {
      if (ownsBusy && localEngineRuntime.ollamaPullBusyTag === tag) {
        localEngineRuntime.ollamaPullBusyTag = null;
        ownsBusy = false;
      }
    };
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    try {
      if (!isValidLocalModelTag(tag)) {
        send({ type: "error", error: "Invalid modelTag." });
        guard.endOnce();
        return;
      }
      if (localEngineRuntime.ollamaPullBusyTag) {
        send({
          type: "error",
          error: "Another Ollama download is already in progress.",
          hint: `Wait for "${localEngineRuntime.ollamaPullBusyTag}" to finish, or cancel that download, then retry.`,
        });
        guard.endOnce();
        return;
      }
      const disk = gateLocalPullDiskSpace("ollama", tag);
      if (!disk.ok) {
        send({ type: "error", error: disk.error, hint: disk.hint });
        guard.endOnce();
        return;
      }

      localEngineRuntime.ollamaPullBusyTag = tag;
      ownsBusy = true;
      const ready = await ensureOllamaReady((evt) => send(evt), guard.signal);
      if (guard.disconnected()) {
        releaseBusy();
        guard.endOnce();
        return;
      }
      if (!ready.ok) {
        send({ type: "error", error: ready.error });
        releaseBusy();
        guard.endOnce();
        return;
      }

      send({ type: "step", message: `Pulling ${tag} via Ollama…`, percent: 30 });
      const timeoutAc = new AbortController();
      maxTimer = setTimeout(() => {
        timedOut = true;
        timeoutAc.abort();
      }, OLLAMA_PULL_MAX_MS);
      // Combine disconnect + wall-clock timeout without relying on AbortSignal.any.
      const pullAc = new AbortController();
      const forwardAbort = () => {
        if (!pullAc.signal.aborted) pullAc.abort();
      };
      guard.signal.addEventListener("abort", forwardAbort, { once: true });
      timeoutAc.signal.addEventListener("abort", forwardAbort, { once: true });
      if (guard.signal.aborted || timeoutAc.signal.aborted) forwardAbort();

      const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag, stream: true }),
        signal: pullAc.signal,
      });
      if (guard.disconnected()) {
        releaseBusy();
        guard.endOnce();
        return;
      }
      if (!r.ok || !r.body) {
        send({ type: "error", error: `Ollama pull failed (HTTP ${r.status})` });
        releaseBusy();
        guard.endOnce();
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        if (guard.disconnected() || timedOut) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          if (timedOut && !guard.disconnected()) {
            send({
              type: "error",
              error: "Ollama download exceeded the server time limit (20 minutes).",
              hint: "Retry when the network is stable, or run `ollama pull` in a terminal.",
            });
          }
          releaseBusy();
          guard.endOnce();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
              error?: string;
            };
            if (evt.error) {
              send({ type: "error", error: evt.error });
              releaseBusy();
              guard.endOnce();
              return;
            }
            if (typeof evt.completed === "number" && typeof evt.total === "number" && evt.total > 0) {
              send({
                type: "progress",
                message: evt.status || "Downloading…",
                percent: Math.round((evt.completed / evt.total) * 60) + 30,
              });
            } else if (evt.status) {
              // Already-cached pulls often only emit status strings (no byte totals).
              send({ type: "log", message: evt.status, percent: evt.status === "success" ? 95 : undefined });
            }
          } catch {
            /* non-JSON line */
          }
        }
      }

      const listed = await listOllamaInstalledNames();
      if (listed === null) {
        send({
          type: "done",
          message: "Model pulled successfully.",
          ok: true,
          percent: 100,
          modelId: tag,
          verified: false,
        });
      } else {
        const check = verifyInstalledAfterPull("ollama", tag, listed);
        if (!check.ok) {
          send({ type: "error", error: check.error, hint: check.hint });
        } else {
          send({
            type: "done",
            message: `Model ready: ${check.modelId}`,
            ok: true,
            percent: 100,
            modelId: check.modelId,
            verified: true,
          });
        }
      }
    } catch (err: unknown) {
      if (!guard.disconnected()) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (isAbort) {
          if (timedOut) {
            send({
              type: "error",
              error: "Ollama download exceeded the server time limit (20 minutes).",
              hint: "Retry when the network is stable, or run `ollama pull` in a terminal.",
            });
          } else {
            send({
              type: "error",
              error: "Ollama download was cancelled.",
              hint: "Retry the download, or cancel only if you meant to stop it.",
            });
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: "error", error: msg });
        }
      }
    } finally {
      if (maxTimer) clearTimeout(maxTimer);
      releaseBusy();
      guard.endOnce();
    }
  });

  router.post("/ai/ollama-load", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    try {
      const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelTag, keep_alive: -1 }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        return res.status(500).json({ error: d.error || `HTTP ${r.status}` });
      }
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/ai/ollama-unload", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    try {
      const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelTag, keep_alive: 0 }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        return res.status(500).json({ error: d.error || `HTTP ${r.status}` });
      }
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
