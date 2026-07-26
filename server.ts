import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";

import { validateOliveRecipeStructure } from "./src/lib/oliveRecipeSchema.ts";
import { parseJsonFromAiResponse, readEnvApiKey } from "./src/lib/aiResponse.ts";
import { buildAiWorkspaceContext, formatAiWorkspaceContextForPrompt } from "./src/lib/aiWorkspaceContext.ts";
import {
  mergeDetectedProviders,
  pickRecommendedProvider,
  type HardwareProbeResult,
} from "./src/lib/hardwareProbe.ts";
import { enrichRecipeMemoryOffloadForRun, recipeUsesMemoryOffload } from "./src/lib/memoryOffload.ts";
import { getSelectedGpuVramGb } from "./src/lib/vramEstimate.ts";
import {
  CUDA12_RUNTIME_PACKAGES,
  isGpuExecutionProvider,
  pinnedOrtGpuInstallArgs,
  pinnedOrtGpuLabel,
} from "./src/lib/oliveGpuRuntime.ts";
import {
  envWithPrependedPaths,
  isCompatibleTensorRtVersion,
  pinnedTensorRtInstallArgs,
  pinnedTensorRtLabel,
  PINNED_TENSORRT_VERSION,
} from "./src/lib/tensorrtDeps.ts";
import { tensorrtRtxInstallArgs, tensorrtRtxLabel } from "./src/lib/tensorrtRtxDeps.ts";
import type { IHVProvider } from "./src/types.ts";
import type { GpuMetrics } from "./src/lib/gpuMetrics.ts";
import { reloadPassSchemas, type PassesJson } from "./src/lib/schemaEngine.ts";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const VENV_DIR = path.join(process.cwd(), ".venv");
const OLIVE_GPU_LAUNCHER = path.join(process.cwd(), "scripts", "olive_gpu_launcher.py");
const execFileAsync = promisify(execFile);

// ─── KB Status Cache & Sync Protection ───────────────────────────────────────
interface KbStatusCache {
  available: boolean;
  version?: string;
  lastUpdated?: string | null;
  lastSync?: string | null;
  passCount?: number;
  error?: string;
}

let kbStatusCache: KbStatusCache | null = null;
let kbSyncInProgress = false;

const kbStatusRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { available: false, error: "Too many KB status requests. Please wait." },
});

const kbSyncRateLimit = rateLimit({
  windowMs: 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Rate limited: please wait before syncing again." },
});

// ─── AI Provider Config ───────────────────────────────────────────────────────

interface ProviderConfig {
  provider:
    | "gemini"
    | "openai"
    | "anthropic"
    | "mistral"
    | "openai-compat"
    | "xai"
    | "openrouter"
    | "groq"
    | "together"
    | "chatgpt-sub"
    | "copilot"
    | "devin"
    | "kilocode";
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── AI Provider Response Types ───────────────────────────────────────────────

interface GeminiRequestBody {
  system_instruction: { parts: [{ text: string }] };
  contents: Array<{ role: string; parts: [{ text: string }] }>;
  generationConfig?: { responseMimeType: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

interface OpenAIChatRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string };
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}

interface ApiErrorResponse {
  error?: { message?: string };
}

// ─── Olive Recipe Types ───────────────────────────────────────────────────────

interface OliveRecipe {
  passes?: Record<string, unknown>;
  input_model?: {
    type?: string;
    config?: Record<string, unknown>;
  };
  systems?: {
    local_system?: {
      config?: {
        accelerators?: Array<{ execution_providers?: string[] }>;
      };
      accelerators?: Array<{ execution_providers?: string[] }>;
    };
  };
  [key: string]: unknown;
}

// ─── MCP Tool Response Type ───────────────────────────────────────────────────

interface McpToolResponse {
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

interface IncomingChatMessage {
  role?: string;
  content?: string;
}

const ALLOWED_AI_PROVIDERS = new Set<ProviderConfig["provider"]>([
  "gemini",
  "openai",
  "anthropic",
  "mistral",
  "openai-compat",
  "xai",
  "openrouter",
  "groq",
  "together",
  "chatgpt-sub",
  "copilot",
  "devin",
  "kilocode",
]);

function detectEnvProvider(): ProviderConfig | null {
  const geminiKey = readEnvApiKey("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY");
  if (geminiKey) {
    return { provider: "gemini", apiKey: geminiKey, model: "gemini-2.5-flash" };
  }
  const openaiKey = readEnvApiKey("OPENAI_API_KEY");
  if (openaiKey) {
    return { provider: "openai", apiKey: openaiKey, model: "gpt-4o-mini" };
  }
  const anthropicKey = readEnvApiKey("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    return { provider: "anthropic", apiKey: anthropicKey, model: "claude-haiku-4-5-20251001" };
  }
  const mistralKey = readEnvApiKey("MISTRAL_API_KEY");
  if (mistralKey) {
    return { provider: "mistral", apiKey: mistralKey, model: "mistral-large-latest" };
  }
  const xaiKey = readEnvApiKey("XAI_API_KEY");
  if (xaiKey) {
    return { provider: "xai", apiKey: xaiKey, model: "grok-3", baseUrl: "https://api.x.ai/v1" };
  }
  const openrouterKey = readEnvApiKey("OPENROUTER_API_KEY");
  if (openrouterKey) {
    return {
      provider: "openrouter",
      apiKey: openrouterKey,
      model: "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
    };
  }
  const groqKey = readEnvApiKey("GROQ_API_KEY");
  if (groqKey) {
    return {
      provider: "groq",
      apiKey: groqKey,
      model: "llama-4-scout-17b-16e-instruct",
      baseUrl: "https://api.groq.com/openai/v1",
    };
  }
  const togetherKey = readEnvApiKey("TOGETHER_API_KEY");
  if (togetherKey) {
    return {
      provider: "together",
      apiKey: togetherKey,
      model: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      baseUrl: "https://api.together.xyz/v1",
    };
  }
  return null;
}

let runtimeAiProvider: ProviderConfig | null = null;

function getAiProvider(): ProviderConfig | null {
  return runtimeAiProvider ?? detectEnvProvider();
}

async function callGemini(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const body: GeminiRequestBody = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (wantJson) body.generationConfig = { responseMimeType: "application/json" };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`Gemini ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

async function callOpenAICompat(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const base =
    cfg.baseUrl ?? (cfg.provider === "mistral" ? "https://api.mistral.ai/v1" : "https://api.openai.com/v1");
  const body: OpenAIChatRequestBody = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  if (wantJson) body.response_format = { type: "json_object" };
  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`${cfg.provider} ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as OpenAIChatResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no text outside the JSON object.`
    : system;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system: sysText,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`Anthropic ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as AnthropicResponse;
  return data.content?.[0]?.text ?? "";
}

/**
 * Sends a conversation to the configured AI provider.
 *
 * @param system - System instructions for the conversation
 * @param messages - Conversation messages to send
 * @param wantJson - Whether to request a JSON-formatted response
 * @returns The provider's response text
 */
async function callAI(system: string, messages: AIChatMessage[], wantJson = false): Promise<string> {
  const cfg = getAiProvider();
  if (!cfg)
    throw new Error(
      "No AI provider configured. Add an API key in the AI Copilot settings or set GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / MISTRAL_API_KEY in your environment.",
    );
  switch (cfg.provider) {
    case "gemini":
      return callGemini(cfg, system, messages, wantJson);
    case "anthropic":
      return callAnthropic(cfg, system, messages, wantJson);
    case "openai":
    case "mistral":
    case "openai-compat":
    case "xai":
    case "openrouter":
    case "groq":
    case "together":
    case "chatgpt-sub":
    case "copilot":
    case "devin":
    case "kilocode":
      return callOpenAICompat(cfg, system, messages, wantJson);
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}

// ─── Olive Job Registry ───────────────────────────────────────────────────────

interface OliveJob {
  id: string;
  status: "setting_up" | "running" | "completed" | "failed" | "cancelled";
  exitCode: number | null;
  logs: string[];
  // SSE subscriber queues: each subscriber is a function that receives new log lines
  subscribers: Array<(line: string) => void>;
  // SSE metric subscribers: receive GPU metric snapshots
  metricSubscribers: Array<(metrics: GpuMetrics) => void>;
  process: ReturnType<typeof spawn> | null;
  // Latest GPU metrics snapshot (for replay to late SSE subscribers)
  latestMetrics: GpuMetrics | null;
  // Interval handle for periodic GPU sampling
  metricsTimer: ReturnType<typeof setInterval> | null;
  // True while a nvidia-smi sample is in-flight (prevents overlap)
  sampling: boolean;
}

const jobRegistry = new Map<string, OliveJob>();

// In-memory only — never written to disk or logged
let runtimeHfToken: string | null = null;

/**
 * Records a job log line and notifies its active subscribers.
 *
 * @param job - The job whose log and subscribers should be updated
 * @param line - The log line to record and broadcast
 */
function pushLog(job: OliveJob, line: string) {
  job.logs.push(line);
  for (const sub of job.subscribers) {
    try {
      sub(line);
    } catch {
      /* subscriber gone */
    }
  }
}

/**
 * Stores the latest GPU metrics and broadcasts them to subscribed listeners.
 *
 * @param job - The Olive job associated with the metrics
 * @param metrics - The GPU metrics snapshot to store and broadcast
 */
function pushGpuMetrics(job: OliveJob, metrics: GpuMetrics) {
  job.latestMetrics = metrics;
  for (const sub of job.metricSubscribers) {
    try {
      sub(metrics);
    } catch {
      /* subscriber gone */
    }
  }
}

/**
 * Collects current metrics for available NVIDIA GPUs.
 *
 * @returns A timestamped GPU metrics snapshot, or `null` when metrics cannot be collected.
 */
async function sampleGpuMetrics(): Promise<GpuMetrics | null> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 10_000 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const gpus = lines.map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      const parseNum = (v: string | undefined): number | null => {
        if (!v || v === "[N/A]") return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      return {
        index: parseInt(parts[0] ?? "0", 10),
        name: parts[1] ?? "Unknown GPU",
        utilizationPct: parseNum(parts[2]),
        memUsedMb: parseNum(parts[3]),
        memTotalMb: parseNum(parts[4]),
        tempC: parseNum(parts[5]),
        powerW: parseNum(parts[6]),
      };
    });
    return { timestamp: new Date().toISOString(), gpus };
  } catch {
    return null;
  }
}

/** Start periodic GPU metrics sampling for a job. */
function startGpuMetricsTimer(job: OliveJob): void {
  if (job.metricsTimer) return;
  const sample = async () => {
    if (job.status !== "running") {
      stopGpuMetricsTimer(job);
      return;
    }
    if (job.sampling) return;
    job.sampling = true;
    try {
      const metrics = await sampleGpuMetrics();
      if (metrics) pushGpuMetrics(job, metrics);
    } finally {
      job.sampling = false;
    }
  };
  // Sample immediately, then every 3 seconds
  void sample();
  job.metricsTimer = setInterval(() => void sample(), 3000);
}

