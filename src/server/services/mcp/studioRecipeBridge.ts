/**
 * Studio → MCP recipe bridge core (no HTTP, no Olive execution).
 *
 * Accepts an untrusted bridge body, allowlist-merges a partial UIState onto
 * {@link createDefaultPipelineState}, then projects once via
 * {@link projectUiStateToRecipeEvaluation}.
 *
 * **Response contract (camelCase, JSON-safe):** matches
 * {@link UiStateRecipeEvaluation} plus `ok: true`. Python MCP tools accept
 * these keys (with snake_case aliases). Never runs Olive or touches job state.
 */
import type { IHVProvider, ModelSource, OpenVinoTargetDevice, UIState } from "../../../types.ts";
import { coercePassValue } from "../../../lib/auditAutofix.ts";
import { gateMultiLoraAdapters } from "../../../lib/oliveRecipeBuilder.ts";
import { mergeUiState, type UiStatePatch } from "../../../lib/pipelineValidation.ts";
import {
  projectUiStateToRecipeEvaluation,
  type UiStateRecipeEvaluation,
} from "../../../lib/recipePipeline.ts";
import { createDefaultPipelineState } from "../../../lib/stores/pipelineStore.ts";

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
  "CoreMLExecutionProvider",
  "NNAPIExecutionProvider",
  "VitisAIExecutionProvider",
  "SNPEExecutionProvider",
  "TensorflowLiteExecutionProvider",
  "XnnpackExecutionProvider",
  "WasmExecutionProvider",
]);

const MODEL_SOURCES = new Set<string>(["huggingface", "local", "azure"]);
const MEMORY_OFFLOAD = new Set<string>(["gpu_only", "auto"]);
const OPENVINO_TARGETS = new Set<string>(["CPU", "GPU", "NPU"]);
const CUDA_VERSIONS = new Set<string>([
  "auto",
  "cpu",
  "cu118",
  "cu121",
  "cu124",
  "cu126",
  "cu128",
  "cu130",
  "cu132",
]);

/** Fields that must never be accepted from the bridge (execution / server config). */
const REJECTED_KEYS = new Set([
  "batchJobs",
  "activeJobId",
  "passRecipeOverrides",
  "userScript",
]);

export type StudioRecipeBridgeDeps = {
  createDefaultState?: () => UIState;
  evaluate?: typeof projectUiStateToRecipeEvaluation;
};

/** Success payload: camelCase, stable for MCP Python tools. */
export type StudioRecipeBridgeSuccess = UiStateRecipeEvaluation & { ok: true };

export type StudioRecipeBridgeError = {
  ok: false;
  error: string;
  code: "invalid_body" | "invalid_ui_state" | "invalid_passes";
};

export type StudioRecipeBridgeResult = StudioRecipeBridgeSuccess | StudioRecipeBridgeError;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clipString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, max);
}

function parseLocalFiles(raw: unknown): UIState["localFiles"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UIState["localFiles"] = [];
  for (const item of raw) {
    if (!isObjectRecord(item)) continue;
    if (typeof item.name !== "string" || typeof item.size !== "number" || !Number.isFinite(item.size)) {
      continue;
    }
    out.push({ name: item.name.trim().slice(0, 512), size: Math.max(0, item.size) });
  }
  return out;
}

const MAX_BRIDGE_ADAPTERS = 8;

function parseBridgeTargetModules(rawModules: unknown): string[] | undefined {
  if (!Array.isArray(rawModules)) return undefined;
  const filtered = rawModules
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim().slice(0, 128))
    .filter(Boolean)
    .slice(0, 32);
  return filtered.length > 0 ? filtered : undefined;
}

function parseSingleBridgeAdapter(item: Record<string, unknown>) {
  const adapterPath = clipString(item.path, 1024);
  if (!adapterPath) return undefined;
  const name = clipString(item.name, 128);
  const rank = typeof item.rank === "number" && Number.isFinite(item.rank) ? item.rank : undefined;
  const alpha = typeof item.alpha === "number" && Number.isFinite(item.alpha) ? item.alpha : undefined;
  const rawModules = Array.isArray(item.targetModules) ? item.targetModules : item.target_modules;
  const targetModules = parseBridgeTargetModules(rawModules);

  return {
    path: adapterPath,
    ...(name ? { name } : {}),
    ...(rank !== undefined ? { rank } : {}),
    ...(alpha !== undefined ? { alpha } : {}),
    ...(targetModules ? { targetModules } : {}),
  };
}

function parseBridgeAdapters(raw: unknown): UIState["multiLoraAdapters"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<UIState["multiLoraAdapters"]> = [];
  for (const item of raw) {
    if (!isObjectRecord(item)) continue;
    const adapter = parseSingleBridgeAdapter(item);
    if (adapter) {
      out.push(adapter);
      if (out.length >= MAX_BRIDGE_ADAPTERS) break;
    }
  }
  return out.length > 0 ? out : undefined;
}

function assignClippedBridgeStrings(
  partial: UiStatePatch,
  raw: Record<string, unknown>,
): void {
  const hfModelId = clipString(raw.hfModelId, 256);
  if (hfModelId !== undefined) partial.hfModelId = hfModelId;
  const hfDataset = clipString(raw.hfDataset, 256);
  if (hfDataset !== undefined) partial.hfDataset = hfDataset;
  const hfTask = clipString(raw.hfTask, 128);
  if (hfTask !== undefined) partial.hfTask = hfTask;
  const azureModelPath = clipString(raw.azureModelPath, 1024);
  if (azureModelPath !== undefined) partial.azureModelPath = azureModelPath;
  const azureStr = clipString(raw.azureStr, 1024);
  if (azureStr !== undefined) partial.azureStr = azureStr;
  const cacheDir = clipString(raw.cacheDir, 512);
  if (cacheDir !== undefined) partial.cacheDir = cacheDir;
}

