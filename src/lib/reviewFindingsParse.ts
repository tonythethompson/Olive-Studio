/**
 * Parse and validate the AI review response into the shared Finding/Action contract.
 *
 * The server-side parser enforces the same invariants as the frontend's
 * `parseFindings`/`parseActions` helpers, including `sanitizeChatActionPatch`
 * validation for every applyPatch payload.
 *
 * @module reviewFindingsParse
 */
import { parseJsonFromAiResponse } from "./aiResponse.ts";
import { sanitizeChatActionPatch } from "./chatActions.ts";
import type { Finding, Action, FindingSeverity } from "./types/findingTypes.ts";

const VALID_SEVERITIES: FindingSeverity[] = ["critical", "warning", "info"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeLevel(raw: unknown): "Optimized" | "Suboptimal" | "Inefficient" {
  if (raw === "Optimized" || raw === "Suboptimal" || raw === "Inefficient") return raw;
  return "Suboptimal";
}

function normalizeSeverity(raw: unknown): FindingSeverity {
  if (typeof raw === "string" && (VALID_SEVERITIES as string[]).includes(raw)) return raw as FindingSeverity;
  return "info";
}

/**
 * Validate a single action and coerce it into the shared Action contract.
 *
 * - applyPatch payloads must pass `sanitizeChatActionPatch`.
 * - navigate requires `targetPanel`.
 * - explain requires `body`.
 * - documentation requires `url` or `topicKey`.
 */
function parseAction(raw: unknown, fallbackLabel?: string): Action | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== "string") return null;
  if (kind !== "applyPatch" && kind !== "navigate" && kind !== "explain" && kind !== "documentation") {
    return null;
  }
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 80) : (fallbackLabel ?? "View details").slice(0, 80);
  const payload = isRecord(raw.payload) ? raw.payload : {};

  if (kind === "applyPatch") {
    const patch = sanitizeChatActionPatch(payload);
    if (!patch) return null;
    return { kind, label, payload: patch };
  }

  if (kind === "navigate") {
    if (typeof payload.targetPanel !== "string" || !payload.targetPanel.trim()) return null;
    return { kind, label, payload: { targetPanel: payload.targetPanel.trim() } };
  }

  if (kind === "explain") {
    if (typeof payload.body !== "string") return null;
    return { kind, label, payload: { body: payload.body.trim() } };
  }

  // documentation
  const url = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : undefined;
  const topicKey = typeof payload.topicKey === "string" && payload.topicKey.trim() ? payload.topicKey.trim() : undefined;
  if (!url && !topicKey) return null;
  return { kind, label, payload: { url, topicKey } };
}

function parseFinding(raw: unknown, index: number): Finding | null {
  if (!isRecord(raw)) return null;

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `ai-${index}`;
  const title =
    typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 120) : `Finding ${index + 1}`;
  const description =
    typeof raw.description === "string" ? raw.description.trim().slice(0, 2000) : "";
  const severity = normalizeSeverity(raw.severity);
  const evidence =
    typeof raw.evidence === "string" && raw.evidence.trim()
      ? raw.evidence.trim().slice(0, 2000)
      : description;

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions: Action[] = [];
  for (let i = 0; i < rawActions.length && actions.length < 10; i++) {
    const action = parseAction(rawActions[i], `Action ${actions.length + 1}`);
    if (action) actions.push(action);
  }

  // Requirement 2.5: every negative/concrete finding must have a useful next action.
  if (actions.length === 0) {
    actions.push({
      kind: "explain",
      label: "View details",
      payload: { body: `**${title}**\n\n${description}` },
    });
  }

  return { id, title, description, severity, evidence, actions };
}

function parseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (let i = 0; i < raw.length && out.length < 3; i++) {
    const finding = parseFinding(raw[i], i);
    if (finding) out.push(finding);
  }
  return out;
}

export type ParsedReviewResult = {
  score: number;
  level: "Optimized" | "Suboptimal" | "Inefficient";
  summary: string;
  findings: Finding[];
  /** True when the reply contained parseable JSON with the expected shape. */
  structured: boolean;
};