/** Stop GPU metrics sampling for a job. */
function stopGpuMetricsTimer(job: OliveJob): void {
  if (job.metricsTimer) {
    clearInterval(job.metricsTimer);
    job.metricsTimer = null;
  }
}

// ─── Python / venv Helpers ────────────────────────────────────────────────────

/** Returns the path to python inside the venv, or null if not resolvable */
function getVenvPython(): string {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
}

function getVenvPip(): string {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "pip.exe")
    : path.join(VENV_DIR, "bin", "pip");
}

/** Check whether python/python3 is available on PATH */
async function findSystemPython(): Promise<string | null> {
  for (const cmd of ["python", "python3"]) {
    try {
      await execFileAsync(cmd, ["--version"]);
      return cmd;
    } catch {
      /* not found */
    }
  }
  return null;
}

/**
 * Ensures the .venv exists and olive-ai is installed.
 * Streams progress lines through the provided callback.
 */
async function ensureVenv(onLine: (line: string) => void): Promise<{ ok: boolean; error?: string }> {
  const systemPython = await findSystemPython();
  if (!systemPython) {
    return {
      ok: false,
      error: "Python not found on PATH. Install Python 3.9+ to use Olive execution.",
    };
  }

  // Create venv if missing
  if (!fs.existsSync(VENV_DIR)) {
    onLine("[setup] Creating Python virtual environment (.venv)...");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(systemPython, ["-m", "venv", VENV_DIR], { stdio: "pipe" });
      proc.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      proc.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`venv creation failed (exit ${code})`)),
      );
    });
    onLine("[setup] Virtual environment created.");
  }

  // Check if olive is installed
  const venvPython = getVenvPython();
  let oliveInstalled = false;
  try {
    await execFileAsync(venvPython, ["-c", "import olive"]);
    oliveInstalled = true;
  } catch {
    /* not installed */
  }

  if (!oliveInstalled) {
    onLine("[setup] Installing olive-ai (this may take a few minutes)...");
    await new Promise<void>((resolve, reject) => {
      const pip = spawn(getVenvPip(), ["install", "olive-ai"], { stdio: "pipe" });
      pip.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`pip install failed (exit ${code})`)),
      );
    });
    onLine("[setup] olive-ai installed successfully.");
  }

  // Olive CLI imports requests at startup; ensure it is present in older/partial installs.
  try {
    await execFileAsync(venvPython, ["-c", "import requests"]);
  } catch {
    onLine("[setup] Installing requests (Olive CLI dependency)...");
    await new Promise<void>((resolve, reject) => {
      const pip = spawn(getVenvPip(), ["install", "requests"], { stdio: "pipe" });
      pip.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`requests install failed (exit ${code})`)),
      );
    });
  }

  return { ok: true };
}

// ─── GitHub recipe proxy (avoids browser CORS on raw.githubusercontent.com) ───

function parseGitHubRepoQuery(owner?: string, repo?: string, repoSlug?: string) {
  if (owner && repo) {
    return { owner: owner.trim(), repo: repo.trim() };
  }

  if (!repoSlug) {
    return null;
  }

  const clean = repoSlug
    .trim()
    .replace(/^https:\/\/github.com\//, "")
    .replace(/^https:\/\/raw.githubusercontent.com\//, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");

  const [parsedOwner, parsedRepo] = clean.split("/");
  if (!parsedOwner || !parsedRepo) {
    return null;
  }

  return { owner: parsedOwner, repo: parsedRepo };
}

app.get("/api/github/raw", async (req, res) => {
  const owner = String(req.query.owner || "");
  const repo = String(req.query.repo || "");
  const repoSlug = String(req.query.repoSlug || req.query.repoUrl || "");
  const branch = String(req.query.branch || "main");
  const filePath = String(req.query.path || "").replace(/^\/+/, "");

  const parsed = parseGitHubRepoQuery(owner, repo, repoSlug);
  if (!parsed || !filePath) {
    return res.status(400).json({ error: "Missing owner/repo and recipe path." });
  }

  const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${filePath}`;

  try {
    const upstream = await fetch(rawUrl, {
      headers: { "User-Agent": "olive-studio" },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Remote file not found at ${parsed.owner}/${parsed.repo}/${branch}/${filePath} (HTTP ${upstream.status}).`,
      });
    }

    const text = await upstream.text();
    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.status(415).json({
        error: "Remote file is not valid JSON.",
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("GitHub raw proxy error:", error);
    return res.status(502).json({
      error: msg || "Failed to fetch recipe from GitHub.",
    });
  }
});

// ─── Recipe Dependency Inference ──────────────────────────────────────────────

interface PkgDef {
  importName: string;
  installArgs: string[];
  label: string;
}

function inferRequiredPackages(recipe: OliveRecipe, cudaTag: string): PkgDef[] {
  const pkgs: PkgDef[] = [];
  const passes = Object.values(recipe.passes ?? {}) as Array<Record<string, unknown>>;
  const passTypes = passes.map((p) => String(p?.type ?? ""));
  const isGpu = cudaTag !== "cpu";
  const inputType = String(recipe.input_model?.type ?? "");
  const inputConfig = (recipe.input_model?.config ?? {}) as Record<string, unknown>;

  // HuggingFace model source
  if (inputConfig.hf_config || inputType === "HfModel" || inputType.toLowerCase().includes("hf")) {
    pkgs.push({ importName: "transformers", installArgs: ["transformers"], label: "transformers" });
    pkgs.push({ importName: "accelerate", installArgs: ["accelerate"], label: "accelerate" });
  }

  if (recipeUsesMemoryOffload(recipe)) {
    pkgs.push({ importName: "accelerate", installArgs: ["accelerate"], label: "accelerate" });
  }

  // PyTorch — CPU wheel or CUDA-specific wheel
  pkgs.push(
    isGpu
      ? {
          importName: "torch",
          installArgs: ["torch", "--index-url", `https://download.pytorch.org/whl/${cudaTag}`],
          label: `torch (${cudaTag})`,
        }
      : {
          importName: "torch",
          installArgs: ["torch", "--index-url", "https://download.pytorch.org/whl/cpu"],
          label: "torch (CPU)",
        },
  );

  // ONNX Runtime — pin CUDA 12 build (1.27+ needs cu13 wheels not yet on PyPI)
  if (passTypes.some((t) => t.includes("Onnx") || t.includes("ORT") || t.includes("Transformers"))) {
    pkgs.push(
      isGpu
        ? { importName: "onnxruntime", installArgs: pinnedOrtGpuInstallArgs(), label: pinnedOrtGpuLabel() }
        : { importName: "onnxruntime", installArgs: ["onnxruntime"], label: "onnxruntime" },
    );
  }

  if (isGpu) {
    for (const pkg of CUDA12_RUNTIME_PACKAGES) {
      pkgs.push(pkg);
    }
  }

  // OpenVINO
  if (passTypes.some((t) => t.includes("OpenVINO"))) {
    pkgs.push({ importName: "openvino", installArgs: ["openvino"], label: "openvino" });
    pkgs.push({ importName: "optimum", installArgs: ["optimum[openvino]"], label: "optimum[openvino]" });
  }

  // PEFT (LoRA / QLoRA)
  if (passTypes.some((t) => t === "LoRA" || t === "QLoRA")) {
    pkgs.push({ importName: "peft", installArgs: ["peft"], label: "peft" });
  }

  // AutoAWQ
  if (passTypes.some((t) => t.toLowerCase().includes("awq"))) {
    pkgs.push({ importName: "awq", installArgs: ["autoawq"], label: "autoawq" });
  }

  // TensorRT RTX (consumer GeForce) — Olive v0.9.1+ / NvTensorRTRTXExecutionProvider
  if (isGpu && getRecipeIhvProvider(recipe) === "NvTensorRTRTXExecutionProvider") {
    pkgs.push({
      importName: "tensorrt_rtx",
      installArgs: tensorrtRtxInstallArgs(),
      label: tensorrtRtxLabel(),
    });
  }

  // Classic TensorRT SDK (nvinfer_10) — pinned to match stable onnxruntime-gpu CUDA 12 builds
  if (isGpu && getRecipeIhvProvider(recipe) === "TensorrtExecutionProvider") {
    pkgs.push({
      importName: "tensorrt",
      installArgs: pinnedTensorRtInstallArgs(),
      label: pinnedTensorRtLabel(),
    });
  }

  // Deduplicate by importName
  const seen = new Set<string>();
  return pkgs.filter((p) => (seen.has(p.importName) ? false : (seen.add(p.importName), true)));
}

function getRecipeIhvProvider(recipe: OliveRecipe): IHVProvider {
  const system = recipe.systems?.local_system;
  const accelerators = system?.config?.accelerators ?? system?.accelerators;
  const ep = accelerators?.[0]?.execution_providers?.[0];
  if (typeof ep === "string" && ep.length > 0) {
    return ep as IHVProvider;
  }
  return "CUDAExecutionProvider";
}

function oliveSpawnArgs(configPath: string, listPackages: boolean): string[] {
  return listPackages
    ? ["run", "--config", configPath, "--list_required_packages"]
    : ["run", "--config", configPath];
}

function resolveOliveCommand(
  provider: IHVProvider,
  configPath: string,
  listPackages: boolean,
): {
  executable: string;
  args: string[];
} {
  const venvPython = getVenvPython();
  const oliveArgs = oliveSpawnArgs(configPath, listPackages);
  if (isGpuExecutionProvider(provider) && fs.existsSync(OLIVE_GPU_LAUNCHER)) {
    return { executable: venvPython, args: [OLIVE_GPU_LAUNCHER, ...oliveArgs] };
  }
  return { executable: venvPython, args: ["-m", "olive", ...oliveArgs] };
}

async function buildOliveRunEnvironment(
  python: string,
  provider: IHVProvider,
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (!isGpuExecutionProvider(provider)) {
    return base;
  }
  const libPaths = await getNativeGpuLibPaths(python);
  return envWithPrependedPaths(base, libPaths);
}

/** Olive RunConfig parse + package scan without starting optimization. */
async function runOliveConfigPreflight(
  configPath: string,
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  provider: IHVProvider = "CUDAExecutionProvider",
): Promise<{ ok: boolean; error?: string }> {
  const { executable, args } = resolveOliveCommand(provider, configPath, true);

  return new Promise((resolve) => {
    const proc = spawn(executable, args, { stdio: "pipe", env });

    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => {
      data
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLine(`[preflight] ${line}`));
    });
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLine(`[preflight] ${line}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        onLine("[preflight] Olive RunConfig accepted (schema parse + package scan OK).");
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        error: stderr.trim() || `Olive preflight exited with code ${code ?? "unknown"}`,
      });
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to start Olive preflight: ${err.message}` });
    });
  });
}

