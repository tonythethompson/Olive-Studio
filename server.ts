import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;
const VENV_DIR = path.join(process.cwd(), ".venv");
const execFileAsync = promisify(execFile);

// ─── Gemini Client ────────────────────────────────────────────────────────────
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    })
  : null;

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

// ─── POST /api/olive/run ──────────────────────────────────────────────────────
app.post("/api/olive/run", async (req, res) => {
  const { recipeJson } = req.body as { recipeJson?: string };
  if (!recipeJson) {
    return res.status(400).json({ error: "Missing recipeJson in request body." });
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
      return;
    }

    // Write recipe to a temp file
    const tmpFile = path.join(os.tmpdir(), `olive_recipe_${jobId}.json`);
    fs.writeFileSync(tmpFile, recipeJson, "utf-8");
    pushLog(job, `[info] Recipe written to ${tmpFile}`);
    pushLog(job, `[info] Starting Olive optimization run...`);

    job.status = "running";
    const venvPython = getVenvPython();
    const proc = spawn(venvPython, ["-m", "olive", "run", "--config", tmpFile], {
      stdio: "pipe",
      env: { ...process.env },
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

// ─── POST /api/gemini/validate ────────────────────────────────────────────────
app.post("/api/gemini/validate", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable validation.",
    });
  }

  const { recipeJson, ihvProvider } = req.body;
  if (!recipeJson) {
    return res.status(400).json({ error: "No recipe JSON provided for validation." });
  }

  try {
    const prompt = `Validate the following Microsoft Olive JSON recipe configuration being run on hardware platform '${ihvProvider || "CPUExecutionProvider"}'.
Detect any potential execution failures, suboptimal settings, accuracy/precision collapses, or compatibility issues.

Recipe JSON:
${recipeJson}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert MS Olive compiler engineer. Output strict valid structural feedback matching the requested schema. Be constructive and specific.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: { type: Type.BOOLEAN, description: "Whether the recipe structure is valid" },
            severity: { type: Type.STRING, description: "'success' if perfect, 'warning' if issues detected but might run, 'error' if it will fail execution" },
            summary: { type: Type.STRING, description: "A one or two sentence high-level assessment of the recipe" },
            issues: {
              type: Type.ARRAY,
              description: "List of issues, conflicts, or suboptimal points detected",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "One of: 'critical', 'warning', 'info'" },
                  title: { type: Type.STRING, description: "Short summary of the issue" },
                  explanation: { type: Type.STRING, description: "Detailed explanation of why it occurs and its impact" },
                  fix: { type: Type.STRING, description: "Concrete instruction or code snippet to resolve this" }
                },
                required: ["type", "title", "explanation"]
              }
            },
            suggestions: {
              type: Type.ARRAY,
              description: "General best-practice recommendations for this optimization pathway",
              items: { type: Type.STRING }
            }
          },
          required: ["valid", "severity", "summary", "issues", "suggestions"]
        }
      }
    });

    const text = response.text || "{}";
    const data = JSON.parse(text.trim());
    return res.json(data);
  } catch (error: any) {
    console.error("Gemini Validation Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini validation.",
    });
  }
});

// ─── POST /api/gemini/analyze-state ──────────────────────────────────────────
app.post("/api/gemini/analyze-state", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable optimization analysis.",
    });
  }

  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: "No UI state provided for optimization analysis." });
  }

  try {
    const prompt = `Analyze the following Microsoft Olive optimization pipeline configuration state and provide automated suggestions, compatibility warnings, and performance improvement opportunities.

Current Optimization State:
${JSON.stringify(state, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        systemInstruction: `You are "Olive Optimization Advisor", a compiler hardware co-design expert.
Your goal is to inspect the optimization choices (conversion, quantization, pruning, PEFT fine-tuning, transformer optimizations) and the target Hardware, and provide a set of actionable advice.
Output valid JSON adhering to this schema:
{
  "score": <number from 0 to 100 assessing the optimization efficiency>,
  "level": "Optimized" | "Suboptimal" | "Unoptimized" | "Critical Mismatch",
  "summary": "<short high-level summary of the state>",
  "suggestions": [
    {
      "title": "<short title of recommendation>",
      "description": "<why it helps and detailed instructions>",
      "impact": "High" | "Medium" | "Low",
      "type": "warning" | "success" | "suggestion" | "info",
      "autofix": {
         "pass": "quantization" | "ihvProvider" | "onnxTransforms" | "pruning" | "peft",
         "value": "<recommended value, if boolean then 'true' or 'false', if provider e.g. 'CUDAExecutionProvider' or 'TensorrtExecutionProvider'>"
      }
    }
  ]
}`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            level: { type: Type.STRING },
            summary: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  impact: { type: Type.STRING },
                  type: { type: Type.STRING },
                  autofix: {
                    type: Type.OBJECT,
                    properties: {
                      pass: { type: Type.STRING },
                      value: { type: Type.STRING }
                    },
                    required: ["pass", "value"]
                  }
                },
                required: ["title", "description", "impact", "type"]
              }
            }
          },
          required: ["score", "level", "summary", "suggestions"]
        }
      }
    });

    const text = response.text || "{}";
    const data = JSON.parse(text.trim());
    return res.json(data);
  } catch (error: any) {
    console.error("Gemini State Analysis Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini state analysis.",
    });
  }
});

// ─── POST /api/gemini/chat ────────────────────────────────────────────────────
app.post("/api/gemini/chat", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable assistant chat.",
    });
  }

  const { message, recipeJson, chatHistory, ihvProvider } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing message parameter in request." });
  }

  try {
    const formattedHistory = (chatHistory || []).map((msg: any) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const systemInstruction = `You are "Olive AI Assistant", an expert AI compiler specialist with deep expertise in Microsoft Olive, model optimizations, quantization (AWQ, GPTQ, SmoothQuant, PTQ, QAT), pruning, PEFT fine-tuning (LoRA, QLoRA), ONNX runtime, and DirectML / hardware execution providers.
Provide professional, accurate, and concise answers.
You can refer to the user's current recipe configuration if needed to provide tailored code blocks or explanations.
Current hardware target platform: ${ihvProvider || "CPUExecutionProvider"}.
Current recipe configuration JSON:
${recipeJson || "No active recipe selected."}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        ...formattedHistory,
        { role: "user", parts: [{ text: message }] }
      ],
      config: { systemInstruction }
    });

    const text = response.text || "I was unable to formulate a response.";
    return res.json({ text });
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini processing.",
    });
  }
});

// ─── Vite / Static ────────────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
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
