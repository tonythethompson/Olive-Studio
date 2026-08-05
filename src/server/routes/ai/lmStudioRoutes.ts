/**
 * LM Studio local model routes: /ai/local-models, /ai/local-model-sizes,
 * /ai/local-health, /ai/local-load, /ai/local-unload, /ai/local-pull.
 */
import type { Router } from "express";
import { spawn } from "child_process";

import { isValidLocalModelTag } from "../../../lib/localModelTag.ts";
import {
  hintForLmsPullFailure,
  mapLmsDownloadPercent,
  parseLmsGetPercent,
  splitCliLines,
} from "../../../lib/lmsPullProgress.ts";
import { gateLocalPullDiskSpace } from "../../../lib/localEngineDisk.ts";
import { heavyCommandRateLimit } from "../../middleware/rateLimit.ts";
import { localEngineRuntime } from "../../services/ai/localEngineState.ts";
import {
  LM_STUDIO_PORT,
  lmStudioFetchInit,
  isLmsServerRunning,
  findLmsCli,
  listLmsInstalledModelKeys,
  ensureLmsReady,
  starterMetaForTag,
  verifyInstalledAfterPull,
  LMS_GET_MAX_MS,
} from "./localEngines.ts";
import { trackStreamClient, beginPullSse } from "./streamHelpers.ts";