async function getInstalledTensorRtVersion(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, ["-c", "import tensorrt; print(tensorrt.__version__)"]);
    const version = stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

async function getTensorRtLibsDir(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import os, tensorrt_libs; print(os.path.dirname(tensorrt_libs.__file__))",
    ]);
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

async function getNativeGpuLibPaths(python: string): Promise<string[]> {
  const script = `
import os
from pathlib import Path
dirs = []
try:
    import tensorrt_libs
    dirs.append(os.path.dirname(tensorrt_libs.__file__))
except Exception:
    pass
try:
    import tensorrt_rtx_libs
    dirs.append(os.path.dirname(tensorrt_rtx_libs.__file__))
except Exception:
    pass
try:
    import onnxruntime as ort
    from pathlib import Path
    dirs.append(str(Path(ort.__file__).resolve().parent / "capi"))
except Exception:
    pass
site = Path(__import__("site").getsitepackages()[0])
nvidia = site / "nvidia"
if nvidia.is_dir():
    for child in nvidia.iterdir():
        bin_dir = child / "bin"
        if bin_dir.is_dir():
            dirs.append(str(bin_dir))
print(os.pathsep.join(dirs))
`.trim();
  try {
    const { stdout } = await execFileAsync(python, ["-c", script]);
    return stdout
      .trim()
      .split(process.platform === "win32" ? ";" : ":")
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0 && fs.existsSync(dir));
  } catch {
    const trtLibs = await getTensorRtLibsDir(python);
    return trtLibs ? [trtLibs] : [];
  }
}

async function probeTensorRtLoadable(
  python: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ loadable: boolean; detail?: string }> {
  const libPaths = await getNativeGpuLibPaths(python);
  const probeEnv = envWithPrependedPaths(env, libPaths);
  const script = `
import ctypes
import os
import sys

def fail(msg):
    print("fail:" + msg)
    sys.exit(1)

try:
    import tensorrt
    ver = tensorrt.__version__
    if not ver.startswith("10."):
        fail("TensorRT " + ver + " installed; stable onnxruntime-gpu needs TensorRT 10.x (nvinfer_10)")
    import tensorrt_libs
    libs = os.path.dirname(tensorrt_libs.__file__)
    os.environ["PATH"] = libs + os.pathsep + os.environ.get("PATH", "")
    if sys.platform == "win32":
        ctypes.CDLL(os.path.join(libs, "nvinfer_10.dll"))
    else:
        ctypes.CDLL(os.path.join(libs, "libnvinfer.so.10"))
    import onnxruntime as ort
    if "TensorrtExecutionProvider" not in ort.get_available_providers():
        fail("TensorrtExecutionProvider missing from onnxruntime")
    print("ok")
except Exception as exc:
    fail(str(exc).replace(chr(10), " ")[:500])
`.trim();

  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", script], { env: probeEnv });
    const out = `${stdout}\n${stderr}`.trim();
    if (out.includes("ok")) {
      return { loadable: true };
    }
    const detail = out.replace(/^fail:/, "").trim() || "TensorRT provider library failed to load";
    return { loadable: false, detail };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes("fail:") ? message.split("fail:").pop()?.trim() : message;
    return { loadable: false, detail: detail || "TensorRT provider library failed to load" };
  }
}

async function ensureTensorRt(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  const probe = await probeTensorRtLoadable(venvPython);
  if (probe.loadable) {
    onLine("[deps] TensorRT execution provider load verified ✓");
    return { ok: true, libsDir: (await getNativeGpuLibPaths(venvPython)).join(path.delimiter) || null };
  }

  const installed = await getInstalledTensorRtVersion(venvPython);
  if (installed && !isCompatibleTensorRtVersion(installed)) {
    onLine(
      `[deps] TensorRT ${installed} is incompatible with stable onnxruntime-gpu (needs ${PINNED_TENSORRT_VERSION} / nvinfer_10) — reinstalling...`,
    );
  } else if (!installed) {
    onLine(
      `[deps] Installing ${pinnedTensorRtLabel()} for TensorRT EP (large download, may take several minutes)...`,
    );
  } else {
    onLine(`[deps] TensorRT ${installed} present but EP not loadable — reinstalling pinned runtime...`);
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...pinnedTensorRtInstallArgs()], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`pip install ${pinnedTensorRtLabel()} failed (exit ${code})`)),
    );
  });
  onLine(`[deps] ${pinnedTensorRtLabel()} installed ✓`);

  const retry = await probeTensorRtLoadable(venvPython);
  if (retry.loadable) {
    onLine("[deps] TensorRT execution provider load verified after install ✓");
    return { ok: true, libsDir: (await getNativeGpuLibPaths(venvPython)).join(path.delimiter) || null };
  }

  return {
    ok: false,
    error: retry.detail ?? "TensorRT SDK not loadable after install (nvinfer_10.dll missing)",
  };
}

async function getInstalledTensorRtRtxVersion(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import tensorrt_rtx; print(tensorrt_rtx.__version__)",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getTensorRtRtxLibsDir(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import os, tensorrt_rtx_libs; print(os.path.dirname(tensorrt_rtx_libs.__file__))",
    ]);
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

async function probeTensorRtRtxLoadable(
  python: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ loadable: boolean; detail?: string; version?: string }> {
  const libsDir = await getTensorRtRtxLibsDir(python);
  const probeEnv = envWithPrependedPaths(env, libsDir ? [libsDir] : []);
  const script = `
import ctypes
import glob
import os
import sys

def fail(msg):
    print("fail:" + msg)
    sys.exit(1)

try:
    import tensorrt_rtx
    ver = tensorrt_rtx.__version__
    import tensorrt_rtx_libs
    libs = os.path.dirname(tensorrt_rtx_libs.__file__)
    os.environ["PATH"] = libs + os.pathsep + os.environ.get("PATH", "")
    runtime_dlls = glob.glob(os.path.join(libs, "tensorrt_rtx_*.dll"))
    if sys.platform != "win32":
        runtime_dlls = glob.glob(os.path.join(libs, "libtensorrt_rtx.so*"))
    if not runtime_dlls:
        fail("tensorrt_rtx runtime library missing in tensorrt_rtx_libs")
    ctypes.CDLL(runtime_dlls[0])
    import onnxruntime as ort
    if not ort.get_available_providers():
        fail("onnxruntime has no execution providers")
    print("ok:" + ver)
except Exception as exc:
    fail(str(exc).replace(chr(10), " ")[:500])
`.trim();

  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", script], { env: probeEnv });
    const out = `${stdout}\n${stderr}`.trim();
    if (out.includes("ok:")) {
      const version = out.split("ok:").pop()?.trim();
      return { loadable: true, version: version || undefined };
    }
    const detail = out.replace(/^fail:/, "").trim() || "TensorRT RTX runtime failed to load";
    return { loadable: false, detail };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes("fail:") ? message.split("fail:").pop()?.trim() : message;
    return { loadable: false, detail: detail || "TensorRT RTX runtime failed to load" };
  }
}

async function ensureTensorRtRtx(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  const probe = await probeTensorRtRtxLoadable(venvPython);
  if (probe.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified (${probe.version ?? "installed"}) ✓`);
    return { ok: true, libsDir: await getTensorRtRtxLibsDir(venvPython) };
  }

  const installed = await getInstalledTensorRtRtxVersion(venvPython);
  if (!installed) {
    onLine(`[deps] Installing ${tensorrtRtxLabel()} for TensorRT RTX EP (may take a few minutes)...`);
  } else {
    onLine(`[deps] ${tensorrtRtxLabel()} present but runtime not loadable — reinstalling...`);
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...tensorrtRtxInstallArgs()], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`pip install ${tensorrtRtxLabel()} failed (exit ${code})`)),
    );
  });
  onLine(`[deps] ${tensorrtRtxLabel()} installed ✓`);

  const retry = await probeTensorRtRtxLoadable(venvPython);
  if (retry.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified after install (${retry.version ?? "ok"}) ✓`);
    return { ok: true, libsDir: await getTensorRtRtxLibsDir(venvPython) };
  }

  return {
    ok: false,
    error: retry.detail ?? "TensorRT RTX runtime not loadable after install",
  };
}

async function ensureDeps(
  pkgs: PkgDef[],
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  for (const pkg of pkgs) {
    // Torch: check installed CUDA version matches what we need (GPU vs CPU)
    if (pkg.importName === "torch") {
      try {
        const { stdout } = await execFileAsync(venvPython, [
          "-c",
          "import torch; print(torch.version.cuda or 'NONE')",
        ]);
        const installedCuda = stdout.trim();
        const needsGpu = !pkg.installArgs.includes("cpu");
        const hasGpu = installedCuda !== "NONE" && installedCuda !== "";
        if (needsGpu === hasGpu) {
          onLine(`[deps] torch already installed (CUDA: ${hasGpu ? installedCuda : "none/CPU"}) ✓`);
          continue;
        }
        onLine(
          `[deps] torch CUDA mismatch (have ${hasGpu ? installedCuda : "CPU"}, need ${needsGpu ? "GPU" : "CPU"}) — reinstalling...`,
        );
      } catch {
        /* not installed, fall through */
      }
    } else if (pkg.importName === "tensorrt") {
      const installed = await getInstalledTensorRtVersion(venvPython);
      if (installed && isCompatibleTensorRtVersion(installed)) {
        const probe = await probeTensorRtLoadable(venvPython);
        if (probe.loadable) {
          onLine(`[deps] ${pkg.label} already installed (${installed}) ✓`);
          continue;
        }
        onLine(`[deps] ${pkg.label} installed but TensorRT EP not loadable — reinstalling...`);
      } else if (installed) {
        onLine(
          `[deps] ${pkg.label} version ${installed} incompatible — installing ${PINNED_TENSORRT_VERSION}...`,
        );
      }
    } else if (pkg.importName === "tensorrt_rtx") {
      const probe = await probeTensorRtRtxLoadable(venvPython);
      if (probe.loadable) {
        onLine(`[deps] ${pkg.label} already installed (${probe.version ?? "ok"}) ✓`);
        continue;
      }
    } else if (pkg.importName.startsWith("nvidia.")) {
      try {
        await execFileAsync(venvPython, [
          "-c",
          `import importlib; importlib.import_module(${JSON.stringify(pkg.importName)})`,
        ]);
        onLine(`[deps] ${pkg.label} already installed ✓`);
        continue;
      } catch {
        /* not installed */
      }
    } else if (pkg.importName === "onnxruntime") {
      try {
        const { stdout } = await execFileAsync(venvPython, [
          "-c",
          "import onnxruntime as ort; print(ort.__version__)",
        ]);
        const installed = stdout.trim();
        const expected = pinnedOrtGpuInstallArgs()[0]?.split("==")[1];
        if (installed && expected && installed === expected) {
          onLine(`[deps] ${pkg.label} already installed ✓`);
          continue;
        }
        if (installed) {
          onLine(
            `[deps] onnxruntime-gpu ${installed} installed — need ${expected ?? "pinned build"}, reinstalling...`,
          );
        }
      } catch {
        /* not installed */
      }
    } else {
      try {
        await execFileAsync(venvPython, ["-c", `import ${pkg.importName}`]);
        onLine(`[deps] ${pkg.label} already installed ✓`);
        continue;
      } catch {
        /* not installed */
      }
    }

    onLine(`[deps] Installing ${pkg.label}...`);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pip, ["install", ...pkg.installArgs], { stdio: "pipe" });
      proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.on("close", (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`pip install ${pkg.label} failed (exit ${code})`)),
      );
    });
    onLine(`[deps] ${pkg.label} installed ✓`);
  }

  return { ok: true };
}