/**
 * Parse a raw AI review reply (JSON or markdown-fenced) into a validated review result.
 *
 * Falls back to a safe, empty-finding result when the model returns malformed or
 * non-JSON output so callers can decide whether to retry.
 */
export function parseAiReviewReply(rawText: string): ParsedReviewResult {
  let parsed: unknown;
  try {
    parsed = parseJsonFromAiResponse(rawText);
  } catch {
    return {
      score: 50,
      level: "Suboptimal",
      summary: "Could not parse a structured review. Try Analyze again or pick a stronger model in Settings.",
      findings: [],
      structured: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      score: 50,
      level: "Suboptimal",
      summary: "Model returned an unexpected response format. Try Analyze again.",
      findings: [],
      structured: false,
    };
  }

  const score = clampScore(parsed.score);
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 1200)
      : "Pipeline analysis complete.";
  const level = normalizeLevel(parsed.level);

  const findings = parseFindings(parsed.findings);

  return { score, level, summary, findings, structured: true };
}

/** Schema reminder embedded in the Pipeline Review system prompt. */
export const REVIEW_FINDINGS_RESPONSE_CONTRACT = `Reply with ONE JSON object only (no markdown, no prose outside JSON).
Schema:
{
  "score": 0-100,
  "level": "Optimized" | "Suboptimal" | "Inefficient",
  "summary": "1-2 complete sentences describing the overall pipeline health.",
  "findings": [
    {
      "id": "unique-string",
      "title": "short readable phrase (max 120 chars)",
      "description": "1-2 complete sentences explaining why and what to change (max 2000 chars)",
      "severity": "critical" | "warning" | "info",
      "evidence": "supporting detail shown beneath the description",
      "actions": [
        {
          "kind": "applyPatch",
          "label": "Apply fix",
          "payload": {
            "ihvProvider": "CUDAExecutionProvider",
            "cudaVersion": "auto",
            "memoryOffload": "auto",
            "modelSource": "huggingface",
            "hfModelId": "org/model",
            "hfDataset": "dataset",
            "cacheDir": "~/.cache/olive",
            "passes": { "quantization": true, "quantMethod": "awq", "quantPrecision": "int4" }
          }
        },
        { "kind": "navigate", "label": "Open settings", "payload": { "targetPanel": "ihv" } },
        { "kind": "explain", "label": "Learn more", "payload": { "body": "markdown explanation" } },
        { "kind": "documentation", "label": "Docs", "payload": { "topicKey": "quantization" } }
      ]
    }
  ]
}
Rules:
- findings count (hard): 0 to 3. Prefer fewer. Only include a finding if it is concrete, applyable, and would materially improve THIS workspace.
- Never invent filler to reach 3. If the pipeline is already solid, return findings:[].
- Every finding MUST have 1-10 actions. If no safe applyPatch can be produced, include an explain or documentation action; never return an empty actions array.
- applyPatch payloads must be valid Olive Studio UIState patches. Use only these top-level keys: ihvProvider, cudaVersion, memoryOffload, modelSource, hfModelId, hfDataset, cacheDir. Use only these passes keys: quantization, quantMethod, quantPrecision, conversion, conversionFormat, conversionOpset, conversionInputTargetTypes, pruning, pruningType, pruningMethod, pruningSparsity, peft, peftMethod, splitting, onnxTransforms, gptqBlockSize, gptqGroupSize, gptqDescAct, awqGroupSize, awqDampPercent, awqSym, qatQuantPrecision, qatCalibrateMethod, qatCalibrateSteps, quantPreset.
- Do not put nested Olive JSON paths like passes.conversion.config.input_model_dtype or systems.local_system.config.accelerators in an applyPatch payload.
- Relevance rules: Only suggest changes for the Model and execution provider in the workspace. Never mention speech recognition / ASR / Whisper unless the model is an ASR model.
- If execution provider is NvTensorRTRTXExecutionProvider, do NOT suggest TensorRTExecutionProvider, TensorRTPass, tensor_rt, TRT engine build/caching, or adding TensorRT after CUDA. That EP already is the consumer RTX path.
`;
