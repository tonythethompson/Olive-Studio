/**
 * Structured assistant chat actions that the UI can Apply into pipelineStore.
 * Patches are allowlisted so the model cannot invent arbitrary UIState keys.
 */
import type { IHVProvider, ModelSource, UIState } from "@/types";
import { parseJsonFromAiResponse } from "@/lib/aiResponse";

const IHV_PROVIDERS = new Set<string>([
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "OpenVINOExecutionProvider",
  "QNNExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
]);

const CUDA_VERSIONS = new Set(["auto", "cpu", "cu118", "cu121", "cu124", "cu126", "cu128"]);
const MODEL_SOURCES = new Set(["huggingface", "local", "azure"]);
const MEMORY_OFFLOAD = new Set(["gpu_only", "auto"]);

const PASS_BOOL_KEYS = new Set([
  "conversion",
  "quantization",
  "pruning",
  "splitting",
  "onnxTransforms",
  "peft",
  "diffusionLora",
  "gptqDescAct",
  "awqSym",
]);

const PASS_STRING_ENUMS: Record<string, Set<string>> = {
  conversionSourceFormat: new Set(["pytorch", "tensorflow", "jax"]),
  conversionFormat: new Set(["onnx", "openvino", "qnn", "tensorrt"]),
  conversionInputTargetTypes: new Set(), // free string (dtype list)
  quantMethod: new Set(["ptq", "awq", "qat", "gptq", "hqq", "rtn", "spinquant", "quarot"]),
  quantPrecision: new Set(["int4", "int8", "fp16"]),
  quantPreset: new Set(), // free string
  pruningType: new Set(["structured", "unstructured"]),
  pruningMethod: new Set(["magnitude", "sparsegpt", "wanda"]),
  pruningCriteria: new Set(["l1_norm", "l2_norm"]),
  peftMethod: new Set(["lora", "qlora"]),
  qatQuantPrecision: new Set(["int4", "int8"]),
  qatCalibrateMethod: new Set(["minmax", "percentile", "entropy"]),
};

const PASS_NUMBER_KEYS = new Set([
  "conversionOpset",
  "gptqBlockSize",
  "gptqGroupSize",
  "awqGroupSize",
  "awqDampPercent",
  "qatCalibrateSteps",
  "pruningSparsity",
]);

export type ChatActionPatch = {
  ihvProvider?: IHVProvider;
  cudaVersion?: UIState["cudaVersion"];
  memoryOffload?: UIState["memoryOffload"];
  modelSource?: ModelSource;
  hfModelId?: string;
  hfDataset?: string;
  cacheDir?: string;
  passes?: Partial<UIState["passes"]>;
};

export type ChatAction = {
  id: string;
  title: string;
  description?: string;
  patch: ChatActionPatch;
};

export type ChatStructuredReply = {
  reply: string;
  actions: ChatAction[];
};

/**
 * Determines whether a value is a non-null object with string keys.
 *
 * @param v - The value to inspect
 * @returns `true` if `v` is a non-null, non-array object, `false` otherwise.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const PASS_NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  conversionOpset: { min: 13, max: 21 },
  gptqBlockSize: { min: 32, max: 4096 },
  gptqGroupSize: { min: 32, max: 4096 },
  awqGroupSize: { min: 32, max: 4096 },
  awqDampPercent: { min: 0, max: 1 },
  qatCalibrateSteps: { min: 1, max: 10_000 },
  pruningSparsity: { min: 0.01, max: 0.99 },
};

/**
 * Determines whether a numeric pass value falls within its configured range.
 *
 * @param key - The pass field whose range should be checked
 * @param value - The numeric pass value to validate
 * @returns `true` if the pass field is recognized and the value is within its allowed range, `false` otherwise
 */
function isAllowedPassNumber(key: string, value: number): boolean {
  const range = PASS_NUMBER_RANGES[key];
  if (!range) return false;
  return value >= range.min && value <= range.max;
}

/**
 * Filters pass settings to supported fields and allowed values.
 *
 * @param raw - The untrusted pass settings to sanitize
 * @returns The valid pass settings, or `undefined` when none are valid
 */