// ─── CUDA Detection ───────────────────────────────────────────────────────────

function parseCudaVersionFromNvidiaSmi(stdout: string): { cudaVersion: string; cudaTag: string } | null {
  const m = stdout.match(/CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/);
  if (!m) return null;
  const cudaVersion = `${m[1]}.${m[2]}`;
  const cudaTag = pickCudaTag(parseInt(m[1], 10), parseInt(m[2], 10));
  return { cudaVersion, cudaTag };
}

function pickCudaTag(major: number, minor: number): string {
  const tiers = [
    { major: 12, minor: 6, tag: "cu126" },
    { major: 12, minor: 4, tag: "cu124" },
    { major: 12, minor: 1, tag: "cu121" },
    { major: 11, minor: 8, tag: "cu118" },
  ];
  for (const t of tiers) {
    if (major > t.major || (major === t.major && minor >= t.minor)) return t.tag;
  }
  return "cu118";
}

async function detectCudaTag(preferred: string, onLine: (line: string) => void): Promise<string> {
  if (preferred && preferred !== "auto") {
    onLine(`[deps] CUDA version override: ${preferred}`);
    return preferred;
  }

  // Check existing torch in venv first — avoids reinstall when already correct
  const venvPython = getVenvPython();
  try {
    const { stdout } = await execFileAsync(venvPython, [
      "-c",
      "import torch; print(torch.version.cuda or 'NONE')",
    ]);
    const existing = stdout.trim();
    if (existing !== "NONE" && existing) {
      const parts = existing.split(".");
      const tag = pickCudaTag(parseInt(parts[0]), parseInt(parts[1] ?? "0"));
      onLine(`[deps] Existing torch CUDA ${existing} → using ${tag}`);
      return tag;
    }
  } catch {
    /* torch not installed */
  }

  // Auto-detect via nvidia-smi
  try {
    const { stdout } = await execFileAsync("nvidia-smi", []);
    const parsed = parseCudaVersionFromNvidiaSmi(stdout);
    if (parsed) {
      onLine(`[deps] nvidia-smi detected CUDA ${parsed.cudaVersion} → ${parsed.cudaTag}`);
      return parsed.cudaTag;
    }
  } catch {
    /* no GPU or nvidia-smi not in PATH */
  }

  onLine(`[deps] No GPU detected → CPU torch`);
  return "cpu";
}

// ─── System Hardware Probe ────────────────────────────────────────────────────

async function probeNvidiaGpus(): Promise<HardwareProbeResult["nvidia"] | undefined> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,driver_version,memory.total",
      "--format=csv,noheader",
    ]);
    const gpus = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        const name = parts[0] ?? "Unknown GPU";
        const driver = parts[1];
        const memStr = parts[2];
        let vramMb: number | undefined;
        if (memStr) {
          const m = memStr.match(/(\d+)/);
          if (m) vramMb = parseInt(m[1], 10);
        }
        return { name, driver, vramMb };
      });

    if (gpus.length === 0) return undefined;

    let cudaVersion: string | undefined;
    let cudaTag: string | undefined;
    try {
      const { stdout: smiOut } = await execFileAsync("nvidia-smi", []);
      const parsed = parseCudaVersionFromNvidiaSmi(smiOut);
      if (parsed) {
        cudaVersion = parsed.cudaVersion;
        cudaTag = parsed.cudaTag;
      }
    } catch {
      /* ignore */
    }

    return { gpus, cudaVersion, cudaTag };
  } catch {
    return undefined;
  }
}

async function probeRocmGpus(): Promise<HardwareProbeResult["rocm"] | undefined> {
  try {
    const { stdout } = await execFileAsync("rocm-smi", ["--showproductname"]);
    const gpus = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("=") && !line.toLowerCase().includes("product"))
      .map((name) => ({ name }));
    if (gpus.length === 0) return undefined;
    return { gpus };
  } catch {
    return undefined;
  }
}

async function probePythonRuntime(
  python: string,
): Promise<Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders">> {
  const result: Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders"> = {};

  try {
    const { stdout } = await execFileAsync(python, ["-c", "import openvino; print(openvino.__version__)"]);
    const version = stdout.trim();
    if (version) result.openvino = { available: true, version };
  } catch {
    result.openvino = { available: false };
  }

  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import onnxruntime as ort; print(','.join(ort.get_available_providers()))",
    ]);
    const providers = stdout.trim().split(",").filter(Boolean);
    if (providers.length > 0) result.onnxRuntimeProviders = providers;
  } catch {
    /* onnxruntime not installed */
  }

  return result;
}