function assignEnumBridgeFields(partial: UiStatePatch, raw: Record<string, unknown>): void {
  if (typeof raw.modelSource === "string" && MODEL_SOURCES.has(raw.modelSource)) {
    partial.modelSource = raw.modelSource as ModelSource;
  }
  if (typeof raw.ihvProvider === "string" && IHV_PROVIDERS.has(raw.ihvProvider)) {
    partial.ihvProvider = raw.ihvProvider as IHVProvider;
  }
  if (typeof raw.openvinoTargetDevice === "string" && OPENVINO_TARGETS.has(raw.openvinoTargetDevice)) {
    partial.openvinoTargetDevice = raw.openvinoTargetDevice as OpenVinoTargetDevice;
  }
  if (typeof raw.memoryOffload === "string" && MEMORY_OFFLOAD.has(raw.memoryOffload)) {
    partial.memoryOffload = raw.memoryOffload as UIState["memoryOffload"];
  }
  if (typeof raw.cudaVersion === "string" && CUDA_VERSIONS.has(raw.cudaVersion)) {
    partial.cudaVersion = raw.cudaVersion as UIState["cudaVersion"];
  }
  if (typeof raw.distributedCaching === "boolean") {
    partial.distributedCaching = raw.distributedCaching;
  }
}

function assignBridgePasses(
  partial: UiStatePatch,
  raw: Record<string, unknown>,
): StudioRecipeBridgeError | null {
  if (!("passes" in raw)) return null;
  if (!isObjectRecord(raw.passes)) {
    return { ok: false, code: "invalid_passes", error: "passes must be a plain object" };
  }
  const passes: Partial<UIState["passes"]> = {};
  for (const [key, value] of Object.entries(raw.passes)) {
    const coerced = coercePassValue(key, value);
    if (coerced === null) continue;
    (passes as Record<string, unknown>)[key] = coerced;
  }
  if (Object.keys(passes).length > 0) partial.passes = passes;
  return null;
}

/**
 * Allowlist-merge untrusted partial UI fields. Unknown / dangerous keys ignored.
 * Returns an error when `passes` is present but not a plain object.
 */
export function mergeBridgeUiState(
  defaults: UIState,
  raw: Record<string, unknown>,
): { ok: true; state: UIState } | StudioRecipeBridgeError {
  const partial: UiStatePatch = {};

  assignEnumBridgeFields(partial, raw);
  assignClippedBridgeStrings(partial, raw);

  const localFiles = parseLocalFiles(raw.localFiles);
  if (localFiles) partial.localFiles = localFiles;

  const adapters = parseBridgeAdapters(raw.multiLoraAdapters ?? raw.multi_lora_adapters);
  if (adapters) partial.multiLoraAdapters = adapters;

  const vramRaw = raw.vramEstimateGb ?? raw.vram_estimate_gb;
  if (typeof vramRaw === "number" && Number.isFinite(vramRaw)) {
    partial.vramEstimateGb = vramRaw;
  }

  const passesError = assignBridgePasses(partial, raw);
  if (passesError) return passesError;

  // Explicitly drop dangerous keys even if somehow copied later.
  for (const key of REJECTED_KEYS) {
    delete (partial as Record<string, unknown>)[key];
  }

  return { ok: true, state: mergeUiState(defaults, partial) };
}

/**
 * Evaluate an untrusted bridge body into a JSON-safe recipe validation payload.
 *
 * Body shapes accepted:
 * - `{ uiState: { ...partial UIState } }` (Python MCP contract)
 * - `{ ...partial UIState }` (direct state object)
 *
 * @param body - Untrusted request body
 * @param deps - Optional DI for defaults factory and projection helper
 */
export function evaluateStudioRecipeBridge(
  body: unknown,
  deps: StudioRecipeBridgeDeps = {},
): StudioRecipeBridgeResult {
  if (!isObjectRecord(body)) {
    return { ok: false, code: "invalid_body", error: "Request body must be a JSON object" };
  }

  const rawState = "uiState" in body ? body.uiState : body;
  if (!isObjectRecord(rawState)) {
    return { ok: false, code: "invalid_ui_state", error: "uiState must be a JSON object" };
  }

  const createDefaultState = deps.createDefaultState ?? createDefaultPipelineState;
  const evaluate = deps.evaluate ?? projectUiStateToRecipeEvaluation;

  const merged = mergeBridgeUiState(createDefaultState(), rawState);
  if (!merged.ok) return merged;

  const adapters = merged.state.multiLoraAdapters;
  if (merged.state.passes.peft && Array.isArray(adapters) && adapters.length > 0) {
    const vram =
      typeof merged.state.vramEstimateGb === "number" ? merged.state.vramEstimateGb : Number.NaN;
    const gate = gateMultiLoraAdapters(adapters, vram);
    if (!gate.allowed) {
      return {
        ok: false,
        code: "invalid_ui_state",
        error: `Multi-LoRA adapter configuration rejected: ${gate.reason ?? "invalid adapter configuration"}`,
      };
    }
  }

  // Exactly one projection call — pure, no Olive / I/O.
  const evaluation = evaluate(merged.state);
  return { ok: true, ...evaluation };
}
