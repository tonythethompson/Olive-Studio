/**
 * Structured assistant chat actions that the UI can Apply into pipelineStore.
 * Patches are allowlisted so the model cannot invent arbitrary UIState keys.
 */
import type { IHVProvider, ModelSource, UIState } from "@/types";
import { parseJsonFromAiResponse } from "@/lib/aiResponse";
import { coercePassValue, PASS_STRING_COERCE } from "@/lib/auditAutofix";

const IHV_PROVIDERS = new Set<string>([
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "DmlExecutionProvider",
  "OpenVINOExecutionProvider",
  "QNNExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
]);

const CUDA_VERSIONS = new Set(["auto", "cpu", "cu118", "cu121", "cu124", "cu126", "cu128", "cu130", "cu132"]);
const MODEL_SOURCES = new Set(["huggingface", "local", "azure"]);
const MEMORY_OFFLOAD = new Set(["gpu_only", "auto"]);

export type ChatActionPatch = {
  ihvProvider?: IHVProvider;
  cudaVersion?: UIState["cudaVersion"];
  memoryOffload?: UIState["memoryOffload"];
  modelSource?: ModelSource;
  hfModelId?: string;
  hfDataset?: string;
  trustRemoteCode?: boolean;
  hfTrustRemoteCode?: boolean;
  cacheDir?: string;
  passes?: Partial<UIState["passes"]>;
};

/**
 * Fields that were stripped from an AI patch because they require explicit
 * user confirmation before being applied (security-sensitive toggles).
 */
export type GatedPatchFields = {
  trustRemoteCode?: true;
};

/**
 * Extract security-sensitive fields from a patch that require user confirmation.
 * Returns null when the patch contains no gated fields.
 */
export function extractGatedFields(patch: ChatActionPatch): GatedPatchFields | null {
  if (patch.trustRemoteCode === true) {
    return { trustRemoteCode: true };
  }
  return null;
}

/**
 * Returns a copy of the patch with gated (security-sensitive) fields removed.
 * Disabling trustRemoteCode (false) is always safe and passes through.
 * Enabling trustRemoteCode (true) requires explicit confirmation via
 * `chatPatchToUiState` with `{ confirmGated: true }`.
 */
export function stripGatedFields(patch: ChatActionPatch): ChatActionPatch {
  if (patch.trustRemoteCode !== true) return patch;
  const { trustRemoteCode: _, ...rest } = patch;
  return rest;
}

export const TRUST_REMOTE_CODE_CONFIRM_MESSAGE =
  "Enabling Trust Remote Code will execute Python code from the Hugging Face repository inside Olive on your machine. Only enable this for repositories you trust.\n\nDo you want to enable Trust Remote Code?";

/**
 * Checks for gated fields (like trustRemoteCode=true) and prompts the user for
 * confirmation if running in an interactive browser environment.
 * Returns true if no gated fields exist or if confirmed by user, false if declined.
 */