async function probeSystemHardware(): Promise<HardwareProbeResult> {
  const notes: string[] = [];
  const cpus = os.cpus();
  const platform = {
    os: `${process.platform} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || "Unknown CPU",
    cpuCores: cpus.length,
    systemRamGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  };

  const [nvidia, rocm] = await Promise.all([probeNvidiaGpus(), probeRocmGpus()]);

  let openvino: HardwareProbeResult["openvino"];
  let onnxRuntimeProviders: string[] | undefined;
  let tensorrt: HardwareProbeResult["tensorrt"];
  let tensorRtRtx: HardwareProbeResult["tensorRtRtx"];

  const venvPython = getVenvPython();
  const pythonCandidates: string[] = [];
  if (fs.existsSync(venvPython)) pythonCandidates.push(venvPython);
  const systemPython = await findSystemPython();
  if (systemPython) pythonCandidates.push(systemPython);

  for (const python of pythonCandidates) {
    const pyResult = await probePythonRuntime(python);
    if (pyResult.openvino?.available && !openvino?.available) {
      openvino = pyResult.openvino;
    }
    if (pyResult.onnxRuntimeProviders?.length && !onnxRuntimeProviders?.length) {
      onnxRuntimeProviders = pyResult.onnxRuntimeProviders;
      notes.push(
        `ONNX Runtime providers probed via ${python === venvPython ? ".venv Python" : "system Python"}.`,
      );
    }
    if (!tensorrt?.loadable) {
      const trt = await probeTensorRtLoadable(python);
      if (trt.loadable || !tensorrt) {
        tensorrt = trt;
      }
    }
    if (!tensorRtRtx?.loadable) {
      const rtx = await probeTensorRtRtxLoadable(python);
      if (rtx.loadable || !tensorRtRtx) {
        tensorRtRtx = rtx;
      }
    }
  }

  if (tensorRtRtx?.loadable) {
    notes.push(`TensorRT RTX runtime verified${tensorRtRtx.version ? ` (${tensorRtRtx.version})` : ""}.`);
  } else if (nvidia?.gpus.length) {
    notes.push(
      tensorRtRtx?.detail
        ? `TensorRT RTX not loadable: ${tensorRtRtx.detail}`
        : "TensorRT RTX not installed — Olive will auto-install tensorrt-rtx on run when TRT RTX is the target.",
    );
  }

  if (tensorrt?.loadable) {
    notes.push("TensorRT execution provider load verified.");
  } else if (nvidia?.gpus.length) {
    notes.push(
      tensorrt?.detail
        ? `TensorRT listed by ORT but not loadable: ${tensorrt.detail}`
        : "TensorRT not loadable — Olive will auto-install tensorrt on run when TensorRT is the hardware target.",
    );
  }

  if (onnxRuntimeProviders?.length) {
    notes.push(`ORT execution providers: ${onnxRuntimeProviders.join(", ")}`);
    if (nvidia && !onnxRuntimeProviders.includes("CUDAExecutionProvider")) {
      notes.push(
        "NVIDIA GPU detected but ONNX Runtime CUDA EP is not installed in Python (try onnxruntime-gpu in .venv).",
      );
    }
  } else if (nvidia) {
    notes.push("ONNX Runtime not installed in Python — NVIDIA GPU inferred from nvidia-smi.");
  }

  if (!nvidia) notes.push("No NVIDIA GPU detected (nvidia-smi unavailable or returned no devices).");
  if (!rocm) notes.push("No AMD ROCm GPU detected.");
  if (!openvino?.available) notes.push("OpenVINO Python package not found locally.");
  notes.push("QNN requires Snapdragon/Hexagon dev hardware — not probed on desktop.");

  const detectedProviders = mergeDetectedProviders({
    onnxRuntimeProviders,
    hasNvidiaGpu: Boolean(nvidia?.gpus.length),
    hasRocmGpu: Boolean(rocm?.gpus.length),
    hasOpenVino: Boolean(openvino?.available),
    tensorRtLoadable: tensorrt?.loadable === true,
    tensorRtRtxLoadable: tensorRtRtx?.loadable === true,
  });

  return {
    probedAt: new Date().toISOString(),
    platform,
    nvidia,
    rocm,
    openvino,
    tensorrt,
    tensorRtRtx,
    onnxRuntimeProviders,
    detectedProviders,
    recommendedProvider: pickRecommendedProvider(detectedProviders),
    notes,
  };
}

let hardwareProbeCache: { at: number; result: HardwareProbeResult } | null = null;
const HARDWARE_PROBE_CACHE_MS = 30_000;

function enrichProbeWithSystemRam(result: HardwareProbeResult): HardwareProbeResult {
  const systemRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  return {
    ...result,
    platform: {
      ...result.platform,
      systemRamGb: result.platform.systemRamGb ?? systemRamGb,
    },
  };
}

app.get("/api/system/hardware-probe", async (req, res) => {
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const now = Date.now();
    if (!refresh && hardwareProbeCache && now - hardwareProbeCache.at < HARDWARE_PROBE_CACHE_MS) {
      return res.json(enrichProbeWithSystemRam(hardwareProbeCache.result));
    }
    const result = enrichProbeWithSystemRam(await probeSystemHardware());
    hardwareProbeCache = { at: now, result };
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Hardware probe failed.",
    });
  }
});

// ─── POST /api/olive/run ──────────────────────────────────────────────────────
app.post("/api/olive/run", async (req, res) => {
  const { recipeJson, cudaVersion = "auto" } = req.body as { recipeJson?: string; cudaVersion?: string };
  if (!recipeJson) {
    return res.status(400).json({ error: "Missing recipeJson in request body." });
  }

  let parsedRecipe: unknown;
  try {
    parsedRecipe = JSON.parse(recipeJson);
  } catch {
    return res.status(400).json({ error: "recipeJson is not valid JSON." });
  }

  const schema = validateOliveRecipeStructure(parsedRecipe);
  if (!schema.valid) {
    return res.status(400).json({
      error: "Recipe failed structural validation.",
      schemaErrors: schema.errors,
    });
  }

  const jobId = uuidv4();
  const job: OliveJob = {
    id: jobId,
    status: "setting_up",
    exitCode: null,
    logs: [],
    subscribers: [],
    metricSubscribers: [],
    process: null,
    latestMetrics: null,
    metricsTimer: null,
    sampling: false,
  };
  jobRegistry.set(jobId, job);

  // Return job ID immediately so the client can open SSE
  res.json({ jobId });

  // Run setup + execution asynchronously
  (async () => {
    const setupResult = await ensureVenv((line) => pushLog(job, line)).catch((err) => ({
      ok: false,
      error: String(err.message),
    }));

    if (!setupResult.ok) {
      pushLog(job, `[error] ${setupResult.error}`);
      job.status = "failed";
      job.exitCode = 1;
      for (const sub of job.subscribers) {
        try {
          sub("__DONE__");
        } catch {
          /* gone */
        }
      }
      return;
    }

    // Detect CUDA version, then infer and install recipe-specific dependencies
    let recipeObj: OliveRecipe = {};
    try {
      recipeObj = JSON.parse(recipeJson) as OliveRecipe;
    } catch {
      /* malformed — olive will catch it */
    }

    if (recipeUsesMemoryOffload(recipeObj)) {
      const hwProbe = await probeSystemHardware();
      const provider = getRecipeIhvProvider(recipeObj);
      const gpuVramGb = getSelectedGpuVramGb(hwProbe, provider) ?? 12;
      const systemRamGb = hwProbe.platform.systemRamGb ?? os.totalmem() / 1024 ** 3;
      recipeObj = enrichRecipeMemoryOffloadForRun(recipeObj, gpuVramGb, systemRamGb);
      pushLog(
        job,
        `[mem] Hybrid offload: up to ~${gpuVramGb.toFixed(1)} GiB GPU + ~${systemRamGb.toFixed(1)} GiB host RAM (device_map auto)`,
      );
    }

    pushLog(job, "[deps] Detecting CUDA version...");
    const cudaTag = await detectCudaTag(cudaVersion, (line) => pushLog(job, line)).catch(() => "cpu");
    const requiredPkgs = inferRequiredPackages(recipeObj, cudaTag);
    pushLog(job, `[deps] Checking ${requiredPkgs.length} required package(s)...`);
    const depsResult = await ensureDeps(requiredPkgs, (line) => pushLog(job, line)).catch((err) => ({
      ok: false,
      error: String(err.message),
    }));
    if (!depsResult.ok) {
      pushLog(job, `[error] ${depsResult.error}`);
      job.status = "failed";
      job.exitCode = 1;
      for (const sub of job.subscribers) {
        try {
          sub("__DONE__");
        } catch {
          /* gone */
        }
      }
      return;
    }

    const targetProvider = getRecipeIhvProvider(recipeObj);
    if (targetProvider === "TensorrtExecutionProvider") {
      const trtResult = await ensureTensorRt((line) => pushLog(job, line)).catch((err) => ({
        ok: false as const,
        error: String(err.message),
      }));
      if (!trtResult.ok) {
        pushLog(job, `[error] TensorRT is not available: ${trtResult.error}`);
        pushLog(
          job,
          "[hint] Switch hardware target to TensorRT RTX or CUDA in step 02, or ensure pip can install tensorrt from PyPI.",
        );
        job.status = "failed";
        job.exitCode = 1;
        for (const sub of job.subscribers) {
          try {
            sub("__DONE__");
          } catch {
            /* gone */
          }
        }
        return;
      }
    } else if (targetProvider === "NvTensorRTRTXExecutionProvider") {
      const rtxResult = await ensureTensorRtRtx((line) => pushLog(job, line)).catch((err) => ({
        ok: false as const,
        error: String(err.message),
      }));
      if (!rtxResult.ok) {
        pushLog(job, `[error] TensorRT RTX is not available: ${rtxResult.error}`);
        pushLog(
          job,
          "[hint] Switch hardware target to CUDA in step 02, or ensure pip can install tensorrt-rtx from PyPI.",
        );
        job.status = "failed";
        job.exitCode = 1;
        for (const sub of job.subscribers) {
          try {
            sub("__DONE__");
          } catch {
            /* gone */
          }
        }
        return;
      }
    }

    // Write recipe to a temp file
    const tmpFile = path.join(os.tmpdir(), `olive_recipe_${jobId}.json`);
    const recipeToRun = JSON.stringify(recipeObj, null, 2);
    fs.writeFileSync(tmpFile, recipeToRun, "utf-8");
    pushLog(job, `[info] Recipe written to ${tmpFile}`);

    pushLog(job, "[preflight] Validating Olive RunConfig...");
    const hfEnv = runtimeHfToken ? { HF_TOKEN: runtimeHfToken } : {};
    const venvPython = getVenvPython();
    const runEnv = await buildOliveRunEnvironment(venvPython, targetProvider, {
      ...process.env,
      ...hfEnv,
    });
    if (isGpuExecutionProvider(targetProvider)) {
      pushLog(job, "[deps] GPU runtime PATH configured (CUDA/cuDNN + ORT preload launcher)");
    }
    const preflight = await runOliveConfigPreflight(
      tmpFile,
      (line) => pushLog(job, line),
      runEnv,
      targetProvider,
    ).catch((err) => ({
      ok: false,
      error: String(err.message),
    }));
    if (!preflight.ok) {
      pushLog(job, `[error] Preflight failed: ${preflight.error}`);
      job.status = "failed";
      job.exitCode = 1;
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
      for (const sub of job.subscribers) {
        try {
          sub("__DONE__");
        } catch {
          /* gone */
        }
      }
      return;
    }

    pushLog(job, `[info] Starting Olive optimization run...`);

    job.status = "running";
    startGpuMetricsTimer(job);
    const { executable, args } = resolveOliveCommand(targetProvider, tmpFile, false);
    const proc = spawn(executable, args, {
      stdio: "pipe",
      env: runEnv,
    });
    job.process = proc;

    proc.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach((line) => pushLog(job, line));
    });
    proc.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach((line) => pushLog(job, `[stderr] ${line}`));
    });

    proc.on("close", (code) => {
      job.exitCode = code;
      job.status = code === 0 ? "completed" : "failed";
      stopGpuMetricsTimer(job);
      pushLog(job, `[done] Olive process exited with code ${code}.`);
      // Cleanup temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
      // Signal end to all subscribers
      for (const sub of job.subscribers) {
        try {
          sub("__DONE__");
        } catch {
          /* gone */
        }
      }
    });

    proc.on("error", (err) => {
      pushLog(job, `[error] Failed to start Olive process: ${err.message}`);
      job.status = "failed";
      job.exitCode = 1;
      stopGpuMetricsTimer(job);
      for (const sub of job.subscribers) {
        try {
          sub("__DONE__");
        } catch {
          /* gone */
        }
      }
    });
  })();
});

// ─── GET /api/olive/stream/:jobId (SSE) ──────────────────────────────────────
app.get("/api/olive/stream/:jobId", (req, res) => {
  const job = jobRegistry.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (line: string) => {
    if (line === "__DONE__") {
      res.write(`event: done\ndata: ${JSON.stringify({ exitCode: job.exitCode })}\n\n`);
      res.end();
    } else {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  };

  // Replay existing logs
  for (const line of job.logs) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  // Replay latest GPU metrics if available
  if (job.latestMetrics) {
    res.write(`event: metrics\ndata: ${JSON.stringify(job.latestMetrics)}\n\n`);
  }

  // If already finished, send done immediately
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    res.write(`event: done\ndata: ${JSON.stringify({ exitCode: job.exitCode })}\n\n`);
    res.end();
    return;
  }

  // Subscribe to new lines
  job.subscribers.push(send);

  // Subscribe to GPU metrics
  const sendMetrics = (metrics: GpuMetrics) => {
    if (res.writableEnded) return;
    res.write(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`);
  };
  job.metricSubscribers.push(sendMetrics);

  req.on("close", () => {
    const idx = job.subscribers.indexOf(send);
    if (idx !== -1) job.subscribers.splice(idx, 1);
    const midx = job.metricSubscribers.indexOf(sendMetrics);
    if (midx !== -1) job.metricSubscribers.splice(midx, 1);
    if (job.subscribers.length === 0 && (job.status === "running" || job.status === "setting_up")) {
      cancelJobById(job.id);
    }
  });
});

// ─── GET /api/olive/status/:jobId ─────────────────────────────────────────────
app.get("/api/olive/status/:jobId", (req, res) => {
  const job = jobRegistry.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json({
    jobId: job.id,
    status: job.status,
    exitCode: job.exitCode,
    logCount: job.logs.length,
  });
});

/**
 * Cancels an active Olive job and terminates its process when applicable.
 *
 * @param jobId - The identifier of the job to cancel
 * @returns An object indicating whether the job was found and cancellation was requested
 */
function cancelJobById(jobId: string): { ok: boolean; message?: string } {
  const job = jobRegistry.get(jobId);
  if (!job) return { ok: false, message: "Job not found." };

  if (job.status === "running" || job.status === "setting_up") {
    job.status = "cancelled";
    job.exitCode = -1;
    stopGpuMetricsTimer(job);
    pushLog(job, "[info] Job cancelled by user.");

    if (job.process && job.process.pid) {
      try {
        if (process.platform === "win32") {
          const { spawnSync } = require("child_process");
          spawnSync("taskkill", ["/F", "/T", "/PID", String(job.process.pid)]);
        } else {
          job.process.kill("SIGKILL");
        }
      } catch (err) {
        pushLog(job, `[warn] Error signaling process termination: ${String(err)}`);
      }
    }

    for (const sub of job.subscribers) {
      try {
        sub("__DONE__");
      } catch {
        /* gone */
      }
    }
  }

  return { ok: true };
}

