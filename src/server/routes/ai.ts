/**
 * AI-related route handlers.
 *
 * Covers: provider management, chat, model catalogs, local models (LM Studio + Ollama),
 * Codex, Devin, pipeline validation, and analysis.
 */
import type { Router } from "express";
import { spawn, execFile, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import rateLimit from "express-rate-limit";

import { callAI, getAiProvider, detectEnvProvider, setRuntimeAiProvider } from "../services/ai/index.ts";
import type { ProviderConfig } from "../types.ts";
import { sanitizeProviderBaseUrl } from "../services/ai/security.ts";
import { ALLOWED_AI_PROVIDERS } from "../services/ai/detect.ts";
import { parseJsonFromAiResponse, readEnvApiKey } from "../../lib/aiResponse.ts";
import { buildAiWorkspaceContext, formatAiWorkspaceContextForPrompt } from "../../lib/aiWorkspaceContext.ts";
import { validateOliveRecipeStructure } from "../../lib/oliveRecipeSchema.ts";
import { getCodexAppServer } from "../../lib/codex/CodexAppServerClient.ts";
import { buildCodexPrompt, codexAsk } from "../../lib/codex/codexAgent.ts";
import {
  devinChat,
  finishDevinLogin,
  getDevinAccountStatus,
  getDevinSignInUrl,
  listDevinModels,
  logoutDevin,
} from "../../lib/devin/client.ts";

const execFileAsync = promisify(execFile);

// ─── Rate limiter for engine installation ──────────────────────────────────

const installEngineRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many engine install requests. Please wait 5 minutes and try again." },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const LM_STUDIO_PORT = 1234;
const OLLAMA_PORT = 11434;

function lmStudioFetchInit(signal?: AbortSignal): RequestInit {
  return {
    signal,
    headers: { "Content-Type": "application/json" },
    // LM Studio local API doesn't need authorization
  };
}

async function isLmsServerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(
      `http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`,
      lmStudioFetchInit(controller.signal),
    );
    clearTimeout(timeout);
    return response.status > 0;
  } catch {
    return false;
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function findLmsCli(): string | null {
  let cachedLmsCli: string | null = null;
  if (cachedLmsCli) return cachedLmsCli;
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, ".lmstudio", "bin", "lms.exe"),
          path.join(home, ".lmstudio", "bin", "lms"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "LM Studio", "lms.exe"),
          path.join(process.env.LOCALAPPDATA || "", "LM Studio", "lms.exe"),
        ]
      : [path.join(home, ".lmstudio", "bin", "lms"), "/usr/local/bin/lms", "/opt/homebrew/bin/lms"];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      cachedLmsCli = c;
      return cachedLmsCli;
    }
  }
  try {
    const result = execSync(process.platform === "win32" ? "where lms" : "which lms", {
      encoding: "utf-8",
      timeout: 2000,
      windowsHide: true,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0]
      ?.trim();
    if (result && fs.existsSync(result)) {
      cachedLmsCli = result;
      return cachedLmsCli;
    }
  } catch {
    /* not on PATH */
  }
  return null;
}

function findOllamaCli(): string | null {
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
          path.join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
          path.join(home, "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
        ]
      : ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", path.join(home, ".ollama", "bin", "ollama")];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    const result = execSync(process.platform === "win32" ? "where ollama" : "which ollama", {
      encoding: "utf-8",
      timeout: 2000,
      windowsHide: true,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0]
      ?.trim();
    if (result && fs.existsSync(result)) return result;
  } catch {
    /* not on PATH */
  }
  return null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryWingetInstall(packageIds: string[]): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("winget", ["--version"], { timeout: 5000 });
  } catch {
    return false;
  }
  for (const id of packageIds) {
    try {
      await execFileAsync(
        "winget",
        [
          "install",
          "-e",
          "--id",
          id,
          "--accept-package-agreements",
          "--accept-source-agreements",
          "--disable-interactivity",
        ],
        { timeout: 600_000, windowsHide: true },
      );
      return true;
    } catch {
      /* try next id */
    }
  }
  return false;
}