export function mountLmStudioRoutes(router: Router): void {
  router.get("/ai/local-models", async (_req, res) => {
    try {
      // Loaded (serving) models come from the local OpenAI-compat API.
      let loadedModels: string[] = [];
      try {
        const loadedRes = await fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`, lmStudioFetchInit());
        if (loadedRes.ok) {
          const loadedData = (await loadedRes.json()) as { data?: Array<{ id: string }> };
          loadedModels = (loadedData.data ?? []).map((m) => m.id);
        }
      } catch {
        /* server down */
      }

      // Downloaded/catalog models: prefer `lms ls` (API only lists currently loaded).
      const fromCli = await listLmsInstalledModelKeys();
      const installedModels =
        fromCli && fromCli.length > 0
          ? fromCli
          : loadedModels.length > 0
            ? loadedModels
            : [];

      return res.json({ installedModels, loadedModels });
    } catch {
      return res.json({ installedModels: [], loadedModels: [] });
    }
  });

  router.get("/ai/local-model-sizes", async (_req, res) => {
    try {
      const r = await fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`, lmStudioFetchInit());
      const sizes: Record<string, number> = {};
      if (r.ok) {
        const data = (await r.json()) as { data?: Array<{ id: string; size?: number }> };
        for (const m of data.data ?? []) {
          if (m.size) sizes[m.id] = m.size;
        }
      }
      return res.json({ sizes });
    } catch {
      return res.json({ sizes: {} });
    }
  });

  router.get("/ai/local-health", async (_req, res) => {
    const healthy = await isLmsServerRunning();
    const lmsCli = await findLmsCli();
    return res.json({ healthy, lmsInstalled: !!lmsCli });
  });

  router.post("/ai/local-load", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    try {
      const r = await fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelTag }),
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

  router.post("/ai/local-unload", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    try {
      const r = await fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelTag }),
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

  router.post("/ai/local-pull", heavyCommandRateLimit, async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    const guard = trackStreamClient(req, res);
    const rawSend = beginPullSse(res);
    const send = (evt: Record<string, unknown>) => {
      if (guard.disconnected()) return;
      rawSend(evt);
    };
    const tag = String(modelTag);
    const releaseBusy = () => {
      if (localEngineRuntime.lmsPullBusyTag === tag) localEngineRuntime.lmsPullBusyTag = null;
    };
    try {
      if (!isValidLocalModelTag(tag)) {
        send({ type: "error", error: "Invalid modelTag." });
        guard.endOnce();
        return;
      }
      if (localEngineRuntime.lmsPullBusyTag) {
        send({
          type: "error",
          error: "Another LM Studio download is already in progress.",
          hint: `Wait for "${localEngineRuntime.lmsPullBusyTag}" to finish, or cancel that download, then retry.`,
        });
        guard.endOnce();
        return;
      }
      const disk = gateLocalPullDiskSpace("lms", tag);
      if (!disk.ok) {
        send({ type: "error", error: disk.error, hint: disk.hint });
        guard.endOnce();
        return;
      }

      localEngineRuntime.lmsPullBusyTag = tag;
      // The first caller's disconnect aborts the shared ensure; later callers
      // consume progress but never cancel it.
      const ready = await ensureLmsReady((evt) => send(evt), guard.signal);
      if (guard.disconnected()) {
        releaseBusy();
        guard.endOnce();
        return;
      }
      if (!ready.ok) {
        send({
          type: "error",
          error: ready.error || "LM Studio is not ready",
          openedUrl: ready.openedUrl ?? "https://lmstudio.ai",
        });
        releaseBusy();
        guard.endOnce();
        return;
      }
      const lmsCli = await findLmsCli();
      if (!lmsCli) {
        send({
          type: "error",
          error: "LM Studio CLI (lms) not found. Install LM Studio from https://lmstudio.ai",
          openedUrl: "https://lmstudio.ai",
        });
        releaseBusy();
        guard.endOnce();
        return;
      }
      send({ type: "step", message: `Downloading ${tag} via LM Studio (lms get)…`, percent: 5 });
      // LM Studio CLI downloads with `lms get`, not Ollama-style `pull`. `-y` skips prompts.
      // Prefer Hugging Face URLs for starters; bare staff-pick names often exit 1.
      const proc = spawn(lmsCli, ["get", tag, "-y"], { stdio: "pipe" });
      let timedOut = false;
      /** Escalate SIGTERM → SIGKILL so a stuck `lms get` cannot pin the busy gate forever. */
      const KILL_ESCALATE_MS = 2_000;
      let killEscalateTimer: ReturnType<typeof setTimeout> | undefined;
      const clearKillEscalate = () => {
        if (killEscalateTimer) {
          clearTimeout(killEscalateTimer);
          killEscalateTimer = undefined;
        }
      };
      const killProc = () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* already exited */
        }
        if (killEscalateTimer) return;
        killEscalateTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already exited */
          }
        }, KILL_ESCALATE_MS);
        if (typeof killEscalateTimer.unref === "function") killEscalateTimer.unref();
      };
      const maxTimer = setTimeout(() => {
        timedOut = true;
        killProc();
      }, LMS_GET_MAX_MS);
      guard.signal.addEventListener("abort", killProc, { once: true });

      const logBuf: string[] = [];
      const pushCliChunk = (d: Buffer) => {
        for (const line of splitCliLines(d.toString())) {
          logBuf.push(line);
          if (logBuf.length > 80) logBuf.splice(0, logBuf.length - 80);
          const cliPct = parseLmsGetPercent(line);
          if (cliPct !== null) {
            send({
              type: "progress",
              message: line.replace(/\s+/g, " ").slice(0, 160),
              percent: mapLmsDownloadPercent(cliPct),
            });
          } else {
            send({ type: "log", message: line.slice(0, 240) });
          }
        }
      };
      proc.stdout?.on("data", pushCliChunk);
      proc.stderr?.on("data", pushCliChunk);
      proc.on("close", (code) => {
        clearTimeout(maxTimer);
        clearKillEscalate();
        void (async () => {
          try {
            if (!guard.disconnected()) {
              if (timedOut) {
                send({
                  type: "error",
                  error: "LM Studio download exceeded the server time limit (20 minutes).",
                  hint: "Retry when the network is stable, or finish/resume the download in the LM Studio app.",
                });
              } else if (code === 0) {
                const listed = await listLmsInstalledModelKeys();
                if (listed === null) {
                  const starter = starterMetaForTag("lms", tag);
                  send({
                    type: "done",
                    message: "Model downloaded successfully.",
                    ok: true,
                    percent: 100,
                    modelId: starter?.enableTag ?? tag,
                    verified: false,
                  });
                } else {
                  const check = verifyInstalledAfterPull("lms", tag, listed);
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
              } else {
                const { error, hint } = hintForLmsPullFailure(logBuf.join("\n"), code);
                send({ type: "error", error, hint });
              }
            }
          } finally {
            releaseBusy();
            guard.endOnce();
          }
        })();
      });
      proc.on("error", (err) => {
        clearTimeout(maxTimer);
        clearKillEscalate();
        if (!guard.disconnected()) send({ type: "error", error: err.message });
        releaseBusy();
        guard.endOnce();
      });
    } catch (err: unknown) {
      releaseBusy();
      if (!guard.disconnected()) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      }
      guard.endOnce();
    }
  });
}
