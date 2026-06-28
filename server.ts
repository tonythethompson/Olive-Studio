import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";

import { validateOliveRecipeStructure } from "./src/lib/oliveRecipeSchema.ts";
import { parseJsonFromAiResponse, readEnvApiKey } from "./src/lib/aiResponse.ts";
import {
  buildAiWorkspaceContext,
  formatAiWorkspaceContextForPrompt,
} from "./src/lib/aiWorkspaceContext.ts";
import {
  mergeDetectedProviders,
  pickRecommendedProvider,
  type HardwareProbeResult,
} from "./src/lib/hardwareProbe.ts";
import {
  enrichRecipeMemoryOffloadForRun,
  recipeUsesMemoryOffload,
} from "./src/lib/memoryOffload.ts";
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
import {
  tensorrtRtxInstallArgs,
  tensorrtRtxLabel,
} from "./src/lib/tensorrtRtxDeps.ts";
import type { IHVProvider } from "./src/types.ts";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const VENV_DIR = path.join(process.cwd(), ".venv");
const OLIVE_GPU_LAUNCHER = path.join(process.cwd(), "scripts", "olive_gpu_launcher.py");
const execFileAsync = promisify(execFile);

// ─── AI Provider Config ───────────────────────────────────────────────────────

interface ProviderConfig {
  provider: "gemini" | "openai" | "anthropic" | "mistral" | "openai-compat";
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ALLOWED_AI_PROVIDERS = new Set<ProviderConfig["provider"]>([
  "gemini",
  "openai",
  "anthropic",
  "mistral",
  "openai-compat",
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
  return null;
}

let runtimeAiProvider: ProviderConfig | null = null;

function getAiProvider(): ProviderConfig | null {
  return runtimeAiProvider ?? detectEnvProvider();
}

async function callGemini(cfg: ProviderConfig, system: string, messages: AIChatMessage[], wantJson: boolean): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const body: any = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (wantJson) body.generationConfig = { responseMimeType: "application/json" };
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Gemini ${resp.status}: ${(err as any)?.error?.message ?? resp.statusText}`);
  }
  const data = await resp.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

async function callOpenAICompat(cfg: ProviderConfig, system: string, messages: AIChatMessage[], wantJson: boolean): Promise<string> {
  const base = cfg.baseUrl ?? (cfg.provider === "mistral" ? "https://api.mistral.ai/v1" : "https://api.openai.com/v1");
  const body: any = {
    model: cfg.model,
    messages: [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))],
  };
  if (wantJson) body.response_format = { type: "json_object" };
  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`${cfg.provider} ${resp.status}: ${(err as any)?.error?.message ?? resp.statusText}`);
  }
  const data = await resp.json() as any;
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(cfg: ProviderConfig, system: string, messages: AIChatMessage[], wantJson: boolean): Promise<string> {
  const sysText = wantJson ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no text outside the JSON object.` : system;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system: sysText, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Anthropic ${resp.status}: ${(err as any)?.error?.message ?? resp.statusText}`);
  }
  const data = await resp.json() as any;
  return data?.content?.[0]?.text ?? "";
}

async function callAI(system: string, messages: AIChatMessage[], wantJson = false): Promise<string> {
  const cfg = getAiProvider();
  if (!cfg) throw new Error("No AI provider configured. Add an API key in the AI Copilot settings or set GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / MISTRAL_API_KEY in your environment.");
  switch (cfg.provider) {
    case "gemini": return callGemini(cfg, system, messages, wantJson);
    case "anthropic": return callAnthropic(cfg, system, messages, wantJson);
    case "openai":
    case "mistral":
    case "openai-compat": return callOpenAICompat(cfg, system, messages, wantJson);
    default: throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}

// ─── Olive Job Registry ───────────────────────────────────────────────────────
interface OliveJob {
  id: string;
  status: "setting_up" | "running" | "completed" | "failed";
  exitCode: number | null;
  logs: string[];
  // SSE subscriber queues: each subscriber is a function that receives new log lines
  subscribers: Array<(line: string) => void>;
  process: ReturnType<typeof spawn> | null;
}

const jobRegistry = new Map<string, OliveJob>();

// In-memory only — never written to disk or logged
let runtimeHfToken: string | null = null;

function pushLog(job: OliveJob, line: string) {
  job.logs.push(line);
  for (const sub of job.subscribers) {
    try { sub(line); } catch { /* subscriber gone */ }
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
    } catch { /* not found */ }
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
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`venv creation failed (exit ${code})`))));
    });
    onLine("[setup] Virtual environment created.");
  }

  // Check if olive is installed
  const venvPython = getVenvPython();
  let oliveInstalled = false;
  try {
    await execFileAsync(venvPython, ["-c", "import olive"]);
    oliveInstalled = true;
  } catch { /* not installed */ }

  if (!oliveInstalled) {
    onLine("[setup] Installing olive-ai (this may take a few minutes)...");
    await new Promise<void>((resolve, reject) => {
      const pip = spawn(getVenvPip(), ["install", "olive-ai"], { stdio: "pipe" });
      pip.stdout.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.stderr.on("data", (d) => onLine("[setup] " + d.toString().trim()));
      pip.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pip install failed (exit ${code})`))));
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
      pip.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`requests install failed (exit ${code})`))));
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
  } catch (error: any) {
    console.error("GitHub raw proxy error:", error);
    return res.status(502).json({
      error: error?.message || "Failed to fetch recipe from GitHub.",
    });
  }
});

