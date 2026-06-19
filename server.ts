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
  mergeDetectedProviders,
  pickRecommendedProvider,
  type HardwareProbeResult,
} from "./src/lib/hardwareProbe.ts";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const VENV_DIR = path.join(process.cwd(), ".venv");
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

  // HuggingFace model source
  if (recipe.input_model?.config?.hf_config) {
    pkgs.push({ importName: "transformers", installArgs: ["transformers"], label: "transformers" });
    pkgs.push({ importName: "accelerate", installArgs: ["accelerate"], label: "accelerate" });
  }

  // PyTorch — CPU wheel or CUDA-specific wheel
  pkgs.push(isGpu
    ? { importName: "torch", installArgs: ["torch", "--index-url", `https://download.pytorch.org/whl/${cudaTag}`], label: `torch (${cudaTag})` }
    : { importName: "torch", installArgs: ["torch", "--index-url", "https://download.pytorch.org/whl/cpu"], label: "torch (CPU)" }
  );

  // ONNX Runtime
  if (passTypes.some(t => t.includes("Onnx") || t.includes("ORT") || t.includes("Transformers"))) {
    pkgs.push(isGpu
      ? { importName: "onnxruntime", installArgs: ["onnxruntime-gpu"], label: "onnxruntime-gpu" }
      : { importName: "onnxruntime", installArgs: ["onnxruntime"], label: "onnxruntime" }
    );
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

  // Deduplicate by importName
  const seen = new Set<string>();
  return pkgs.filter(p => seen.has(p.importName) ? false : (seen.add(p.importName), true));
}

/** Olive RunConfig parse + package scan without starting optimization. */
async function runOliveConfigPreflight(
  configPath: string,
  onLine: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const venvPython = getVenvPython();

  return new Promise((resolve) => {
    const proc = spawn(
      venvPython,
      ["-m", "olive", "run", "--config", configPath, "--list_required_packages"],
      { stdio: "pipe", env: process.env }
    );

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
  };

  const [nvidia, rocm] = await Promise.all([probeNvidiaGpus(), probeRocmGpus()]);

  let openvino: HardwareProbeResult["openvino"];
  let onnxRuntimeProviders: string[] | undefined;

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
  });

  return {
    probedAt: new Date().toISOString(),
    platform,
    nvidia,
    rocm,
    openvino,
    onnxRuntimeProviders,
    detectedProviders,
    recommendedProvider: pickRecommendedProvider(detectedProviders),
    notes,
  };
}

let hardwareProbeCache: { at: number; result: HardwareProbeResult } | null = null;
const HARDWARE_PROBE_CACHE_MS = 30_000;

app.get("/api/system/hardware-probe", async (req, res) => {
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const now = Date.now();
    if (!refresh && hardwareProbeCache && now - hardwareProbeCache.at < HARDWARE_PROBE_CACHE_MS) {
      return res.json(hardwareProbeCache.result);
    }
    const result = await probeSystemHardware();
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

    // Write recipe to a temp file
    const tmpFile = path.join(os.tmpdir(), `olive_recipe_${jobId}.json`);
    fs.writeFileSync(tmpFile, recipeJson, "utf-8");
    pushLog(job, `[info] Recipe written to ${tmpFile}`);

    pushLog(job, "[preflight] Validating Olive RunConfig...");
    const preflight = await runOliveConfigPreflight(tmpFile, (line) => pushLog(job, line)).catch((err) => ({
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
    const venvPython = getVenvPython();
    const hfEnv = runtimeHfToken ? { HF_TOKEN: runtimeHfToken } : {};
    const proc = spawn(venvPython, ["-m", "olive", "run", "--config", tmpFile], {
      stdio: "pipe",
      env: { ...process.env, ...hfEnv },
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

  const cleanState = {
    modelSource: state.modelSource,
    hfModelId: state.hfModelId || "(not set)",
    ihvProvider: state.ihvProvider,
    cudaVersion: state.cudaVersion || "auto",
    passes: state.passes,
  };

  const system = `You are "Olive Optimization Advisor", an expert Microsoft Olive compiler and hardware co-design specialist. Analyze the pipeline configuration and give specific, actionable advice.

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
    const text = await callAI(system, [{ role: "user", content: `Pipeline:\n${JSON.stringify(cleanState, null, 2)}` }], true);
    return res.json(parseJsonFromAiResponse(text));
  } catch (err: any) {
    console.error("AI Analyze Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  const { message, context, chatHistory } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message." });

  const ctx = context || {};
  const activePasses = Object.entries(ctx.passes || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(", ") || "none";

  const contextBlock = ctx.provider
    ? `\nCurrent pipeline:\n- Model: ${ctx.modelId || "(not set)"}\n- Hardware: ${ctx.provider}\n- CUDA: ${ctx.cudaVersion || "auto"}\n- Active passes: ${activePasses}\n- Quantization: ${ctx.passes?.quantization ? `${ctx.passes.quantMethod} (${ctx.passes.quantPrecision})` : "disabled"}\n- Pruning: ${ctx.passes?.pruning ? `${ctx.passes.pruningMethod} (${Math.round((ctx.passes.pruningSparsity ?? 0.5) * 100)}% sparse)` : "disabled"}\n- PEFT: ${ctx.passes?.peft ? ctx.passes.peftMethod : "disabled"}`
    : "";

  const system = `You are "Olive AI Assistant", an expert Microsoft Olive compiler specialist. Deep expertise in quantization (AWQ, GPTQ, PTQ, QAT, SmoothQuant), pruning (magnitude, SparseGPT, Wanda), PEFT (LoRA, QLoRA), ONNX Runtime, and hardware execution providers (CUDA, TensorRT, DirectML, OpenVINO, QNN/Snapdragon). Give professional, accurate, concise answers. When relevant, provide Olive config snippets or CLI commands.${contextBlock}`;

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
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
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