function sanitizePasses(raw: unknown): Partial<UIState["passes"]> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<UIState["passes"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (PASS_BOOL_KEYS.has(key) && typeof value === "boolean") {
      (out as Record<string, unknown>)[key] = value;
      continue;
    }
    if (PASS_NUMBER_KEYS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      if (isAllowedPassNumber(key, value)) {
        (out as Record<string, unknown>)[key] = value;
      }
      continue;
    }
    if (key in PASS_STRING_ENUMS && typeof value === "string") {
      const allowed = PASS_STRING_ENUMS[key]!;
      if (allowed.size === 0 || allowed.has(value)) {
        (out as Record<string, unknown>)[key] = value;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitizes a proposed chat action patch by retaining only recognized and valid fields.
 *
 * @param raw - The untrusted patch value to sanitize
 * @returns A sanitized patch, or `null` when no valid fields are present
 */
export function sanitizeChatActionPatch(raw: unknown): ChatActionPatch | null {
  if (!isRecord(raw)) return null;
  const patch: ChatActionPatch = {};

  if (typeof raw.ihvProvider === "string" && IHV_PROVIDERS.has(raw.ihvProvider)) {
    patch.ihvProvider = raw.ihvProvider as IHVProvider;
  }
  if (typeof raw.cudaVersion === "string" && CUDA_VERSIONS.has(raw.cudaVersion)) {
    patch.cudaVersion = raw.cudaVersion as UIState["cudaVersion"];
  }
  if (typeof raw.memoryOffload === "string" && MEMORY_OFFLOAD.has(raw.memoryOffload)) {
    patch.memoryOffload = raw.memoryOffload as UIState["memoryOffload"];
  }
  if (typeof raw.modelSource === "string" && MODEL_SOURCES.has(raw.modelSource)) {
    patch.modelSource = raw.modelSource as ModelSource;
  }
  if (typeof raw.hfModelId === "string" && raw.hfModelId.trim()) {
    patch.hfModelId = raw.hfModelId.trim().slice(0, 256);
  }
  if (typeof raw.hfDataset === "string") {
    patch.hfDataset = raw.hfDataset.trim().slice(0, 256);
  }
  if (typeof raw.cacheDir === "string" && raw.cacheDir.trim()) {
    patch.cacheDir = raw.cacheDir.trim().slice(0, 512);
  }
  const passes = sanitizePasses(raw.passes);
  if (passes) patch.passes = passes;

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Converts a sanitized chat patch into a partial UI state, preserving related toggle consistency.
 *
 * @param state - The current UI state used to merge pass updates
 * @param patch - The sanitized patch to apply
 * @returns A partial UI state containing the patch updates
 */
export function chatPatchToUiState(state: UIState, patch: ChatActionPatch): Partial<UIState> {
  const next: Partial<UIState> = {};
  if (patch.ihvProvider) next.ihvProvider = patch.ihvProvider;
  if (patch.cudaVersion) next.cudaVersion = patch.cudaVersion;
  if (patch.memoryOffload) next.memoryOffload = patch.memoryOffload;
  if (patch.modelSource) next.modelSource = patch.modelSource;
  if (patch.hfModelId !== undefined) next.hfModelId = patch.hfModelId;
  if (patch.hfDataset !== undefined) next.hfDataset = patch.hfDataset;
  if (patch.cacheDir !== undefined) next.cacheDir = patch.cacheDir;
  if (patch.passes) {
    const merged: UIState["passes"] = { ...state.passes, ...patch.passes };
    // Keep toggles consistent with method/precision changes.
    if (patch.passes.quantMethod || patch.passes.quantPrecision) {
      merged.quantization = true;
    }
    if (patch.passes.quantMethod === "awq") {
      merged.pruning = false;
    }
    if (patch.passes.peftMethod) {
      merged.peft = true;
    }
    if (patch.passes.conversionFormat || patch.passes.conversionOpset) {
      merged.conversion = true;
    }
    next.passes = merged;
  }
  return next;
}

/**
 * Creates a concise textual summary of the configured chat action patch.
 *
 * @returns A comma-separated description of the patch values.
 */
export function summarizeChatPatch(patch: ChatActionPatch): string {
  const bits: string[] = [];
  if (patch.ihvProvider) bits.push(`EP=${patch.ihvProvider}`);
  if (patch.cudaVersion) bits.push(`cuda=${patch.cudaVersion}`);
  if (patch.memoryOffload) bits.push(`offload=${patch.memoryOffload}`);
  if (patch.hfModelId) bits.push(`model=${patch.hfModelId}`);
  if (patch.passes) {
    for (const [k, v] of Object.entries(patch.passes)) {
      bits.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return bits.join(", ");
}

/**
 * Normalizes a quantization precision label to a supported precision value.
 *
 * @param value - The precision label to normalize
 * @returns The normalized precision, or `null` when the label is unsupported
 */
function normalizeLooseQuantPrecision(value: string): "int4" | "int8" | "fp16" | null {
  const v = value.trim().toLowerCase().replace(/['"]/g, "");
  if (v === "int4" || v === "4bit" || v === "4-bit") return "int4";
  if (v === "int8" || v === "8bit" || v === "8-bit") return "int8";
  if (v === "fp16" || v === "float16" || v === "half") return "fp16";
  return null;
}

/**
 * Normalizes a quantization method string to a supported value.
 *
 * @param value - The quantization method to normalize
 * @returns The supported quantization method, or `null` when the value is unsupported
 */
function normalizeLooseQuantMethod(value: string): UIState["passes"]["quantMethod"] | null {
  const v = value.trim().toLowerCase();
  const allowed = PASS_STRING_ENUMS.quantMethod!;
  return allowed.has(v) ? (v as UIState["passes"]["quantMethod"]) : null;
}

/**
 * Recovers an allowlisted chat action patch from loosely structured JSON.
 *
 * @param parsed - JSON value containing possible execution provider, conversion, or quantization settings
 * @returns The sanitized recovered patch, or `null` when no recognized settings are found
 */
export function salvageChatActionPatchFromLooseJson(parsed: unknown): ChatActionPatch | null {
  const passes: Partial<UIState["passes"]> = {};
  let ihvProvider: IHVProvider | undefined;

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;

    for (const [rawKey, value] of Object.entries(node)) {
      const key = rawKey.toLowerCase().replace(/[\s-]+/g, "_");

      if (
        (key === "ihvprovider" || key === "execution_provider" || key === "executionprovider") &&
        typeof value === "string" &&
        IHV_PROVIDERS.has(value)
      ) {
        ihvProvider = value as IHVProvider;
      }

      if (
        (key.includes("opset") || key === "targetopset" || key === "target_opset") &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        passes.conversion = true;
        passes.conversionOpset = Math.round(value);
      }

      if (key === "quantmethod" || key === "quant_method") {
        if (typeof value === "string") {
          const method = normalizeLooseQuantMethod(value);
          if (method) {
            passes.quantization = true;
            passes.quantMethod = method;
          }
        }
      }

      if (key === "precision" || key === "quantprecision" || key === "quant_precision") {
        if (typeof value === "string") {
          const prec = normalizeLooseQuantPrecision(value);
          if (prec) {
            passes.quantization = true;
            passes.quantPrecision = prec;
            if (!passes.quantMethod) passes.quantMethod = "ptq";
          }
        }
      }

      if (
        /quant/i.test(key) &&
        (value === true ||
          (typeof value === "string" && /apply|enable|true|int[48]|awq|gptq|ptq/i.test(value)))
      ) {
        passes.quantization = true;
        if (typeof value === "string") {
          const prec = normalizeLooseQuantPrecision(value);
          if (prec) passes.quantPrecision = prec;
          const method = normalizeLooseQuantMethod(value);
          if (method) passes.quantMethod = method;
        }
        if (!passes.quantMethod && !passes.quantPrecision) {
          // "apply_quantization" with no precision → enable PTQ toggle only
          passes.quantMethod = passes.quantMethod ?? "ptq";
        }
      }

      if (
        (/convert/.test(key) || key === "onnx" || /onnx/.test(key)) &&
        (value === true || typeof value === "string" || typeof value === "number" || isRecord(value))
      ) {
        passes.conversion = true;
        if (typeof value === "string" && /onnx|openvino|qnn|tensorrt/i.test(value)) {
          const fmt = value.toLowerCase();
          if (fmt === "onnx" || fmt === "openvino" || fmt === "qnn" || fmt === "tensorrt") {
            passes.conversionFormat = fmt;
          }
        }
      }

      if (key === "passes") visit(value, depth + 1);
      else if (isRecord(value) || Array.isArray(value)) visit(value, depth + 1);
    }
  };

  visit(parsed, 0);
  const patch: ChatActionPatch = {};
  if (ihvProvider) patch.ihvProvider = ihvProvider;
  if (Object.keys(passes).length > 0) patch.passes = passes;
  return Object.keys(patch).length > 0 ? sanitizeChatActionPatch(patch) : null;
}

/**
 * Determines whether an object contains fields associated with a structured chat response.
 *
 * @returns `true` if the object has a string `reply` or `text` field, or an array `actions` field, `false` otherwise.
 */
function looksLikeStructuredChatEnvelope(parsed: Record<string, unknown>): boolean {
  return typeof parsed.reply === "string" || typeof parsed.text === "string" || Array.isArray(parsed.actions);
}

/**
 * Removes Apply-button instructions from chat text.
 *
 * @param text - The chat text to clean
 * @returns The text without misleading Apply-button instructions
 */
function stripMisleadingApplyInstructions(text: string): string {
  return text
    .replace(/\n*To make these changes:[^\n]*Apply[^\n]*\n*/gi, "\n")
    .replace(/\n*Click the \*\*Apply\*\* button[^\n]*\n*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parses an assistant response into display text and applyable Olive Studio actions.
 *
 * @param rawText - The raw assistant response, which may contain structured JSON or plain text
 * @returns The normalized reply text and up to five sanitized actions recovered from the response
 */
export function parseChatStructuredReply(rawText: string): ChatStructuredReply {
  let parsed: unknown;
  try {
    parsed = parseJsonFromAiResponse(rawText);
  } catch {
    return { reply: rawText.trim() || "No response generated.", actions: [] };
  }
  if (!isRecord(parsed)) {
    return { reply: rawText.trim() || "No response generated.", actions: [] };
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text.trim()
        : "";

  const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions: ChatAction[] = [];
  for (let i = 0; i < actionsRaw.length && actions.length < 5; i++) {
    const row = actionsRaw[i];
    if (!isRecord(row)) continue;
    const patch = sanitizeChatActionPatch(row.patch);
    if (!patch) continue;
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 120)
        : `Apply change ${actions.length + 1}`;
    const description =
      typeof row.description === "string" ? row.description.trim().slice(0, 400) : undefined;
    actions.push({
      id: `chat-action-${i}-${Date.now().toString(36)}`,
      title,
      description,
      patch,
    });
  }

  // Local / small models often return invented step schemas with no actions[].
  if (actions.length === 0) {
    const salvaged = salvageChatActionPatchFromLooseJson(parsed);
    if (salvaged) {
      actions.push({
        id: `chat-action-salvaged-${Date.now().toString(36)}`,
        title: "Apply recommended pipeline changes",
        description: summarizeChatPatch(salvaged),
        patch: salvaged,
      });
    }
  }

  let finalReply = reply;
  if (!finalReply) {
    if (actions.length > 0 && !looksLikeStructuredChatEnvelope(parsed)) {
      finalReply =
        "Here are concrete Olive Studio pipeline updates based on your request. Use **Apply** below to write them into the UI.";
    } else {
      finalReply = rawText.trim() || "No response generated.";
    }
  }

  if (actions.length === 0) {
    const hadApplyCta = /click the \*\*apply\*\*|click the apply button|to make these changes:/i.test(
      finalReply,
    );
    finalReply = stripMisleadingApplyInstructions(finalReply);
    if (hadApplyCta && !/applyable patch/i.test(finalReply)) {
      finalReply = `${finalReply}\n\n_(No Applyable patch was returned for this reply.)_`.trim();
    }
  }

  return { reply: finalReply, actions };
}

/** Schema reminder embedded in the chat system prompt. */
export const CHAT_JSON_RESPONSE_CONTRACT = `Respond with JSON only (no markdown fences):
{
  "reply": "markdown-friendly answer for the user",
  "actions": [
    {
      "title": "short button label",
      "description": "what Apply will change",
      "patch": {
        "ihvProvider": "CUDAExecutionProvider",
        "cudaVersion": "auto",
        "memoryOffload": "auto",
        "modelSource": "huggingface",
        "hfModelId": "org/model",
        "hfDataset": "dataset",
        "cacheDir": "~/.cache/olive",
        "passes": { "quantization": true, "quantMethod": "awq", "quantPrecision": "int4" }
      }
    }
  ]
}
Rules:
- Prefer MCP knowledge and workspace context over training memory.
- Only include actions the user can Apply into Olive Studio UI state.
- Use only the patch keys shown above. Never invent alternate schemas (no steps[], convert_to_onnx, apply_quantization, validate_model, etc.).
- When recommending a concrete pipeline change, always include a matching actions[] entry with a valid patch. Never tell the user to click Apply unless actions is non-empty.
- Prefer 0–2 actions. Empty actions is fine for informational Q&A. Do not pad.
- Keep actions ≤ 3. patch.passes values must match Olive Studio enums (ptq/awq/gptq/…, int4/int8/fp16, etc.).
- If the user question is outside Olive Studio / model optimization, refuse in "reply", set "actions" to [], and do not answer the off-topic request.`;
