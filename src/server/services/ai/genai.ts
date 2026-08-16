/**
 * Built-in GenAI AI provider — ONNX Runtime GenAI sidecar.
 *
 * Zero-config local inference using a pre-optimized ONNX model downloaded
 * from S3/CloudFront. No external engine (Ollama/LM Studio) required.
 *
 * Architecture:
 *  1. On first call, ensures the GenAI venv is ready (installs onnxruntime-genai)
 *  2. Checks if the model is downloaded (from CDN/S3 cache)
 *  3. Spawns the Python inference sidecar as a long-running child process
 *  4. Sends prompts via stdin NDJSON, collects streamed tokens into final response
 *
 * The provider auto-detects availability when both:
 *  - The GenAI venv is ready (onnxruntime-genai importable)
 *  - The model is downloaded (.cache/genai-models/<model>/)
 *
 * Environment:
 *  GENAI_EXECUTION_PROVIDER — "cpu", "cuda", or "dml" (default: "cpu")
 */

import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import {
  isGenaiVenvReady,
  spawnSidecar,
  getActiveSidecar,
} from "../genai/venv.ts";
import { getReadyModelPath, DEFAULT_GENAI_MODEL } from "../genai/modelDownload.ts";

// ─── Call Implementation ──────────────────────────────────────────────────────

/**
 * Sends a chat request to the GenAI sidecar and collects the full response.
 *
 * The sidecar streams tokens via NDJSON. This function buffers them into a
 * single string to match the non-streaming provider interface.
 */
async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const modelPath = getReadyModelPath(cfg.model || DEFAULT_GENAI_MODEL);
  if (!modelPath) {
    throw new Error(
      "Built-in GenAI model not available. Download it first via Assistant → Settings → Download Built-in Model, " +
      "or set OLIVE_GENAI_CDN_URL / OLIVE_S3_PUBLIC_BUCKET for automatic download.",
    );
  }

  if (!isGenaiVenvReady()) {
    throw new Error(
      "GenAI Python environment not ready. Run the setup from Assistant → Settings → Setup Built-in Engine, " +
      "or ensure Python >=3.10 is installed and run `pnpm genai:setup`.",
    );
  }

  const ep = process.env.GENAI_EXECUTION_PROVIDER?.trim() || "cpu";
  // Only reuse a sidecar that was started for this exact model/EP; otherwise
  // spawnSidecar restarts it with the new configuration.
  const sidecar = getActiveSidecar(modelPath, ep) ?? spawnSidecar(modelPath, ep);

  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no text outside the JSON object.`
    : system;

  // Generate a unique request ID for correlating response tokens
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<string>((resolve, reject) => {
    const tokens: string[] = [];
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let unregisterTerminate: (() => void) | undefined;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("GenAI inference timed out after 120 seconds."));
      }
    }, 120_000);

    function cleanup() {
      clearTimeout(timeout);
      unsubscribe?.();
      unsubscribe = undefined;
      unregisterTerminate?.();
      unregisterTerminate = undefined;
    }

    function handleResponse(data: Record<string, unknown>) {
      if (data.id !== requestId) return;

      if (data.type === "token") {
        tokens.push(data.text as string);
      } else if (data.type === "done") {
        if (settled) return;
        settled = true;
        cleanup();
        const text = tokens.join("");
        if (!text.trim()) {
          reject(new Error("GenAI returned an empty response."));
        } else {
          resolve(text);
        }
      } else if (data.type === "error") {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`GenAI inference error: ${data.error ?? "unknown"}`));
      }
    }

    // Reject promptly if the sidecar dies or is replaced mid-request instead
    // of waiting for the timeout.
    unregisterTerminate = sidecar.onTerminate(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("GenAI sidecar terminated before responding."));
    });

    unsubscribe = sidecar.onResponse(handleResponse);

    // Send the inference request
    sidecar.send({
      id: requestId,
      system: sysText,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
    });
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

registerProvider({
  name: "genai",
  label: "Built-in (ONNX GenAI)",
  defaultModel: DEFAULT_GENAI_MODEL,
  // No env var triggers auto-detection — GenAI is opt-in via UI or explicit preference.
  // Users select it manually or it's pre-configured as the default for new installs.
  envVarNames: [],
  buildConfig: (_apiKey) => ({
    provider: "genai",
    apiKey: "local", // No API key needed — local inference
    model: DEFAULT_GENAI_MODEL,
  }),
  call,
  supportsJsonResponseFormat: false,
});
