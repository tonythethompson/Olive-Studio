/**
 * AI-related route handlers.
 *
 * Covers: provider management, chat, model catalogs, local models (LM Studio + Ollama),
 * Codex, Devin, pipeline validation, and analysis.
 */
import { Router } from "express";
import { spawn, execFile, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import rateLimit from "express-rate-limit";

import { callAI, detectEnvProvider, setRuntimeAiProvider, getProvider } from "../services/ai/index.ts";
import {
  getRuntimeAiProvider,
  readAiPreference,
  restoreProviderFromPreference,
} from "../services/ai/state.ts";
import { listEnvCredentialStatus } from "../services/ai/registry.ts";
import {
  buildOliveAssistantSystemPrompt,
  gatherOliveMcpKnowledge,
} from "../services/ai/oliveMcpKnowledge.ts";
import type { ProviderConfig } from "../types.ts";
import { sanitizeProviderBaseUrl, stripTrailingSlashes } from "../services/ai/security.ts";
import { ALLOWED_AI_PROVIDERS } from "../services/ai/detect.ts";
import { parseJsonFromAiResponse, readEnvApiKey } from "../../lib/aiResponse.ts";
import { parseAuditAnalysisReply } from "../../lib/auditAnalysis.ts";
import { filterAuditAnalysis } from "../../lib/auditSuggestionFilter.ts";
import { buildAiWorkspaceContext, formatAiWorkspaceContextForPrompt } from "../../lib/aiWorkspaceContext.ts";
import type { AiWorkspaceContext } from "../../lib/aiWorkspaceContext.ts";
import { CHAT_JSON_RESPONSE_CONTRACT, parseChatStructuredReply } from "../../lib/chatActions.ts";
import { getChatScopeBlock } from "../../lib/chatScope.ts";
import { validateOliveRecipeStructure } from "../../lib/oliveRecipeSchema.ts";
import { getCodexAppServer } from "../../lib/codex/CodexAppServerClient.ts";
import { codexAsk } from "../../lib/codex/codexAgent.ts";
import {
  finishDevinLogin,
  getDevinAccountStatus,
  getDevinSignInUrl,
  listDevinModels,
  logoutDevin,
} from "../../lib/devin/client.ts";
import {
  getCloudflareAccountStatus,
  listCloudflareModels,
  logoutCloudflare,
  resolveCloudflareAuth,
  saveManualCloudflareCredentials,
  startCloudflareLogin,
  syncCloudflareFromWrangler,
} from "../../lib/cloudflare/client.ts";
import { cloudflareAiBaseUrl, isValidCloudflareAccountId } from "../../lib/cloudflare/credentials.ts";
import {
  catalogModelsFromOpenAiCompatRows,
  normalizeCatalogModels,
  type OpenAiCompatModelRow,
} from "../../lib/modelCatalog.ts";
import { authActionRateLimit, heavyCommandRateLimit } from "../middleware/rateLimit.ts";

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

/** Spawn `lms server …`; resolves exit code if the child exits quickly, else null. */
function spawnLmsServerDetached(lms: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    try {
      const child = spawn(lms, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
      child.once("exit", (code) => finish(code));
      child.once("error", () => finish(1));
      child.unref();
      setTimeout(() => finish(null), 2000);
    } catch {
      finish(1);
    }
  });
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

/** Module-level LMS CLI path cache (avoids re-probing disk/PATH on every request). */
let cachedLmsCli: string | null | undefined;

function resetLmsCliCache(): void {
  cachedLmsCli = undefined;
}

function findLmsCli(): string | null {
  if (cachedLmsCli !== undefined) return cachedLmsCli;
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
  cachedLmsCli = null;
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

/** Windows/macOS tray app that owns the local server lifecycle (do not also spawn `ollama serve`). */
function findOllamaApp(): string | null {
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama app.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama app.exe"),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return null;
  }
  if (process.platform === "darwin") {
    return "/Applications/Ollama.app";
  }
  return null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryWingetInstall(packageIds: string[]): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("winget", ["--version"], { timeout: 5000, windowsHide: true });
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
          "--silent",
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

/**
 * Start Ollama without opening a console flood.
 * On Windows/macOS the tray app owns `serve`; spawning `ollama serve` beside it
 * fights the app (reap/respawn) and can flash endless terminal windows.
 */
function startOllamaOnce(cliPath: string): { mode: "app" | "serve"; detail: string } {
  if (process.platform === "win32") {
    const app = findOllamaApp();
    if (app) {
      const child = spawn(app, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
      return { mode: "app", detail: app };
    }
  }
  if (process.platform === "darwin") {
    const app = findOllamaApp();
    if (app && fs.existsSync(app)) {
      const child = spawn("open", ["-a", "Ollama"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
      return { mode: "app", detail: app };
    }
  }
  // Linux / headless fallback only
  const child = spawn(cliPath, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  return { mode: "serve", detail: `${cliPath} serve` };
}

type OllamaEnsureResult = { ok: boolean; error?: string; steps: string[] };

/** Single-flight: concurrent Setup / pull calls must not spawn multiple Ollama processes. */
let ollamaEnsureInFlight: Promise<OllamaEnsureResult> | null = null;
let lastOllamaStartAt = 0;
const OLLAMA_START_COOLDOWN_MS = 45_000;

async function ensureOllamaReady(
  onProgress?: (evt: { type: string; message: string; percent?: number }) => void,
): Promise<OllamaEnsureResult> {
  if (ollamaEnsureInFlight) return ollamaEnsureInFlight;
  ollamaEnsureInFlight = ensureOllamaReadyImpl(onProgress).finally(() => {
    ollamaEnsureInFlight = null;
  });
  return ollamaEnsureInFlight;
}

async function ensureOllamaReadyImpl(
  onProgress?: (evt: { type: string; message: string; percent?: number }) => void,
): Promise<OllamaEnsureResult> {
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
    note("Ollama CLI not found. Installing…", 5);
    if (process.platform === "win32") {
      note("Running winget install Ollama.Ollama (silent)…", 8);
      await tryWingetInstall(["Ollama.Ollama"]);
    } else if (process.platform === "darwin") {
      note("Running brew install ollama…", 8);
      try {
        await execFileAsync("brew", ["install", "ollama"], { timeout: 600_000 });
      } catch {
        note("brew install failed", 12);
      }
    }
    for (let i = 0; i < 20; i++) {
      ollama = findOllamaCli();
      if (ollama) break;
      await sleepMs(2000);
    }
    // Installer often auto-starts the tray app; give it a moment before we launch anything.
    for (let i = 0; i < 15; i++) {
      if (await isOllamaRunning()) {
        note("Ollama started after install", 28);
        return { ok: true, steps };
      }
      await sleepMs(1000);
    }
  }
  if (!ollama)
    return {
      ok: false,
      steps,
      error: "Could not install or find Ollama. Install from https://ollama.com, then retry.",
    };

  if (!(await isOllamaRunning())) {
    const now = Date.now();
    if (now - lastOllamaStartAt < OLLAMA_START_COOLDOWN_MS) {
      note("Waiting for a recent Ollama start attempt…", 22);
    } else {
      try {
        const started = startOllamaOnce(ollama);
        lastOllamaStartAt = now;
        note(
          started.mode === "app"
            ? `Launching Ollama app (${started.detail})…`
            : `Starting headless ollama serve (${started.detail})…`,
          22,
        );
      } catch (err: unknown) {
        note(`Failed to start Ollama: ${err instanceof Error ? err.message : String(err)}`, 22);
      }
    }
    for (let i = 0; i < 40; i++) {
      await sleepMs(1000);
      if (await isOllamaRunning()) {
        note("Ollama HTTP server ready on :11434", 30);
        return { ok: true, steps };
      }
    }
    return {
      ok: false,
      steps,
      error:
        process.platform === "win32" || process.platform === "darwin"
          ? "Ollama did not become ready. Open the Ollama app from the Start menu / Applications, wait until the tray icon appears, then retry."
          : "Ollama serve did not start. Run `ollama serve` manually, then retry.",
    };
  }
  return { ok: true, steps };
}

async function ensureLmsReady(
  onProgress?: (evt: { type: string; message: string; percent?: number }) => void,
): Promise<{ ok: boolean; error?: string; openedUrl?: string; steps: string[] }> {
  const steps: string[] = [];
  const note = (message: string, percent?: number) => {
    steps.push(message);
    onProgress?.({ type: "step", message, percent });
  };

  if (await isLmsServerRunning()) {
    note("LM Studio server already running", 15);
    return { ok: true, steps };
  }

  let lms = findLmsCli();
  if (!lms) {
    note("LM Studio CLI (lms) not found. Installing…", 5);
    if (process.platform === "win32") {
      note("Running winget install ElementLabs.LMStudio…", 8);
      await tryWingetInstall(["ElementLabs.LMStudio"]);
      note("Bootstrapping LM Studio CLI (install.ps1 / llmster)…", 12);
      try {
        await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://lmstudio.ai/install.ps1 | iex",
          ],
          { timeout: 600_000, windowsHide: true },
        );
      } catch {
        note("install.ps1 failed or skipped. Will keep looking for lms", 14);
      }
    } else if (process.platform === "darwin") {
      note("Running brew install --cask lm-studio…", 8);
      try {
        await execFileAsync("brew", ["install", "--cask", "lm-studio"], { timeout: 600_000 });
      } catch {
        note("brew cask install failed. Trying install.sh", 10);
      }
      try {
        await execFileAsync("bash", ["-lc", "curl -fsSL https://lmstudio.ai/install.sh | bash"], {
          timeout: 600_000,
        });
      } catch {
        note("install.sh failed or skipped", 14);
      }
    } else {
      note("Running LM Studio install.sh…", 8);
      try {
        await execFileAsync("bash", ["-lc", "curl -fsSL https://lmstudio.ai/install.sh | bash"], {
          timeout: 600_000,
        });
      } catch {
        note("install.sh failed or skipped", 14);
      }
    }

    for (let i = 0; i < 20; i++) {
      resetLmsCliCache();
      lms = findLmsCli();
      if (lms) break;
      await sleepMs(2000);
    }
  }

  if (!lms) {
    return {
      ok: false,
      steps,
      openedUrl: "https://lmstudio.ai",
      error:
        "Could not install or find the LM Studio CLI (lms). Install LM Studio from https://lmstudio.ai, open it once, then retry Setup.",
    };
  }

  note(`Found LM Studio CLI at ${lms}`, 35);

  if (!(await isLmsServerRunning())) {
    note("Starting LM Studio server (lms server start)…", 50);
    let exitCode = await spawnLmsServerDetached(lms, ["server", "start"]);
    if (exitCode !== null && exitCode !== 0) {
      note(`lms server start exited (${exitCode}); retrying lms server…`, 52);
      exitCode = await spawnLmsServerDetached(lms, ["server"]);
      if (exitCode !== null && exitCode !== 0) {
        note(`lms server exited (${exitCode})`, 54);
      }
    }

    for (let i = 0; i < 30; i++) {
      await sleepMs(1000);
      if (await isLmsServerRunning()) {
        note("LM Studio HTTP server ready", 90);
        return { ok: true, steps };
      }
    }
    return {
      ok: false,
      steps,
      openedUrl: "https://lmstudio.ai",
      error:
        "LM Studio CLI is installed but the local server did not start. Open LM Studio once (or run `lms server start`), then retry.",
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

/** Begin NDJSON stream for local model pull progress (client parses line-delimited JSON). */
function beginPullSse(res: import("express").Response) {
  return beginNdjsonStream(res);
}

function envCredentialsPayload() {
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfAuth = resolveCloudflareAuth();
  const cloudflareUsable =
    Boolean(cfAuth) ||
    (Boolean(readEnvApiKey("CLOUDFLARE_API_TOKEN")) && isValidCloudflareAccountId(cfAccount));
  return listEnvCredentialStatus({ cloudflare: cloudflareUsable });
}

// ─── Mount all AI routes ────────────────────────────────────────────────────

export function mountAiRoutes(router: Router): void {
  // ─── AI Provider ──────────────────────────────────────────────────────────

  router.get("/ai/provider", (_req, res) => {
    const envCredentials = envCredentialsPayload();
    const runtime = getRuntimeAiProvider();
    if (runtime) {
      return res.json({
        provider: runtime.provider,
        model: runtime.model,
        baseUrl: runtime.baseUrl ?? null,
        source: "runtime",
        envCredentials,
      });
    }

    const pref = readAiPreference();
    if (pref) {
      const restored = restoreProviderFromPreference(pref);
      if (restored) {
        return res.json({
          provider: restored.provider,
          model: restored.model,
          baseUrl: restored.baseUrl ?? null,
          source: "saved",
          envCredentials,
        });
      }
      // Still surface the last UI selection even if the env key is missing.
      let savedBaseUrl = pref.baseUrl ?? null;
      if (savedBaseUrl) {
        try {
          savedBaseUrl = sanitizeProviderBaseUrl(pref.provider, savedBaseUrl) ?? null;
        } catch {
          savedBaseUrl = null;
        }
      }
      return res.json({
        provider: pref.provider,
        model: pref.model,
        baseUrl: savedBaseUrl,
        source: "saved",
        envCredentials,
      });
    }

    const cfg = detectEnvProvider();
    if (!cfg) {
      return res.json({ provider: null, model: null, baseUrl: null, source: "none", envCredentials });
    }
    return res.json({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl ?? null,
      source: "env",
      envCredentials,
    });
  });

  router.post("/ai/provider", authActionRateLimit, (req, res) => {
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
    const plugin = getProvider(provider);
    const envKey = plugin ? readEnvApiKey(...plugin.envVarNames) : undefined;
    const resolvedKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : (envKey ?? "");
    const allowEmptyKey =
      provider === "openai-compat" ||
      provider === "codex" ||
      provider === "devin" ||
      provider === "cloudflare" ||
      Boolean(
        normalizedBaseUrl &&
        (() => {
          try {
            const hostname = new URL(normalizedBaseUrl).hostname.toLowerCase();
            return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
          } catch {
            return false;
          }
        })(),
      );
    if (!resolvedKey && !allowEmptyKey) {
      return res.status(400).json({
        error: `No API key provided and no env key found for ${provider}.`,
      });
    }
    let finalKey = resolvedKey;
    let finalBaseUrl = normalizedBaseUrl;
    if (provider === "cloudflare") {
      const auth = resolveCloudflareAuth();
      if (auth) {
        finalKey = finalKey || auth.apiToken;
        finalBaseUrl = finalBaseUrl || cloudflareAiBaseUrl(auth.accountId);
      }
      if (!finalKey || !finalBaseUrl) {
        return res.status(400).json({
          error:
            "Cloudflare is not signed in. Use Sign in + Sync credentials, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
        });
      }
    }
    setRuntimeAiProvider({
      provider,
      apiKey: finalKey,
      model: model || plugin?.defaultModel || "default",
      baseUrl: finalBaseUrl,
    });
    return res.json({ ok: true, provider, model: model || plugin?.defaultModel || "default" });
  });

  router.delete("/ai/provider", (_req, res) => {
    setRuntimeAiProvider(null);
    return res.json({ ok: true });
  });

  // ─── AI Models ───────────────────────────────────────────────────────────

  router.get("/ai/models", (_req, res) => {
    // Legacy static endpoint. Prefer POST /ai/models for live catalogs.
    return res.json({ models: [], source: "fallback" });
  });

  router.post("/ai/models", async (req, res) => {
    const { provider, apiKey, baseUrl } = req.body ?? {};
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    try {
      if (provider === "codex") {
        try {
          const server = getCodexAppServer();
          await server.start();
          const models = await server.listModels();
          if (models.length > 0) {
            return res.json({ models, source: "live" });
          }
          return res.json({
            models: [],
            source: "fallback",
            error: "Codex returned an empty model catalog. Sign in, then Refresh.",
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (provider === "devin") {
        try {
          const catalog = await listDevinModels();
          return res.json({
            models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
            source: catalog.source,
            ...(catalog.error ? { error: catalog.error } : {}),
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (provider === "cloudflare") {
        try {
          const catalog = await listCloudflareModels();
          return res.json({
            models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
            source: catalog.source,
            ...(catalog.error ? { error: catalog.error } : {}),
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const plugin = getProvider(provider);
      const runtime = getRuntimeAiProvider();
      const runtimeKey =
        runtime && runtime.provider === provider && runtime.apiKey?.trim()
          ? runtime.apiKey.trim()
          : undefined;
      const envKey = plugin ? readEnvApiKey(...plugin.envVarNames) : undefined;
      const key = apiKey?.trim() || runtimeKey || envKey || "";

      let safeBaseUrl: string | undefined;
      try {
        // Prefer explicit body, then runtime saved base for openai-compat / local.
        const candidate =
          baseUrl ||
          (runtime && runtime.provider === provider ? runtime.baseUrl : undefined) ||
          plugin?.defaultBaseUrl;
        safeBaseUrl = sanitizeProviderBaseUrl(provider, candidate);
      } catch (err: unknown) {
        return res.status(400).json({
          models: [],
          source: "fallback",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const allowEmptyKey =
        provider === "openai-compat" &&
        Boolean(
          safeBaseUrl &&
          (() => {
            try {
              const hostname = new URL(safeBaseUrl).hostname.toLowerCase();
              return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
            } catch {
              return false;
            }
          })(),
        );
      if (!key && !allowEmptyKey) {
        return res.json({
          models: [],
          source: "fallback",
          error: "No API key available. Enter a key or set the provider env var, then Refresh.",
        });
      }

      const modelCatalog = await fetchLiveModelCatalog(
        provider as ProviderConfig["provider"],
        key || "local",
        safeBaseUrl,
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
    const { message, chatHistory, workspaceContext, state } = req.body ?? {};
    if (!message || typeof message !== "string") return res.status(400).json({ error: "Missing message" });
    try {
      const scopeBlock = getChatScopeBlock(message);
      if (scopeBlock) {
        return res.json({
          reply: scopeBlock.reply,
          text: scopeBlock.reply,
          actions: [],
          mcp: { toolsUsed: [], sufficient: true, usedWebFallback: false },
        });
      }

      let workspace: AiWorkspaceContext | null = null;
      try {
        if (workspaceContext && typeof workspaceContext === "object") {
          workspace = workspaceContext as AiWorkspaceContext;
        } else if (state && typeof state === "object") {
          workspace = buildAiWorkspaceContext(state);
        }
      } catch {
        // Workspace context is optional; ignore malformed client payloads.
      }

      // Olive MCP is the primary knowledge source for assistant chat.
      const mcpKnowledge = await gatherOliveMcpKnowledge(message, workspace);
      const workspaceBlock = workspace ? formatAiWorkspaceContextForPrompt(workspace) : null;
      const system = buildOliveAssistantSystemPrompt({
        mcpBlock: mcpKnowledge.promptBlock,
        workspaceBlock,
        responseContract: CHAT_JSON_RESPONSE_CONTRACT,
      });

      const history = Array.isArray(chatHistory) ? chatHistory : [];
      const messages = history.concat([{ role: "user", content: message }]);
      const rawReply = await callAI(system, messages, true);
      const structured = parseChatStructuredReply(rawReply);
      // `reply` is canonical; `text` kept for older clients that read that field.
      return res.json({
        reply: structured.reply,
        text: structured.reply,
        actions: structured.actions,
        mcp: {
          toolsUsed: mcpKnowledge.toolsUsed,
          sufficient: mcpKnowledge.sufficient,
          usedWebFallback: mcpKnowledge.usedWebFallback,
        },
      });
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
      // Cap context so small models still have room for full-sentence JSON.
      const ctxSummary = formatAiWorkspaceContextForPrompt(ctx).slice(0, 3500);
      const system =
        "You analyze Olive optimization pipelines for ONNX Runtime / TensorRT / quantization. " +
        "Reply with ONE JSON object only (no markdown, no prose outside JSON). Schema: " +
        '{"score":0-100,"level":"Optimized"|"Suboptimal"|"Critical","summary":string,"suggestions":[{"title":string,"description":string,"impact":"High"|"Medium"|"Low","type":"warning"|"success"|"suggestion"|"info","autofix":{"pass":string,"value":string}}]}. ' +
        "Writing rules: summary must be 1-2 complete sentences. Each title must be a short readable phrase (not a bare field name like opset/dtype/cache). " +
        "Each description must be 1-2 complete sentences explaining why and what to change. Keep JSON valid with commas between elements. " +
        "Suggestion count (hard): Return 0 to 3 suggestions. Prefer fewer. Only include a suggestion if it is concrete, applyable, and would materially improve THIS workspace. " +
        "Never invent filler to reach 3. If the pipeline is already solid, return suggestions:[]. If only one real improvement exists, return exactly one. " +
        "Relevance rules (hard): Only suggest changes for the Model and execution provider in the workspace. " +
        "Never mention speech recognition / ASR / Whisper unless the model is an ASR model. " +
        "If execution provider is NvTensorRTRTXExecutionProvider, do NOT suggest TensorRTExecutionProvider, TensorRTPass, tensor_rt, TRT engine build/caching, or adding TensorRT after CUDA. That EP already is the consumer RTX path. " +
        "autofix.pass must be a UI field (e.g. quantMethod, quantPrecision, conversionInputTargetTypes, conversionOpset, ihvProvider), never a nested Olive JSON path like passes.conversion.config.input_model_dtype or systems.local_system.config.accelerators.";
      let reply = await callAI(system, [{ role: "user", content: ctxSummary }], true);
      let analysis = filterAuditAnalysis(parseAuditAnalysisReply(reply), ctx);
      // Retry once only when we got the soft unstructured fallback (empty suggestions + partial summary).
      const looksSoft =
        analysis.suggestions.length === 0 &&
        analysis.summary.startsWith("Partial audit (model returned unstructured text)");
      if (looksSoft) {
        reply = await callAI(
          `${system}\nRetry with valid JSON only. Example with ONE suggestion (0 is also fine; do not pad to 3): ` +
            '{"score":60,"level":"Suboptimal","summary":"The pipeline can better match TensorRT RTX with AWQ int4 quantization.",' +
            '"suggestions":[{"title":"Enable AWQ quantization","description":"Switch the quant method to AWQ so weights fit TensorRT RTX more efficiently.","impact":"High","type":"suggestion","autofix":{"pass":"quantMethod","value":"awq"}}]}',
          [{ role: "user", content: ctxSummary }],
          true,
        );
        analysis = filterAuditAnalysis(parseAuditAnalysisReply(reply), ctx);
      }
      return res.json(analysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
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

  router.post("/ai/local-pull", heavyCommandRateLimit, async (req, res) => {
    const { modelTag } = req.body ?? {};
    if (!modelTag) return res.status(400).json({ error: "Missing modelTag" });
    const send = beginPullSse(res);
    try {
      const ready = await ensureLmsReady((evt) => send(evt));
      if (!ready.ok) {
        send({
          type: "error",
          error: ready.error || "LM Studio is not ready",
          openedUrl: ready.openedUrl ?? "https://lmstudio.ai",
        });
        res.end();
        return;
      }
      const lmsCli = findLmsCli();
      if (!lmsCli) {
        send({
          type: "error",
          error: "LM Studio CLI (lms) not found. Install LM Studio from https://lmstudio.ai",
          openedUrl: "https://lmstudio.ai",
        });
        res.end();
        return;
      }
      send({ type: "step", message: `Downloading ${modelTag} via LM Studio (lms get)…`, percent: 5 });
      // LM Studio CLI downloads with `lms get`, not Ollama-style `pull`. `-y` skips prompts.
      const proc = spawn(lmsCli, ["get", String(modelTag), "-y"], { stdio: "pipe" });
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
        if (code === 0) {
          send({ type: "done", message: "Model downloaded successfully.", ok: true, percent: 100 });
        } else {
          send({
            type: "error",
            error: `LM Studio download exited with code ${code}`,
            hint: "Official CLI is `lms get <model> -y` (not `pull`). Open LM Studio once if get fails to resolve the model.",
          });
        }
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

  router.post("/ai/ollama-pull", heavyCommandRateLimit, async (req, res) => {
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
        send({ type: "step", message: "Ensuring LM Studio is installed…", percent: 0 });
        const result = await ensureLmsReady((evt) => send(evt));
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
      endNdjson(res, { type: "error", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── OpenAI Codex ────────────────────────────────────────────────────────

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

  // ─── Devin ───────────────────────────────────────────────────────────────

  router.get("/devin/account", (_req, res) => {
    return res.json(getDevinAccountStatus());
  });

  router.get("/devin/login", (_req, res) => {
    const url = getDevinSignInUrl();
    return res.json({ ok: true, authUrl: url });
  });

  router.post("/devin/login/complete", authActionRateLimit, async (req, res) => {
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
      const catalog = await listDevinModels();
      return res.json({ models: catalog.models, source: catalog.source, error: catalog.error });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Cloudflare Workers AI ───────────────────────────────────────────────

  router.get("/cloudflare/account", (_req, res) => {
    return res.json(getCloudflareAccountStatus());
  });

  router.post("/cloudflare/login", authActionRateLimit, async (_req, res) => {
    const result = await startCloudflareLogin();
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  });

  router.post("/cloudflare/sync", authActionRateLimit, async (req, res) => {
    try {
      const preferredAccountId =
        typeof req.body?.accountId === "string" ? req.body.accountId.trim() : undefined;
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
    try {
      const apiToken = typeof req.body?.apiToken === "string" ? req.body.apiToken.trim() : "";
      const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
      if (!apiToken || !accountId) {
        return res.status(400).json({ ok: false, error: "apiToken and accountId are required." });
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

/** Fetch live model catalog from a provider's API. `baseUrl` must already be sanitized. */
async function fetchLiveModelCatalog(provider: string, apiKey: string, baseUrl?: string) {
  try {
    if (provider === "gemini") {
      return await fetchGeminiModelCatalog(apiKey);
    }
    if (provider === "anthropic") {
      return await fetchAnthropicModelCatalog(apiKey);
    }
    if (provider === "copilot") {
      return await fetchCopilotModelCatalog(apiKey, baseUrl);
    }

    const base = stripTrailingSlashes(baseUrl || defaultBaseUrl(provider));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/tonythethompson/Olive-Studio";
      headers["X-Title"] = "Olive Studio";
    }

    const rows: OpenAiCompatModelRow[] = [];
    let nextUrl: string | null = new URL("models", base.endsWith("/") ? base : `${base}/`).toString();
    let pages = 0;
    while (nextUrl && pages < 10) {
      pages += 1;
      const r = await fetch(nextUrl, { headers });
      if (!r.ok) {
        if (pages === 1) {
          return { models: [], source: "fallback" as const, error: `HTTP ${r.status}` };
        }
        break;
      }
      const data = (await r.json()) as {
        data?: OpenAiCompatModelRow[];
        has_more?: boolean;
        next?: string | null;
      };
      rows.push(...(data.data ?? []));
      if (data.has_more && typeof data.next === "string" && data.next.trim()) {
        nextUrl = data.next.startsWith("http") ? data.next : new URL(data.next, `${base}/`).toString();
      } else {
        nextUrl = null;
      }
    }

    const models = catalogModelsFromOpenAiCompatRows(rows);
    return {
      models,
      source: models.length > 0 ? ("live" as const) : ("fallback" as const),
      ...(models.length === 0 ? { error: "Provider returned no chat-capable models." } : {}),
    };
  } catch (err: unknown) {
    return {
      models: [],
      source: "fallback" as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchGeminiModelCatalog(apiKey: string) {
  const models: Array<{ id: string; label: string }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (!r.ok) {
      if (page === 0) {
        return { models: [], source: "fallback" as const, error: `Gemini HTTP ${r.status}` };
      }
      break;
    }
    const data = (await r.json()) as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      const raw = (m.name || "").replace(/^models\//, "").trim();
      if (!raw) continue;
      models.push({ id: raw, label: m.displayName || raw });
    }
    pageToken = data.nextPageToken?.trim() || undefined;
    if (!pageToken) break;
  }
  const normalized = normalizeCatalogModels(models);
  return {
    models: normalized,
    source: normalized.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(normalized.length === 0 ? { error: "No Gemini generateContent models returned." } : {}),
  };
}

async function fetchAnthropicModelCatalog(apiKey: string) {
  const models: Array<{ id: string; label: string }> = [];
  let afterId: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);
    const r = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!r.ok) {
      if (page === 0) {
        return { models: [], source: "fallback" as const, error: `Anthropic HTTP ${r.status}` };
      }
      break;
    }
    const data = (await r.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const m of data.data ?? []) {
      const id = (m.id || "").trim();
      if (!id) continue;
      models.push({ id, label: m.display_name || id });
    }
    if (!data.has_more || !data.last_id) break;
    afterId = data.last_id;
  }
  const normalized = normalizeCatalogModels(models);
  return {
    models: normalized,
    source: normalized.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(normalized.length === 0 ? { error: "No Anthropic models returned." } : {}),
  };
}

async function fetchCopilotModelCatalog(apiKey: string, baseUrl?: string) {
  const sanitized = sanitizeProviderBaseUrl("copilot", baseUrl);
  const base = stripTrailingSlashes(sanitized || "https://api.githubcopilot.com");
  const modelsUrl = base.endsWith("/models") ? base : `${base}/models`;
  const r = await fetch(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.98.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-GitHub-Api-Version": "2025-10-01",
    },
  });
  if (!r.ok) return { models: [], source: "fallback" as const, error: `Copilot HTTP ${r.status}` };
  const data = (await r.json()) as {
    data?: Array<{ id?: string; name?: string; model_picker_enabled?: boolean }>;
  };
  const models = normalizeCatalogModels(
    (data.data ?? [])
      .filter((m) => m.model_picker_enabled !== false)
      .map((m) => {
        const id = m.id || m.name || "";
        return { id, label: m.name || id };
      }),
  );
  return {
    models,
    source: models.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(models.length === 0 ? { error: "No Copilot models returned for this token." } : {}),
  };
}

function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case "openai":
    case "chatgpt-sub":
      return "https://api.openai.com/v1";
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
    case "opencode":
      return "https://opencode.ai/zen/v1";
    case "opencode-go":
      return "https://opencode.ai/zen/go/v1";
    case "fireworks":
      return "https://api.fireworks.ai/inference/v1";
    case "nvidia":
      return "https://integrate.api.nvidia.com/v1";
    case "huggingface":
      return "https://router.huggingface.co/v1";
    case "copilot":
      return "https://api.githubcopilot.com";
    default:
      return "https://api.openai.com/v1";
  }
}

export function registerAiRoutes(app: import("express").Express): void {
  const router = Router();
  mountAiRoutes(router);
  app.use("/api", router);
}