export function confirmGatedPatchFields(patch: ChatActionPatch): boolean {
  const gated = extractGatedFields(patch);
  if (!gated) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }
  return window.confirm(TRUST_REMOTE_CODE_CONFIRM_MESSAGE);
}

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizePasses(raw: unknown): Partial<UIState["passes"]> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<UIState["passes"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    // trustRemoteCode is security-gated and must not pass through nested passes merge
    if (key === "trustRemoteCode") continue;
    const coerced = coercePassValue(key, value);
    if (coerced === null) continue;
    (out as Record<string, unknown>)[key] = coerced;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Strip unknown keys so Apply never writes garbage into the store. */
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
  if (typeof raw.trustRemoteCode === "boolean") {
    patch.trustRemoteCode = raw.trustRemoteCode;
  } else if (typeof raw.hfTrustRemoteCode === "boolean") {
    patch.trustRemoteCode = raw.hfTrustRemoteCode;
  }
  if (typeof raw.cacheDir === "string" && raw.cacheDir.trim()) {
    patch.cacheDir = raw.cacheDir.trim().slice(0, 512);
  }

  // Extract nested passes.trustRemoteCode before sanitizing passes
  let nestedTrustRemoteCode: boolean | undefined;
  if (isRecord(raw.passes) && typeof raw.passes.trustRemoteCode === "boolean") {
    nestedTrustRemoteCode = raw.passes.trustRemoteCode;
  }

  const passes = sanitizePasses(raw.passes);
  if (passes) patch.passes = passes;

  // Process nested trustRemoteCode through the top-level gated field path
  if (nestedTrustRemoteCode !== undefined && patch.trustRemoteCode === undefined) {
    patch.trustRemoteCode = nestedTrustRemoteCode;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export type ChatPatchOptions = {
  /**
   * When true, security-sensitive fields (e.g. trustRemoteCode=true) are
   * applied. When false or omitted, enabling trustRemoteCode is silently
   * skipped — the caller must first show a confirmation dialog.
   */
  confirmGated?: boolean;
};

/** Merge a sanitized chat patch into a Partial<UIState> ready for setState. */
export function chatPatchToUiState(state: UIState, patch: ChatActionPatch, options?: ChatPatchOptions): Partial<UIState> {
  const next: Partial<UIState> = {};
  if (patch.ihvProvider) next.ihvProvider = patch.ihvProvider;
  if (patch.cudaVersion) next.cudaVersion = patch.cudaVersion;
  if (patch.memoryOffload) next.memoryOffload = patch.memoryOffload;
  if (patch.modelSource) next.modelSource = patch.modelSource;
  if (patch.hfModelId !== undefined) next.hfModelId = patch.hfModelId;
  if (patch.hfDataset !== undefined) next.hfDataset = patch.hfDataset;
  if (patch.cacheDir !== undefined) next.cacheDir = patch.cacheDir;

  // Determine whether trustRemoteCode should be applied:
  // - Disabling (false) is always safe.
  // - Enabling (true) requires explicit user confirmation via options.confirmGated.
  const effectiveTrust: boolean | undefined =
    patch.trustRemoteCode === false
      ? false
      : patch.trustRemoteCode === true && options?.confirmGated
        ? true
        : undefined;

  if (patch.passes || effectiveTrust !== undefined) {
    const merged: UIState["passes"] = { ...state.passes, ...patch.passes };
    // Apply trustRemoteCode into passes where it belongs in UIState.
    if (effectiveTrust !== undefined) {
      merged.trustRemoteCode = effectiveTrust;
    }
    // Keep toggles consistent with method/precision changes.
    if (patch.passes?.quantMethod || patch.passes?.quantPrecision) {
      merged.quantization = true;
    }
    if (patch.passes?.quantMethod === "awq") {
      merged.pruning = false;
    }
    if (patch.passes?.peftMethod) {
      merged.peft = true;
    }
    if (patch.passes?.conversionFormat || patch.passes?.conversionOpset) {
      merged.conversion = true;
    }
    next.passes = merged;
  }
  return next;
}

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

function normalizeLooseQuantPrecision(value: string): "int4" | "int8" | "fp16" | null {
  const v = value.trim().toLowerCase().replace(/['"]/g, "");
  if (v === "int4" || v === "4bit" || v === "4-bit") return "int4";
  if (v === "int8" || v === "8bit" || v === "8-bit") return "int8";
  if (v === "fp16" || v === "float16" || v === "half") return "fp16";
  return null;
}

/** Shared quant-method allow-list; an empty set would mark a free-form field. */
const QUANT_METHOD_VALUES: ReadonlySet<string> = (() => {
  const values = PASS_STRING_COERCE.quantMethod;
  if (!values || values.size === 0) {
    throw new Error("PASS_STRING_COERCE.quantMethod must be a non-empty allow-list");
  }
  return values;
})();

function normalizeLooseQuantMethod(value: string): UIState["passes"]["quantMethod"] | null {
  const v = value.trim().toLowerCase();
  return QUANT_METHOD_VALUES.has(v) ? (v as UIState["passes"]["quantMethod"]) : null;
}

const QUANT_AFFIRMATIVE_TOKENS = new Set([
  "true",
  "apply",
  "apply_quantization",
  "enable",
  "enabled",
  "int4",
  "int8",
  ...QUANT_METHOD_VALUES,
]);

function tokenizeLooseValue(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True if any whitespace-separated token in `value` is an affirmative quantization instruction. */
function hasAffirmativeQuantToken(value: string): boolean {
  return tokenizeLooseValue(value).some((t) => QUANT_AFFIRMATIVE_TOKENS.has(t));
}

/** Extract a quant method from any token in a multi-word value like "apply awq". */
function extractLooseQuantMethodFromValue(value: string): UIState["passes"]["quantMethod"] | null {
  for (const token of tokenizeLooseValue(value)) {
    if (QUANT_METHOD_VALUES.has(token)) return token as UIState["passes"]["quantMethod"];
  }
  return null;
}

/** Extract a quant precision from any token in a multi-word value like "apply int8". */
function extractLooseQuantPrecisionFromValue(value: string): "int4" | "int8" | "fp16" | null {
  for (const token of tokenizeLooseValue(value)) {
    const prec = normalizeLooseQuantPrecision(token);
    if (prec) return prec;
  }
  return null;
}

const NEGATION_WORDS_RE =
  /\b(no|not|never|disable[ds]?|skip|without|unavailable|cannot|can't|don't|won't|avoid)\b/gi;

/**
 * Scoped negation: a negation word only suppresses a target (quant/convert)
 * mentioned shortly *after* it in the same value string — "convert to onnx
 * without quantization" negates quantization only, not the conversion
 * instruction that precedes the negation word.
 */
function negatedTargets(value: string): { quant: boolean; convert: boolean } {
  const lower = value.toLowerCase();
  let quant = false;
  let convert = false;
  let match: RegExpExecArray | null;
  NEGATION_WORDS_RE.lastIndex = 0;
  while ((match = NEGATION_WORDS_RE.exec(lower))) {
    const after = lower.slice(match.index, match.index + 40);
    if (/quant/.test(after)) quant = true;
    if (/convert|onnx/.test(after)) convert = true;
  }
  return { quant, convert };
}

/**
 * Small local models often invent custom step schemas instead of `actions[].patch`.
 * Walk loose JSON and map known fields onto an allowlisted ChatActionPatch.
 */
export function salvageChatActionPatchFromLooseJson(parsed: unknown): ChatActionPatch | null {
  const passes: Partial<UIState["passes"]> = {};
  let ihvProvider: IHVProvider | undefined;
  let trustRemoteCode: boolean | undefined;

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

      const isActionField = key === "step" || key === "action" || key === "task";
      // Negation must be scoped near the specific instruction it modifies —
      // a single flag gating every detector on a multi-clause value (e.g.
      // "convert to onnx without quantization") would wrongly suppress the
      // unrelated, non-negated conversion instruction too.
      const negated = typeof value === "string" ? negatedTargets(value) : { quant: false, convert: false };
      const isQuantMentioned =
        /quant/i.test(key) || (isActionField && typeof value === "string" && hasAffirmativeQuantToken(value));

      if (
        isQuantMentioned &&
        !negated.quant &&
        (value === true || (typeof value === "string" && hasAffirmativeQuantToken(value)))
      ) {
        passes.quantization = true;
        if (typeof value === "string") {
          const prec = normalizeLooseQuantPrecision(value) ?? extractLooseQuantPrecisionFromValue(value);
          if (prec) passes.quantPrecision = prec;
          const method = normalizeLooseQuantMethod(value) ?? extractLooseQuantMethodFromValue(value);
          if (method) passes.quantMethod = method;
        }
        if (!passes.quantMethod && !passes.quantPrecision) {
          // "apply_quantization" with no precision → enable PTQ toggle only
          passes.quantMethod = passes.quantMethod ?? "ptq";
        }
      }

      if (
        !negated.convert &&
        (/convert/.test(key) ||
          key === "onnx" ||
          /onnx/.test(key) ||
          (isActionField && typeof value === "string" && (/convert/i.test(value) || /onnx/i.test(value)))) &&
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

      if (
        key === "trust_remote_code" ||
        key === "trustremotecode" ||
        key === "hftrustremotecode" ||
        key === "hf_trust_remote_code"
      ) {
        if (typeof value === "boolean") {
          trustRemoteCode = value;
        } else if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true") trustRemoteCode = true;
          else if (normalized === "false") trustRemoteCode = false;
        }
      }

      if (key === "passes") visit(value, depth + 1);
      else if (isRecord(value) || Array.isArray(value)) visit(value, depth + 1);
    }
  };

  visit(parsed, 0);
  const patch: ChatActionPatch = {};
  if (ihvProvider) patch.ihvProvider = ihvProvider;
  if (trustRemoteCode !== undefined) patch.trustRemoteCode = trustRemoteCode;
  if (Object.keys(passes).length > 0) patch.passes = passes;
  return Object.keys(patch).length > 0 ? sanitizeChatActionPatch(patch) : null;
}

function looksLikeStructuredChatEnvelope(parsed: Record<string, unknown>): boolean {
  return typeof parsed.reply === "string" || typeof parsed.text === "string" || Array.isArray(parsed.actions);
}

function stripMisleadingApplyInstructions(text: string): string {
  return text
    .replace(/\n*To make these changes:[^\n]*Apply[^\n]*\n*/gi, "\n")
    .replace(/\n*Click the \*\*Apply\*\* button[^\n]*\n*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