function cleanupAllJobs(): void {
  for (const [jobId, job] of jobRegistry) {
    if (job.status === "running" || job.status === "setting_up") {
      cancelJobById(jobId);
    }
  }
}

app.post("/api/olive/cancel", (req, res) => {
  const { jobId } = req.body as { jobId?: string };
  if (!jobId) return res.status(400).json({ error: "Missing jobId in request body." });
  const result = cancelJobById(jobId);
  if (!result.ok) return res.status(404).json({ error: result.message });
  return res.json({ ok: true, jobId, status: "cancelled" });
});

app.post("/api/olive/cancel/:jobId", (req, res) => {
  const result = cancelJobById(req.params.jobId);
  if (!result.ok) return res.status(404).json({ error: result.message });
  return res.json({ ok: true, jobId: req.params.jobId, status: "cancelled" });
});

app.delete("/api/olive/cancel/:jobId", (req, res) => {
  const result = cancelJobById(req.params.jobId);
  if (!result.ok) return res.status(404).json({ error: result.message });
  return res.json({ ok: true, jobId: req.params.jobId, status: "cancelled" });
});

// ─── HuggingFace Token Management ────────────────────────────────────────────
app.get("/api/env/hf-token-status", (_req, res) => {
  if (process.env.HF_TOKEN) return res.json({ source: "environment" });
  if (runtimeHfToken) return res.json({ source: "user" });
  return res.json({ source: "none" });
});

app.post("/api/env/hf-token", (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ error: "Invalid token." });
  }
  runtimeHfToken = token.trim();
  return res.json({ ok: true });
});

app.delete("/api/env/hf-token", (_req, res) => {
  runtimeHfToken = null;
  return res.json({ ok: true });
});

// ─── GET/POST/DELETE /api/ai/provider ────────────────────────────────────────
app.get("/api/ai/provider", (_req, res) => {
  const cfg = getAiProvider();
  if (!cfg) return res.json({ source: "none" });
  const source = runtimeAiProvider ? "user" : "env";
  return res.json({ source, provider: cfg.provider, model: cfg.model });
});

app.post("/api/ai/provider", (req, res) => {
  const {
    provider,
    apiKey: key,
    model,
    baseUrl,
  } = req.body as {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  if (!provider || !key || !model) {
    return res.status(400).json({ error: "provider, apiKey, and model are required" });
  }
  if (!ALLOWED_AI_PROVIDERS.has(provider as ProviderConfig["provider"])) {
    return res.status(400).json({ error: `Invalid provider: ${provider}` });
  }
  if (provider === "openai-compat" && !baseUrl?.trim()) {
    return res.status(400).json({ error: "baseUrl is required for OpenAI-compatible providers." });
  }
  runtimeAiProvider = {
    provider: provider as ProviderConfig["provider"],
    apiKey: key.trim(),
    model: model.trim(),
    baseUrl: baseUrl?.trim() || undefined,
  };
  return res.json({
    ok: true,
    source: "user",
    provider: runtimeAiProvider.provider,
    model: runtimeAiProvider.model,
  });
});

app.delete("/api/ai/provider", (_req, res) => {
  runtimeAiProvider = null;
  return res.json({ ok: true });
});

// ─── LM Studio (Llmster) Integration ─────────────────────────────────────────
const LM_STUDIO_PORT = 1234;

/** Read the LM Studio API token from LM_API_TOKEN env var */
function getLmStudioToken(): string | null {
  return process.env.LM_API_TOKEN || process.env.LM_STUDIO_API_KEY || null;
}

/** Build common fetch options for LM Studio HTTP API calls */
function lmStudioFetchInit(signal?: AbortSignal): RequestInit {
  const init: RequestInit = {};
  if (signal) init.signal = signal;
  const token = getLmStudioToken();
  if (token) {
    init.headers = { Authorization: `Bearer ${token}` };
  }
  return init;
}

/** Find the Llmster (LM Studio) CLI binary, cached at module level */
let cachedLmsCli: string | null | undefined; // undefined = not yet searched
function findLmsCli(): string | null {
  if (cachedLmsCli !== undefined) return cachedLmsCli;
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [path.join(home, ".lmstudio", "bin", "lms.exe"), path.join(home, ".lmstudio", "bin", "lms")]
      : [path.join(home, ".lmstudio", "bin", "lms"), "/usr/local/bin/lms", "/opt/homebrew/bin/lms"];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedLmsCli = c;
      return cachedLmsCli;
    }
  }
  // Try PATH via synchronous which/where
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const result: string = execSync("which lms 2>/dev/null || where lms 2>nul", {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    if (result && fs.existsSync(result)) {
      cachedLmsCli = result;
      return cachedLmsCli;
    }
  } catch {
    /* not on PATH */
  }
  cachedLmsCli = null;
  return cachedLmsCli;
}

app.get("/api/ai/local-models", async (_req, res) => {
  try {
    // 1) Try LM Studio HTTP API (loaded models)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(
      `http://localhost:${LM_STUDIO_PORT}/v1/models`,
      lmStudioFetchInit(controller.signal),
    );
    clearTimeout(timeout);
    if (response.ok) {
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const loadedModels = (data.data || []).map((m) => m.id);

      // 2) Also try `lms ls` for all downloaded models
      const lms = findLmsCli();
      let downloadedModels: string[] = [];
      if (lms) {
        try {
          const { stdout } = await execFileAsync(lms, ["ls", "--json"], { timeout: 5000 });
          const parsed = JSON.parse(stdout) as Array<{
            modelKey?: string;
            sizeBytes?: number;
            indexedModelIdentifier?: string;
          }>;
          downloadedModels = (Array.isArray(parsed) ? parsed : [])
            .map((m) => m.modelKey || m.indexedModelIdentifier || "")
            .filter(Boolean);
        } catch {
          // Fall back to loaded models only
          downloadedModels = loadedModels;
        }
      }

      const allModels = [...new Set([...downloadedModels, ...loadedModels])];
      return res.json({ lmStudioRunning: true, ollamaRunning: true, installedModels: allModels });
    }
    return res.json({ lmStudioRunning: false, ollamaRunning: false, installedModels: [] });
  } catch {
    return res.json({ lmStudioRunning: false, ollamaRunning: false, installedModels: [] });
  }
});

// ─── GET /api/ai/local-model-sizes ─────────────────────────────────────────────
app.get("/api/ai/local-model-sizes", async (_req, res) => {
  const lms = findLmsCli();
  if (!lms) {
    return res.json({ sizes: {} });
  }
  try {
    const { stdout } = await execFileAsync(lms, ["ls", "--json"], { timeout: 5000 });
    const parsed = JSON.parse(stdout) as Array<{
      modelKey?: string;
      sizeBytes?: number;
      indexedModelIdentifier?: string;
      displayName?: string;
      paramsString?: string;
    }>;
    const sizes: Record<string, number> = {};
    if (Array.isArray(parsed)) {
      for (const m of parsed) {
        const key = m.modelKey || m.indexedModelIdentifier || "";
        if (key && typeof m.sizeBytes === "number") {
          sizes[key] = m.sizeBytes;
        }
      }
    }
    return res.json({ sizes });
  } catch {
    return res.json({ sizes: {} });
  }
});

// ─── GET /api/ai/local-health ──────────────────────────────────────────────────
app.get("/api/ai/local-health", async (_req, res) => {
  const lms = findLmsCli();
  if (!lms) {
    return res.json({
      healthy: false,
      lmsInstalled: false,
      serverRunning: false,
      error: "Llmster CLI not found",
    });
  }

  try {
    // Check if LM Studio server is responding on port 1234
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(
      `http://localhost:${LM_STUDIO_PORT}/v1/models`,
      lmStudioFetchInit(controller.signal),
    );
    clearTimeout(timeout);

    // Any HTTP response means the server is running, even 401 (auth required)
    const serverRunning = response.status > 0;
    if (serverRunning) {
      return res.json({ healthy: true, lmsInstalled: true, serverRunning: true, needsToken: !response.ok });
    }
    return res.json({
      healthy: false,
      lmsInstalled: true,
      serverRunning: false,
      error: `Server responded with ${response.status}`,
    });
  } catch {
    return res.json({
      healthy: false,
      lmsInstalled: true,
      serverRunning: false,
      error: "LM Studio server not responding on port " + LM_STUDIO_PORT,
    });
  }
});

// ─── POST /api/ai/local-load ──────────────────────────────────────────────────
app.post("/api/ai/local-load", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  const lms = findLmsCli();
  if (!lms) {
    return res.status(500).json({ error: "LM Studio (Llmster) not found." });
  }

  try {
    const { stdout, stderr } = await execFileAsync(lms, ["load", modelTag], { timeout: 30000 });
    return res.json({ ok: true, output: stdout || stderr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to load model: ${msg}` });
  }
});

// ─── POST /api/ai/local-unload ────────────────────────────────────────────────
app.post("/api/ai/local-unload", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  const lms = findLmsCli();
  if (!lms) {
    return res.status(500).json({ error: "LM Studio (Llmster) not found." });
  }

  try {
    const { stdout, stderr } = await execFileAsync(lms, ["unload", modelTag], { timeout: 10000 });
    return res.json({ ok: true, output: stdout || stderr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to unload model: ${msg}` });
  }
});