// ─── Recipe Dependency Inference ──────────────────────────────────────────────

interface PkgDef {
  importName: string;
  installArgs: string[];
  label: string;
}

function inferRequiredPackages(recipe: any, cudaTag: string): PkgDef[] {
  const pkgs: PkgDef[] = [];
  const passes = Object.values(recipe.passes ?? {}) as any[];
  const passTypes = passes.map((p: any) => p?.type ?? "");
  const isGpu = cudaTag !== "cpu";
  const inputType = String(recipe.input_model?.type ?? "");
  const inputConfig = recipe.input_model?.config ?? {};

  // HuggingFace model source
  if (inputConfig.hf_config || inputType === "HfModel" || inputType.toLowerCase().includes("hf")) {
    pkgs.push({ importName: "transformers", installArgs: ["transformers"], label: "transformers" });
    pkgs.push({ importName: "accelerate", installArgs: ["accelerate"], label: "accelerate" });
  }

  if (recipeUsesMemoryOffload(recipe)) {
    pkgs.push({ importName: "accelerate", installArgs: ["accelerate"], label: "accelerate" });
  }

  // PyTorch — CPU wheel or CUDA-specific wheel
  pkgs.push(isGpu
    ? { importName: "torch", installArgs: ["torch", "--index-url", `https://download.pytorch.org/whl/${cudaTag}`], label: `torch (${cudaTag})` }
    : { importName: "torch", installArgs: ["torch", "--index-url", "https://download.pytorch.org/whl/cpu"], label: "torch (CPU)" }
  );

  // ONNX Runtime — pin CUDA 12 build (1.27+ needs cu13 wheels not yet on PyPI)
  if (passTypes.some(t => t.includes("Onnx") || t.includes("ORT") || t.includes("Transformers"))) {
    pkgs.push(isGpu
      ? { importName: "onnxruntime", installArgs: pinnedOrtGpuInstallArgs(), label: pinnedOrtGpuLabel() }
      : { importName: "onnxruntime", installArgs: ["onnxruntime"], label: "onnxruntime" }
    );
  }

  if (isGpu) {
    for (const pkg of CUDA12_RUNTIME_PACKAGES) {
      pkgs.push(pkg);
    }
  }

  // OpenVINO
  if (passTypes.some(t => t.includes("OpenVINO"))) {
    pkgs.push({ importName: "openvino", installArgs: ["openvino"], label: "openvino" });
    pkgs.push({ importName: "optimum", installArgs: ["optimum[openvino]"], label: "optimum[openvino]" });
  }

  // PEFT (LoRA / QLoRA)
  if (passTypes.some(t => t === "LoRA" || t === "QLoRA")) {
    pkgs.push({ importName: "peft", installArgs: ["peft"], label: "peft" });
  }

  // AutoAWQ
  if (passTypes.some(t => t.toLowerCase().includes("awq"))) {
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
  return pkgs.filter(p => seen.has(p.importName) ? false : (seen.add(p.importName), true));
}

function getRecipeIhvProvider(recipe: any): IHVProvider {
  const system = recipe?.systems?.local_system;
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

function resolveOliveCommand(provider: IHVProvider, configPath: string, listPackages: boolean): {
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
  base: NodeJS.ProcessEnv
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
  provider: IHVProvider = "CUDAExecutionProvider"
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
  env: NodeJS.ProcessEnv = process.env
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
    const detail = message.includes("fail:")
      ? message.split("fail:").pop()?.trim()
      : message;
    return { loadable: false, detail: detail || "TensorRT provider library failed to load" };
  }
}

async function ensureTensorRt(
  onLine: (line: string) => void
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
      `[deps] TensorRT ${installed} is incompatible with stable onnxruntime-gpu (needs ${PINNED_TENSORRT_VERSION} / nvinfer_10) — reinstalling...`
    );
  } else if (!installed) {
    onLine(
      `[deps] Installing ${pinnedTensorRtLabel()} for TensorRT EP (large download, may take several minutes)...`
    );
  } else {
    onLine(`[deps] TensorRT ${installed} present but EP not loadable — reinstalling pinned runtime...`);
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...pinnedTensorRtInstallArgs()], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`pip install ${pinnedTensorRtLabel()} failed (exit ${code})`))
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
    const { stdout } = await execFileAsync(python, ["-c", "import tensorrt_rtx; print(tensorrt_rtx.__version__)"]);
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
  env: NodeJS.ProcessEnv = process.env
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
    const detail = message.includes("fail:")
      ? message.split("fail:").pop()?.trim()
      : message;
    return { loadable: false, detail: detail || "TensorRT RTX runtime failed to load" };
  }
}