async function ensureOllamaReady(
  onProgress?: (evt: { type: string; message: string; percent?: number }) => void,
): Promise<{ ok: boolean; error?: string; steps: string[] }> {
  const steps: string[] = [];
  const note = (message: string, percent?: number) => {
    steps.push(message);
    onProgress?.({ type: "step", message, percent });
  };
  if (await isOllamaRunning()) {
    note("Ollama already running", 15);
    return { ok: true, steps };
  }
  let ollama = findOllamaCli();
  if (!ollama) {
    note("Ollama CLI not found — installing…", 5);
    if (process.platform === "win32") {
      note("Running winget install Ollama.Ollama…", 8);
      await tryWingetInstall(["Ollama.Ollama"]);
    } else if (process.platform === "darwin") {
      note("Running brew install ollama…", 8);
      try {
        await execFileAsync("brew", ["install", "ollama"], { timeout: 600_000 });
      } catch {
        note("brew install failed", 12);
      }
    }
    for (let i = 0; i < 15; i++) {
      ollama = findOllamaCli();
      if (ollama) break;
      await sleepMs(2000);
    }
  }
  if (!ollama)
    return {
      ok: false,
      steps,
      error: "Could not install or find Ollama. Install from https://ollama.com, then retry.",
    };
  if (!(await isOllamaRunning())) {
    note("Starting ollama serve…", 22);
    try {
      const child = spawn(ollama, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
    } catch (err: unknown) {
      note(`spawn serve failed: ${err instanceof Error ? err.message : String(err)}`, 22);
    }
    for (let i = 0; i < 30; i++) {
      await sleepMs(1000);
      if (await isOllamaRunning()) {
        note("Ollama HTTP server ready on :11434", 30);
        return { ok: true, steps };
      }
    }
    return {
      ok: false,
      steps,
      error: "Ollama serve did not start. Run `ollama serve` manually, then retry.",
    };
  }
  return { ok: true, steps };
}

function beginNdjsonStream(res: import("express").Response): (evt: Record<string, unknown>) => void {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  return (evt) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(evt)}\n`);
  };
}

function endNdjson(res: import("express").Response, final: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`${JSON.stringify(final)}\n`);
    res.end();
  }
}

/** Begin SSE stream for local model pull progress. */
function beginPullSse(res: import("express").Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const send = (data: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  return send;
}

// ─── Mount all AI routes ────────────────────────────────────────────────────

export function mountAiRoutes(router: Router): void {
  // ─── AI Provider ──────────────────────────────────────────────────────────

  router.get("/ai/provider", (_req, res) => {
    const cfg = getAiProvider();
    if (!cfg) return res.json({ provider: null, model: null, source: "none" });
    return res.json({ provider: cfg.provider, model: cfg.model });
  });

  router.post("/ai/provider", (req, res) => {
    const { provider, apiKey, model, baseUrl } = req.body ?? {};
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    let normalizedBaseUrl: string | undefined;
    try {
      normalizedBaseUrl = sanitizeProviderBaseUrl(provider, baseUrl);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    setRuntimeAiProvider({ provider, apiKey, model, baseUrl: normalizedBaseUrl });
    return res.json({ ok: true, provider, model });
  });

  router.delete("/ai/provider", (_req, res) => {
    setRuntimeAiProvider(null);
    return res.json({ ok: true });
  });

  // ─── AI Models ───────────────────────────────────────────────────────────

  router.get("/ai/models", (_req, res) => {
    return res.json({
      models: [
        { id: "gemini-2.5-flash", provider: "gemini" },
        { id: "gemini-2.5-pro", provider: "gemini" },
        { id: "gpt-4o-mini", provider: "openai" },
        { id: "gpt-4o", provider: "openai" },
        { id: "claude-haiku-4-5-20251001", provider: "anthropic" },
        { id: "claude-sonnet-4-20250514", provider: "anthropic" },
        { id: "mistral-large-latest", provider: "mistral" },
        { id: "grok-3", provider: "xai" },
      ],
    });
  });

  router.post("/ai/models", async (req, res) => {
    const { provider, apiKey, baseUrl } = req.body ?? {};
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    try {
      const envCfg = detectEnvProvider();
      const key = apiKey?.trim() || envCfg?.apiKey;
      if (!key)
        return res.json({
          models: [],
          source: "fallback",
          error: "No API key available. Set an env var or provider in Settings.",
        });
      const modelCatalog = await fetchLiveModelCatalog(
        provider as ProviderConfig["provider"],
        key,
        baseUrl?.trim() || undefined,
      );
      return res.json(modelCatalog);
    } catch (err: unknown) {
      return res
        .status(500)
        .json({ models: [], source: "fallback", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── AI Chat ──────────────────────────────────────────────────────────────

  router.post("/ai/chat", async (req, res) => {
    const { message, workspaceContext, state, chatHistory } = req.body;
    if (!message || typeof message !== "string") return res.status(400).json({ error: "Missing message" });
    try {
      const system = "You are an Olive model optimization assistant.";
      const messages = (chatHistory ?? []).concat([{ role: "user", content: message }]);
      const reply = await callAI(system, messages);
      return res.json({ reply });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Pipeline Validation & Analysis ──────────────────────────────────────

  router.post("/ai/validate", async (req, res) => {
    const { recipe } = req.body ?? {};
    if (!recipe) return res.status(400).json({ error: "Missing recipe" });
    try {
      const validation = validateOliveRecipeStructure(
        typeof recipe === "string" ? JSON.parse(recipe) : recipe,
      );
      if (!validation.valid) return res.json({ valid: false, errors: validation.errors });
      const system =
        "You are an Olive model optimization validator. Review the recipe and return JSON: { valid: boolean, warnings: string[], suggestions: string[] }";
      const summary = JSON.stringify(recipe, null, 2).slice(0, 8000);
      const reply = await callAI(
        system,
        [{ role: "user", content: `Validate this Olive recipe: ${summary}` }],
        true,
      );
      const parsed = parseJsonFromAiResponse(reply);
      return res.json({ valid: true, ...(typeof parsed === "object" && parsed ? parsed : {}) });
    } catch (err: unknown) {
      return res.status(500).json({ valid: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/ai/analyze-state", async (req, res) => {
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ error: "Missing state" });
    try {
      const ctx = buildAiWorkspaceContext(state);
      const ctxSummary = formatAiWorkspaceContextForPrompt(ctx);
      const system = `You analyze Olive optimization pipelines. Return JSON: { score: number 0-100, level: "Optimized"|"Suboptimal"|"Critical", summary: string, suggestions: Array<{ title: string, description: string, impact: "High"|"Medium"|"Low", type: "warning"|"success"|"suggestion"|"info", autofix: { pass: string, value: string } }> }`;
      const reply = await callAI(system, [{ role: "user", content: ctxSummary }], true);
      const parsed = parseJsonFromAiResponse(reply);
      return res.json(
        typeof parsed === "object" && parsed
          ? parsed
          : { score: 50, level: "Suboptimal", summary: "Could not analyze.", suggestions: [] },
      );
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── LM Studio Local Models ──────────────────────────────────────────────

  router.get("/ai/local-models", async (_req, res) => {
    try {
      const [installedRes, loadedRes] = await Promise.allSettled([
        fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`, lmStudioFetchInit()),
        fetch(`http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`, lmStudioFetchInit()),
      ]);
      const installedData =
        installedRes.status === "fulfilled" && installedRes.value.ok
          ? ((await installedRes.value.json()) as { data?: Array<{ id: string }> })
          : { data: [] };
      const loadedData =
        loadedRes.status === "fulfilled" && loadedRes.value.ok
          ? ((await loadedRes.value.json()) as { data?: Array<{ id: string }> })
          : { data: [] };
      const installedModels = (installedData.data ?? []).map((m: { id: string }) => m.id);
      const loadedModels = (loadedData.data ?? []).map((m: { id: string }) => m.id);
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
    const lmsCli = findLmsCli();
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

  router.post("/ai/local-pull", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    const send = beginPullSse(res);
    const lmsCli = findLmsCli();
    if (!lmsCli) {
      send({
        type: "error",
        error: "LM Studio CLI (lms) not found. Install LM Studio from https://lmstudio.ai",
      });
      res.end();
      return;
    }
    try {
      send({ type: "step", message: `Pulling ${modelTag} via LM Studio…`, percent: 5 });
      const proc = spawn(lmsCli, ["pull", String(modelTag)], { stdio: "pipe" });
      proc.stdout.on("data", (d: Buffer) => {
        d.toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((l) => send({ type: "log", message: l }));
      });
      proc.stderr.on("data", (d: Buffer) => {
        d.toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((l) => send({ type: "log", message: l }));
      });
      proc.on("close", (code) => {
        if (code === 0) send({ type: "done", message: "Model pulled successfully.", ok: true });
        else send({ type: "error", error: `LM Studio pull exited with code ${code}` });
        res.end();
      });
      proc.on("error", (err) => {
        send({ type: "error", error: err.message });
        res.end();
      });
    } catch (err: unknown) {
      send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      res.end();
    }
  });

  // ─── Ollama Local Models ─────────────────────────────────────────────────

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

  router.post("/ai/ollama-pull", async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    const send = beginPullSse(res);
    const ready = await ensureOllamaReady((evt) => send(evt));
    if (!ready.ok) {
      send({ type: "error", error: ready.error });
      res.end();
      return;
    }
    try {
      send({ type: "step", message: `Pulling ${modelTag} via Ollama…`, percent: 30 });
      const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelTag, stream: true }),
      });
      if (!r.ok || !r.body) {
        send({ type: "error", error: `Ollama pull failed (HTTP ${r.status})` });
        res.end();
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
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
              res.end();
              return;
            }
            if (evt.completed && evt.total) {
              send({
                type: "progress",
                message: evt.status || "Downloading…",
                percent: Math.round((evt.completed / evt.total) * 60) + 30,
              });
            } else send({ type: "log", message: evt.status || line });
          } catch {
            /* non-JSON line */
          }
        }
      }
      send({ type: "done", message: "Model pulled successfully.", ok: true, percent: 100 });
    } catch (err: unknown) {
      send({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
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

  // ─── Engine Installation ─────────────────────────────────────────────────

  router.post("/ai/install-engine", installEngineRateLimiter, async (req, res) => {
    const { engine } = req.body ?? {};
    if (engine !== "lms" && engine !== "ollama")
      return res.status(400).json({ error: "engine must be 'lms' or 'ollama'" });
    const send = beginNdjsonStream(res);
    try {
      if (engine === "ollama") {
        send({ type: "step", message: "Ensuring Ollama is installed…", percent: 0 });
        const result = await ensureOllamaReady((evt) => send(evt));
        if (!result.ok) {
          endNdjson(res, { type: "error", error: result.error });
          return;
        }
        endNdjson(res, { type: "done", ok: true, message: "Ollama is ready.", percent: 100 });
      } else {
        const lmsCli = findLmsCli();
        if (!lmsCli) {
          endNdjson(res, {
            type: "done",
            ok: false,
            error: "LM Studio CLI (lms) not found. Install LM Studio from https://lmstudio.ai",
            openedUrl: "https://lmstudio.ai",
          });
          return;
        }
        const healthy = await isLmsServerRunning();
        if (!healthy) {
          send({ type: "step", message: "Starting LM Studio server…", percent: 50 });
          try {
            const child = spawn(lmsCli, ["server"], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
              env: { ...process.env },
            });
            child.unref();
            for (let i = 0; i < 15; i++) {
              await sleepMs(1000);
              if (await isLmsServerRunning()) break;
            }
          } catch (err: unknown) {
            /* continue */
          }
        }
        endNdjson(res, { type: "done", ok: true, message: "LM Studio is ready.", percent: 100 });
      }
    } catch (err: unknown) {
      endNdjson(res, { type: "error", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── OpenAI Codex ────────────────────────────────────────────────────────

  router.get("/codex/account", async (_req, res) => {
    try {
      const server = getCodexAppServer();
      if (!server.isReady) return res.json({ ready: false, error: "Codex app-server not running" });
      const account = await server.readAccount();
      return res.json({ ok: true, ready: true, account: account?.account ?? null });
    } catch (err: unknown) {
      return res.json({ ready: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/codex/login", async (_req, res) => {
    try {
      const server = getCodexAppServer();
      if (!server.isReady) return res.status(400).json({ ok: false, error: "Codex app-server not running" });
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

  router.post("/codex/login/cancel", async (req, res) => {
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

  // ─── Devin ───────────────────────────────────────────────────────────────

  router.get("/devin/account", (_req, res) => {
    return res.json(getDevinAccountStatus());
  });

  router.get("/devin/login", (_req, res) => {
    const url = getDevinSignInUrl();
    return res.json({ ok: true, authUrl: url });
  });

  router.post("/devin/login/complete", async (req, res) => {
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });
    try {
      const result = await finishDevinLogin(token);
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
      const models = await listDevinModels();
      return res.json({ models });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Fetch live model catalog from a provider's API. */
async function fetchLiveModelCatalog(provider: string, apiKey: string, baseUrl?: string) {
  const base = baseUrl?.replace(/\/+$/, "") || defaultBaseUrl(provider);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  try {
    const r = await fetch(`${base}/models`, { headers });
    if (!r.ok) return { models: [], source: "fallback", error: `HTTP ${r.status}` };
    const data = (await r.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    return {
      models: models.length > 0 ? models : await fallbackModels(provider),
      source: models.length > 0 ? "live" : "fallback",
    };
  } catch {
    return { models: await fallbackModels(provider), source: "fallback" };
  }
}

function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "together":
      return "https://api.together.xyz/v1";
    case "kilocode":
      return "https://api.kilo.ai/api/gateway";
    default:
      return "https://api.openai.com/v1";
  }
}

async function fallbackModels(provider: string): Promise<Array<{ id: string; label: string }>> {
  const map: Record<string, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
    mistral: ["mistral-large-latest", "mistral-medium-latest"],
    xai: ["grok-3", "grok-3-mini"],
  };
  return (map[provider] ?? ["default"]).map((id) => ({ id, label: id }));
}

export function registerAiRoutes(app: import("express").Express): void {
  const { Router } = require("express") as typeof import("express");
  const router = Router();
  mountAiRoutes(router);
  app.use("/api", router);
}