// ─── POST /api/ai/local-pull ───────────────────────────────────────────────────
app.post("/api/ai/local-pull", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  const LM_STUDIO_PORT = 1234;
  const lms = findLmsCli();

  if (!lms) {
    return res.status(500).json({
      error: "LM Studio (Llmster) not found. Install it from https://lmstudio.ai/install.sh",
    });
  }

  try {
    // Use `lms get` to download the model via LM Studio CLI
    const getProc = spawn(lms, ["get", modelTag], { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    getProc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    getProc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      getProc.on("close", (code) => resolve(code ?? 1));
      getProc.on("error", () => resolve(1));
    });

    if (exitCode !== 0) {
      return res.status(500).json({
        error: `LM Studio model download failed (exit ${exitCode}): ${stderr || stdout}`,
      });
    }

    // Auto-load the model into LM Studio memory so it's ready for immediate use
    try {
      await execFileAsync(lms, ["load", modelTag], { timeout: 30000 });
    } catch {
      // Load failure is non-fatal — model is downloaded, user can load manually
    }

    // Configure the AI provider to use LM Studio's OpenAI-compatible server
    runtimeAiProvider = {
      provider: "openai-compat",
      baseUrl: `http://localhost:${LM_STUDIO_PORT}/v1`,
      model: modelTag,
      apiKey: "lm-studio",
    };

    return res.json({
      ok: true,
      source: "user",
      provider: "openai-compat",
      model: modelTag,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to download model via LM Studio: ${msg}` });
  }
});

// ─── Ollama Integration ────────────────────────────────────────────────────────
const OLLAMA_PORT = 11434;

/** Check if the Ollama server is reachable on localhost */
async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── GET /api/ai/ollama-model-sizes ────────────────────────────────────────────
app.get("/api/ai/ollama-model-sizes", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return res.json({ sizes: {} });
    const data = (await resp.json()) as { models?: Array<{ name: string; size?: number }> };
    const sizes: Record<string, number> = {};
    if (Array.isArray(data.models)) {
      for (const m of data.models) {
        if (m.name && typeof m.size === "number") {
          sizes[m.name] = m.size;
        }
      }
    }
    return res.json({ sizes });
  } catch {
    return res.json({ sizes: {} });
  }
});

app.get("/api/ai/ollama-health", async (_req, res) => {
  const running = await isOllamaRunning();
  return res.json({ healthy: running, serverRunning: running, port: OLLAMA_PORT });
});

app.get("/api/ai/ollama-models", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return res.json({ installedModels: [], runningModels: [] });
    const data = (await resp.json()) as { models?: Array<{ name: string; size?: number }> };
    const installed = (data.models || []).map((m) => m.name);

    // Get running models via /api/ps
    let runningModels: string[] = [];
    try {
      const psResp = await fetch(`http://localhost:${OLLAMA_PORT}/api/ps`);
      if (psResp.ok) {
        const psData = (await psResp.json()) as { models?: Array<{ name: string }> };
        runningModels = (psData.models || []).map((m) => m.name);
      }
    } catch {
      /* ignore */
    }

    return res.json({ installedModels: installed, runningModels, ollamaRunning: true });
  } catch {
    return res.json({ installedModels: [], runningModels: [], ollamaRunning: false });
  }
});

app.post("/api/ai/ollama-pull", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  // Quick check if Ollama is reachable before attempting pull
  if (!(await isOllamaRunning())) {
    return res.status(503).json({
      error: "Ollama is not running. Install it from https://ollama.com and start the server (ollama serve).",
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min timeout for large models
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelTag, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: `Ollama pull failed: ${err}` });
    }

    // Configure the AI provider to use Ollama's OpenAI-compatible endpoint
    runtimeAiProvider = {
      provider: "openai-compat",
      baseUrl: `http://localhost:${OLLAMA_PORT}/v1`,
      model: modelTag,
      apiKey: "ollama",
    };

    return res.json({ ok: true, source: "ollama", provider: "openai-compat", model: modelTag });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return res.status(504).json({
        error: "Ollama pull timed out after 5 minutes. The model may be too large or the network is slow.",
      });
    }
    return res.status(500).json({ error: `Failed to pull model via Ollama: ${msg}` });
  }
});

app.post("/api/ai/ollama-load", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  try {
    // Use /api/show to verify the model exists, then keep_alive: -1 to keep it loaded
    const showResp = await fetch(`http://localhost:${OLLAMA_PORT}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelTag }),
    });
    if (!showResp.ok) {
      return res.status(404).json({ error: `Model '${modelTag}' not found in Ollama. Pull it first.` });
    }
    // Warm up the model by generating a minimal token — Ollama auto-loads on first request
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelTag, prompt: "hi", keep_alive: -1, options: { num_predict: 1 } }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: `Failed to load model: ${err}` });
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to load model: ${msg}` });
  }
});

app.post("/api/ai/ollama-unload", async (req, res) => {
  const { modelTag } = req.body as { modelTag?: string };
  if (!modelTag) return res.status(400).json({ error: "modelTag is required." });

  try {
    const resp = await fetch(`http://localhost:${OLLAMA_PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelTag, prompt: "", keep_alive: 0 }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: `Failed to unload model: ${err}` });
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Failed to unload model: ${msg}` });
  }
});

// ─── Olive MCP Integration Helper ──────────────────────────────────────────────
/** Invokes a tool function in olive_mcp_server and returns its result */
async function callOliveMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResponse> {
  let python = getVenvPython();
  if (!fs.existsSync(python)) {
    python = (await findSystemPython()) ?? "";
  }
  if (!python) {
    return { error: "Python environment not found." };
  }

  const oliveMcpDir = path.join(process.cwd(), "olive-mcp-server");

  const script = `import json, sys
sys.path.insert(0, sys.argv[3])
from olive_mcp_server import tools

tool_name = sys.argv[1]
kwargs = json.loads(sys.argv[2])
if not hasattr(tools, tool_name):
    print(json.dumps({"error": f"Tool '{tool_name}' not found in olive_mcp_server.tools"}))
    sys.exit(0)

func = getattr(tools, tool_name)
try:
    res = func(**kwargs)
    print(json.dumps(res))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      script,
      toolName,
      JSON.stringify(args),
      oliveMcpDir,
    ]);
    return JSON.parse(stdout.trim()) as McpToolResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP Tool Warning] ${toolName} call failed:`, msg);
    return { error: msg };
  }
}

/** Maps an ONNX Runtime execution-provider name to a canonical hardware target
 *  profile in the Olive MCP knowledge base. */
function mapProviderToHardwareTarget(provider: string): string {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
      return "NVIDIA RTX 4090";
    case "OpenVINOExecutionProvider":
      return "Intel Core i9 CPU";
    case "QNNExecutionProvider":
      return "Qualcomm Snapdragon NPU";
    case "ROCMExecutionProvider":
      return "AMD MI300X / ROCm";
    case "CPUExecutionProvider":
    default:
      return "Intel Core i9 CPU";
  }
}