async function ensureTensorRtRtx(
  onLine: (line: string) => void
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
      code === 0 ? resolve() : reject(new Error(`pip install ${tensorrtRtxLabel()} failed (exit ${code})`))
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
  onLine: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  for (const pkg of pkgs) {
    // Torch: check installed CUDA version matches what we need (GPU vs CPU)
    if (pkg.importName === "torch") {
      try {
        const { stdout } = await execFileAsync(venvPython, ["-c", "import torch; print(torch.version.cuda or 'NONE')"]);
        const installedCuda = stdout.trim();
        const needsGpu = !pkg.installArgs.includes("cpu");
        const hasGpu = installedCuda !== "NONE" && installedCuda !== "";
        if (needsGpu === hasGpu) {
          onLine(`[deps] torch already installed (CUDA: ${hasGpu ? installedCuda : "none/CPU"}) ✓`);
          continue;
        }
        onLine(`[deps] torch CUDA mismatch (have ${hasGpu ? installedCuda : "CPU"}, need ${needsGpu ? "GPU" : "CPU"}) — reinstalling...`);
      } catch { /* not installed, fall through */ }
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
        onLine(`[deps] ${pkg.label} version ${installed} incompatible — installing ${PINNED_TENSORRT_VERSION}...`);
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
      } catch { /* not installed */ }
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
          onLine(`[deps] onnxruntime-gpu ${installed} installed — need ${expected ?? "pinned build"}, reinstalling...`);
        }
      } catch { /* not installed */ }
    } else {
      try {
        await execFileAsync(venvPython, ["-c", `import ${pkg.importName}`]);
        onLine(`[deps] ${pkg.label} already installed ✓`);
        continue;
      } catch { /* not installed */ }
    }

    onLine(`[deps] Installing ${pkg.label}...`);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pip, ["install", ...pkg.installArgs], { stdio: "pipe" });
      proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.on("close", (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`pip install ${pkg.label} failed (exit ${code})`))
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