// ─── POST /api/mcp/tool ───────────────────────────────────────────────────────
app.post("/api/mcp/tool", async (req, res) => {
  const { toolName, args } = req.body as { toolName?: string; args?: Record<string, unknown> };
  if (!toolName) return res.status(400).json({ error: "toolName is required." });
  try {
    const result = await callOliveMcpTool(toolName, args || {});
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

// ─── KB Status Helpers ────────────────────────────────────────────────────────

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when update_report.json reflects a successful upstream refresh. */
function isSuccessfulKbReport(report: Record<string, unknown> | null): boolean {
  if (!report) return false;
  if (report.success === false) return false;
  if (report.success === true) return true;

  const sources = report.sources;
  if (!isObjectRecord(sources) || Object.keys(sources).length === 0) return false;

  for (const source of Object.values(sources)) {
    if (!isObjectRecord(source)) continue;
    if (source.status === "error") return false;
  }
  return true;
}

function isAllowedSyncOrigin(req: express.Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true; // same-origin / non-browser clients omit Origin
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.get("host");
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

/** Load KB status from the filesystem and cache it. */
function loadKbStatus(): KbStatusCache {
  try {
    const kbDir = path.join(process.cwd(), "olive-mcp-server", "olive_mcp_server", "knowledge_base");
    const passesPath = path.join(kbDir, "passes.json");

    if (!fs.existsSync(passesPath)) {
      return {
        available: false,
        error: "passes.json not found",
      };
    }

    const raw = fs.readFileSync(passesPath, "utf-8");
    const data = JSON.parse(raw) as { version?: string; last_updated?: string; passes?: unknown[] };

    // Check for update_report.json (written by update_kb.py)
    const reportPath = path.join(kbDir, "update_report.json");
    let lastSync: string | null = null;
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as Record<string, unknown>;
        if (isSuccessfulKbReport(report) && typeof report.updated_at === "string") {
          lastSync = report.updated_at;
        }
      } catch {
        /* ignore */
      }
    }

    return {
      available: true,
      version: data.version ?? "unknown",
      lastUpdated: data.last_updated ?? null,
      lastSync,
      passCount: Array.isArray(data.passes) ? data.passes.length : 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      error: msg,
    };
  }
}

/** Invalidate the KB status cache. */
function invalidateKbStatusCache(): void {
  kbStatusCache = null;
}

// ─── GET /api/mcp/kb-status ───────────────────────────────────────────────────
app.get("/api/mcp/kb-status", kbStatusRateLimit, (req, res) => {
  // Return cached status if available
  if (kbStatusCache) {
    return res.json(kbStatusCache);
  }

  // Load from filesystem and cache
  kbStatusCache = loadKbStatus();

  if (kbStatusCache.error && !kbStatusCache.available) {
    // Designed unavailable response (missing KB) stays HTTP 200 for the UI hook.
    if (kbStatusCache.error === "passes.json not found") {
      return res.json(kbStatusCache);
    }
    return res.status(500).json(kbStatusCache);
  }

  return res.json(kbStatusCache);
});

// ─── POST /api/mcp/sync-kb ────────────────────────────────────────────────────
app.post("/api/mcp/sync-kb", kbSyncRateLimit, async (req, res) => {
  try {
    // ── Authentication: token required on every request ──────────────────────────
    const expectedToken = process.env.SYNC_KB_TOKEN;

    // Fail closed: SYNC_KB_TOKEN must be configured on the server
    if (!expectedToken) {
      return res.status(503).json({ ok: false, error: "Service unavailable: SYNC_KB_TOKEN not configured." });
    }

    const authToken = req.get("x-sync-token");

    // Require valid token on every request
    if (authToken !== expectedToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized: valid token required." });
    }

    // Additional browser origin check (defense-in-depth, not for authorization)
    if (!isAllowedSyncOrigin(req)) {
      return res.status(403).json({ ok: false, error: "Forbidden: origin not allowed." });
    }

    // ── Mutex: prevent overlapping executions ───────────────────────────────────
    if (kbSyncInProgress) {
      return res.status(409).json({ ok: false, error: "Sync already in progress. Please wait." });
    }

    kbSyncInProgress = true;

    const scriptPath = path.join(process.cwd(), "olive-mcp-server", "scripts", "update_kb.py");
    if (!fs.existsSync(scriptPath)) {
      kbSyncInProgress = false;
      return res.status(404).json({ ok: false, error: "update_kb.py script not found." });
    }

    let python = getVenvPython();
    if (!fs.existsSync(python)) {
      python = (await findSystemPython()) ?? "";
    }
    if (!python) {
      kbSyncInProgress = false;
      return res.status(500).json({ ok: false, error: "Python environment not found." });
    }

    const { stdout, stderr } = await execFileAsync(python, [scriptPath], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Read the generated report
    const kbDir = path.join(process.cwd(), "olive-mcp-server", "olive_mcp_server", "knowledge_base");
    const reportPath = path.join(kbDir, "update_report.json");
    let report: Record<string, unknown> | null = null;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      } catch {
        /* ignore */
      }
    }

    const syncSucceeded = isSuccessfulKbReport(report);

    // Hot-reload only after a successful refresh with a readable passes.json
    const passesPath = path.join(kbDir, "passes.json");
    if (syncSucceeded && fs.existsSync(passesPath)) {
      try {
        const passesRaw = fs.readFileSync(passesPath, "utf-8");
        const passesData = JSON.parse(passesRaw) as PassesJson;
        reloadPassSchemas(passesData);
      } catch (err: unknown) {
        console.warn("[sync-kb] Failed to reload pass schemas:", err);
      }
    }

    // Invalidate cache so next kb-status call reloads from disk
    invalidateKbStatusCache();

    kbSyncInProgress = false;

    if (!syncSucceeded) {
      return res.status(502).json({
        ok: false,
        error: "Knowledge-base sync completed without a successful source refresh.",
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 500) || null,
        report,
      });
    }

    return res.json({
      ok: true,
      stdout: stdout.slice(0, 2000),
      stderr: stderr.slice(0, 500) || null,
      report,
    });
  } catch (err: unknown) {
    kbSyncInProgress = false;
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ─── POST /api/ai/validate ────────────────────────────────────────────────────
app.post("/api/ai/validate", async (req, res) => {
  const { recipeJson, ihvProvider } = req.body;
  if (!recipeJson) return res.status(400).json({ error: "No recipe JSON provided." });

  let mcpChainResult: McpToolResponse | null = null;
  try {
    const parsed = JSON.parse(recipeJson);
    const passes = parsed.passes || {};
    const passNames = Object.keys(passes);
    if (passNames.length > 0) {
      mcpChainResult = await callOliveMcpTool("get_pass_chain", {
        pass_names: passNames,
        source_format: "torch",
      });
    }
  } catch {
    /* ignore parse error */
  }

  const mcpContext =
    mcpChainResult && !mcpChainResult.error
      ? `\n\nOfficial Olive Pass Chain Audit from Olive MCP Server:\n${JSON.stringify(mcpChainResult, null, 2)}`
      : "";

  const system = `You are an expert Microsoft Olive compiler engineer. Analyze the recipe and detect execution failures, suboptimal settings, or compatibility issues.${mcpContext}
Respond with ONLY valid JSON:
{"valid":true|false,"severity":"success"|"warning"|"error","summary":"<1-2 sentences>","issues":[{"type":"critical"|"warning"|"info","title":"<short>","explanation":"<detail>","fix":"<action>"}],"suggestions":["<tip>"]}`;

  try {
    const text = await callAI(
      system,
      [
        {
          role: "user",
          content: `Validate this Olive recipe for hardware '${ihvProvider || "CPUExecutionProvider"}':\n\n${recipeJson}`,
        },
      ],
      true,
    );
    return res.json(parseJsonFromAiResponse(text));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("AI Validate Error:", err);
    return res.status(500).json({ error: msg });
  }
});

// ─── POST /api/ai/analyze-state ──────────────────────────────────────────────
app.post("/api/ai/analyze-state", async (req, res) => {
  const { state } = req.body;
  if (!state) return res.status(400).json({ error: "No state provided." });

  const workspace = buildAiWorkspaceContext(state);

  let hwGuide: McpToolResponse | null = null;
  let quantStrat: McpToolResponse | null = null;
  try {
    const targetHw = mapProviderToHardwareTarget(state.ihvProvider || "CPUExecutionProvider");
    const modelType = state.hfModelId || "LLM";
    [hwGuide, quantStrat] = await Promise.all([
      callOliveMcpTool("get_hardware_optimization_guide", { target_hardware: targetHw }),
      callOliveMcpTool("get_quantization_strategy", {
        model_type: modelType,
        target_hardware: targetHw,
      }),
    ]);
  } catch {
    /* ignore MCP query error */
  }

  const mcpAdvice =
    (hwGuide && !hwGuide.error) || (quantStrat && !quantStrat.error)
      ? `\n\nOfficial Olive MCP Server Optimization Guidance:\nHardware Guide: ${JSON.stringify(hwGuide)}\nQuantization Strategy: ${JSON.stringify(quantStrat)}`
      : "";

  const system = `You are "Olive Optimization Advisor", an expert Microsoft Olive compiler and hardware co-design specialist. Analyze the pipeline configuration and give specific, actionable advice.

${formatAiWorkspaceContextForPrompt(workspace)}${mcpAdvice}

autofix.pass MUST be one of these exact strings:
ihvProvider (value: CPUExecutionProvider|CUDAExecutionProvider|TensorrtExecutionProvider|OpenVINOExecutionProvider|QNNExecutionProvider|ROCMExecutionProvider)
cudaVersion (value: auto|cpu|cu118|cu121|cu124|cu126)
passes.conversion (value: "true"|"false")
passes.conversionFormat (value: "onnx"|"openvino")
passes.quantization (value: "true"|"false")
passes.quantMethod (value: "ptq"|"awq"|"qat")
passes.quantPrecision (value: "int4"|"int8"|"fp16")
passes.pruning (value: "true"|"false")
passes.pruningType (value: "unstructured"|"structured")
passes.pruningMethod (value: "magnitude"|"sparsegpt"|"wanda")
passes.onnxTransforms (value: "true"|"false")
passes.peft (value: "true"|"false")
passes.peftMethod (value: "lora"|"qlora")

Respond with ONLY valid JSON:
{"score":<0-100>,"level":"Optimized"|"Suboptimal"|"Unoptimized"|"Critical Mismatch","summary":"<2 sentences>","suggestions":[{"title":"<short>","description":"<why+what>","impact":"High"|"Medium"|"Low","type":"warning"|"success"|"suggestion"|"info","autofix":{"pass":"<path>","value":"<val>"}}]}`;

  try {
    const text = await callAI(
      system,
      [{ role: "user", content: `Pipeline JSON:\n${JSON.stringify(workspace, null, 2)}` }],
      true,
    );
    return res.json(parseJsonFromAiResponse(text));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("AI Analyze Error:", err);
    return res.status(500).json({ error: msg });
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  const { message, workspaceContext, state, chatHistory } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message." });

  const workspace = workspaceContext ?? (state ? buildAiWorkspaceContext(state) : null);

  const contextBlock = workspace ? `\n\n${formatAiWorkspaceContextForPrompt(workspace)}` : "";

  let mcpKnowledge: McpToolResponse | null = null;
  if (typeof message === "string" && message.length > 5) {
    try {
      const isErrorMsg = /error|fail|exception|invalid|oom|traceback/i.test(message);
      if (isErrorMsg) {
        mcpKnowledge = await callOliveMcpTool("troubleshoot_olive_error", { error_message: message });
      } else {
        mcpKnowledge = await callOliveMcpTool("search_olive_documentation", { query: message });
      }
    } catch {
      /* ignore */
    }
  }

  const mcpBlock =
    mcpKnowledge && !mcpKnowledge.error
      ? `\n\nOfficial Olive MCP Server Knowledge Base Match:\n${JSON.stringify(mcpKnowledge, null, 2)}`
      : "";

  const system = `You are "Olive AI Assistant", an expert Microsoft Olive compiler specialist. Deep expertise in quantization (AWQ, GPTQ, PTQ, QAT, SmoothQuant), pruning (magnitude, SparseGPT, Wanda), PEFT (LoRA, QLoRA), ONNX Runtime, and hardware execution providers (CUDA, TensorRT, DirectML, OpenVINO, QNN/Snapdragon). Give professional, accurate, concise answers. When relevant, provide Olive config snippets or CLI commands. Treat the workspace block below as the user's live pipeline — do not invent a different model, provider, or pass list.${contextBlock}${mcpBlock}`;

  const history: AIChatMessage[] = (chatHistory || []).map((m: IncomingChatMessage) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content ?? "",
  }));

  try {
    const text = await callAI(system, [...history, { role: "user", content: message }], false);
    return res.json({ text: text || "No response generated." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("AI Chat Error:", err);
    return res.status(500).json({ error: msg });
  }
});

// ─── POST /api/validate-compatibility (MCP model-hardware compatibility) ────────
app.post("/api/validate-compatibility", async (req, res) => {
  const {
    modelName,
    framework,
    hardwareTarget = "",
  } = req.body as {
    modelName?: string;
    framework?: string;
    hardwareTarget?: string;
  };

  if (!modelName || !framework) {
    return res.status(400).json({ error: "Missing modelName or framework." });
  }

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "validate_model_compatibility.py");
    const python = getVenvPython();
    const exists = fs.existsSync(python);
    const systemPython = exists ? python : "python";

    const args = [scriptPath, modelName, framework];
    if (hardwareTarget) args.push(hardwareTarget);

    const { stdout, stderr } = await execFileAsync(systemPython, args);

    const output = stdout.trim();
    if (!output) {
      return res.status(500).json({
        error: "MCP compatibility check returned empty output.",
        stderr: stderr.trim() || undefined,
      });
    }

    try {
      const result = JSON.parse(output);
      return res.json(result);
    } catch {
      return res.status(500).json({
        error: "MCP compatibility check returned invalid JSON.",
        raw: output.slice(0, 500),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("MCP compatibility error:", err);
    return res.status(500).json({
      error: msg || "MCP compatibility check failed.",
    });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// ─── Vite / Static ────────────────────────────────────────────────────────────
/**
 * `pnpm start` runs the bundled `dist/server.cjs` and must serve static files.
 * Only `pnpm dev` (tsx server.ts) should use Vite middleware.
 * Do not rely solely on NODE_ENV — Windows/`pnpm start` often leave it unset.
 */
function shouldServeProductionStatic(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development") return false;
  if (process.env.OLIVE_DIST_DIR) return true;
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return entry.endsWith("/dist/server.cjs") || entry.endsWith("server.cjs");
}

async function startServer() {
  if (!shouldServeProductionStatic()) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ["**/.venv/**", "**/node_modules/**", "**/models/**", "**/.cache/**"],
        },
      },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
  } else {
    // Ensure downstream code and logs treat this as production.
    process.env.NODE_ENV = "production";
    const distPath = path.resolve(process.env.OLIVE_DIST_DIR ?? path.join(process.cwd(), "dist"));
    const indexHtml = path.join(distPath, "index.html");
    if (!fs.existsSync(indexHtml)) {
       
      console.error(`Production build not found at ${indexHtml}\nRun: pnpm build\nThen:  pnpm start`);
      process.exit(1);
    }
    app.use(express.static(distPath, { index: "index.html" }));
    // SPA fallback for client routes (Express 5-safe; avoid bare "*")
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    // eslint-disable-next-line no-console -- intentional server startup message
    console.log(`Serving UI from ${distPath}`);
  }

  app.listen(PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console -- intentional server startup message
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
}

process.on("SIGINT", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGINT] Cleaning up active jobs...");
  cleanupAllJobs();
  process.exit(0);
});

process.on("SIGTERM", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGTERM] Cleaning up active jobs...");
  cleanupAllJobs();
  process.exit(0);
});

process.on("exit", () => {
  cleanupAllJobs();
});

startServer();