async function detectCudaTag(
  preferred: string,
  onLine: (line: string) => void
): Promise<string> {
  if (preferred && preferred !== "auto") {
    onLine(`[deps] CUDA version override: ${preferred}`);
    return preferred;
  }

  // Check existing torch in venv first — avoids reinstall when already correct
  const venvPython = getVenvPython();
  try {
    const { stdout } = await execFileAsync(venvPython, ["-c", "import torch; print(torch.version.cuda or 'NONE')"]);
    const existing = stdout.trim();
    if (existing !== "NONE" && existing) {
      const parts = existing.split(".");
      const tag = pickCudaTag(parseInt(parts[0]), parseInt(parts[1] ?? "0"));
      onLine(`[deps] Existing torch CUDA ${existing} → using ${tag}`);
      return tag;
    }
  } catch { /* torch not installed */ }

  // Auto-detect via nvidia-smi
  try {
    const { stdout } = await execFileAsync("nvidia-smi", []);
    const parsed = parseCudaVersionFromNvidiaSmi(stdout);
    if (parsed) {
      onLine(`[deps] nvidia-smi detected CUDA ${parsed.cudaVersion} → ${parsed.cudaTag}`);
      return parsed.cudaTag;
    }
  } catch { /* no GPU or nvidia-smi not in PATH */ }

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
    } catch { /* ignore */ }

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
  python: string
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
  } catch { /* onnxruntime not installed */ }

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
        `ONNX Runtime providers probed via ${python === venvPython ? ".venv Python" : "system Python"}.`
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
    notes.push(
      `TensorRT RTX runtime verified${tensorRtRtx.version ? ` (${tensorRtRtx.version})` : ""}.`,
    );
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
      notes.push("NVIDIA GPU detected but ONNX Runtime CUDA EP is not installed in Python (try onnxruntime-gpu in .venv).");
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
    process: null,
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
        try { sub("__DONE__"); } catch { /* gone */ }
      }
      return;
    }

    // Detect CUDA version, then infer and install recipe-specific dependencies
    let recipeObj: any = {};
    try { recipeObj = JSON.parse(recipeJson); } catch { /* malformed — olive will catch it */ }

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
        try { sub("__DONE__"); } catch { /* gone */ }
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
          try { sub("__DONE__"); } catch { /* gone */ }
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
          try { sub("__DONE__"); } catch { /* gone */ }
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
      targetProvider
    ).catch((err) => ({
      ok: false,
      error: String(err.message),
    }));
    if (!preflight.ok) {
      pushLog(job, `[error] Preflight failed: ${preflight.error}`);
      job.status = "failed";
      job.exitCode = 1;
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      for (const sub of job.subscribers) {
        try { sub("__DONE__"); } catch { /* gone */ }
      }
      return;
    }

    pushLog(job, `[info] Starting Olive optimization run...`);

    job.status = "running";
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
      pushLog(job, `[done] Olive process exited with code ${code}.`);
      // Cleanup temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      // Signal end to all subscribers
      for (const sub of job.subscribers) {
        try { sub("__DONE__"); } catch { /* gone */ }
      }
    });

    proc.on("error", (err) => {
      pushLog(job, `[error] Failed to start Olive process: ${err.message}`);
      job.status = "failed";
      job.exitCode = 1;
      for (const sub of job.subscribers) {
        try { sub("__DONE__"); } catch { /* gone */ }
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
      res.write("event: done\ndata: {}\n\n");
      res.end();
    } else {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  };

  // Replay existing logs
  for (const line of job.logs) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  // If already finished, send done immediately
  if (job.status === "completed" || job.status === "failed") {
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  // Subscribe to new lines
  job.subscribers.push(send);

  req.on("close", () => {
    const idx = job.subscribers.indexOf(send);
    if (idx !== -1) job.subscribers.splice(idx, 1);
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

// ─── DELETE /api/olive/cancel/:jobId ──────────────────────────────────────────
app.delete("/api/olive/cancel/:jobId", (req, res) => {
  const job = jobRegistry.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.process && job.status === "running") {
    job.process.kill("SIGTERM");
    job.status = "failed";
    job.exitCode = -1;
    pushLog(job, "[info] Job cancelled by user.");
  }
  res.json({ ok: true });
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
  const { provider, apiKey: key, model, baseUrl } = req.body as {
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
  return res.json({ ok: true, source: "user", provider: runtimeAiProvider.provider, model: runtimeAiProvider.model });
});

app.delete("/api/ai/provider", (_req, res) => {
  runtimeAiProvider = null;
  return res.json({ ok: true });
});

// ─── POST /api/ai/validate ────────────────────────────────────────────────────
app.post("/api/ai/validate", async (req, res) => {
  const { recipeJson, ihvProvider } = req.body;
  if (!recipeJson) return res.status(400).json({ error: "No recipe JSON provided." });

  const system = `You are an expert Microsoft Olive compiler engineer. Analyze the recipe and detect execution failures, suboptimal settings, or compatibility issues.
Respond with ONLY valid JSON:
{"valid":true|false,"severity":"success"|"warning"|"error","summary":"<1-2 sentences>","issues":[{"type":"critical"|"warning"|"info","title":"<short>","explanation":"<detail>","fix":"<action>"}],"suggestions":["<tip>"]}`;

  try {
    const text = await callAI(system, [{
      role: "user",
      content: `Validate this Olive recipe for hardware '${ihvProvider || "CPUExecutionProvider"}':\n\n${recipeJson}`,
    }], true);
    return res.json(parseJsonFromAiResponse(text));
  } catch (err: any) {
    console.error("AI Validate Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/analyze-state ──────────────────────────────────────────────
app.post("/api/ai/analyze-state", async (req, res) => {
  const { state } = req.body;
  if (!state) return res.status(400).json({ error: "No state provided." });

  const workspace = buildAiWorkspaceContext(state);

  const system = `You are "Olive Optimization Advisor", an expert Microsoft Olive compiler and hardware co-design specialist. Analyze the pipeline configuration and give specific, actionable advice.

${formatAiWorkspaceContextForPrompt(workspace)}

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
    const text = await callAI(system, [{ role: "user", content: `Pipeline JSON:\n${JSON.stringify(workspace, null, 2)}` }], true);
    return res.json(parseJsonFromAiResponse(text));
  } catch (err: any) {
    console.error("AI Analyze Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  const { message, workspaceContext, state, chatHistory } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message." });

  const workspace = workspaceContext ?? (state ? buildAiWorkspaceContext(state) : null);

  const contextBlock = workspace
    ? `\n\n${formatAiWorkspaceContextForPrompt(workspace)}`
    : "";

  const system = `You are "Olive AI Assistant", an expert Microsoft Olive compiler specialist. Deep expertise in quantization (AWQ, GPTQ, PTQ, QAT, SmoothQuant), pruning (magnitude, SparseGPT, Wanda), PEFT (LoRA, QLoRA), ONNX Runtime, and hardware execution providers (CUDA, TensorRT, DirectML, OpenVINO, QNN/Snapdragon). Give professional, accurate, concise answers. When relevant, provide Olive config snippets or CLI commands. Treat the workspace block below as the user's live pipeline — do not invent a different model, provider, or pass list.${contextBlock}`;

  const history: AIChatMessage[] = (chatHistory || []).map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  try {
    const text = await callAI(system, [...history, { role: "user", content: message }], false);
    return res.json({ text: text || "No response generated." });
  } catch (err: any) {
    console.error("AI Chat Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// ─── Vite / Static ────────────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
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
    const distPath = process.env.OLIVE_DIST_DIR ?? path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
