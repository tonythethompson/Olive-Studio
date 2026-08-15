/**
 * Olive MCP-first knowledge gathering for Assistant chat and automatic review.
 *
 * Chat must prefer the local Olive MCP KB (+ live Olive docs via MCP) over model
 * memory. Optional external web search runs only when MCP coverage is thin and
 * a search backend is configured. Review uses a narrower, workspace-scoped
 * retrieval profile so automatic Pipeline Review stays fast and relevant.
 */
import type { AiWorkspaceContext } from "../../../lib/aiWorkspaceContext.ts";
import { resolvePassName } from "../../../lib/olivePassNameResolver.ts";
import type { UIState } from "../../../types.ts";
import { callOliveMcpTools, type McpToolRequest } from "../mcp/client.ts";

export type RetrievalMeta = {
  /** Effective retrieval mode used by the Olive MCP server. */
  mode: "auto" | "keyword" | "semantic";
  /** Effective retrieval mode after server resolution / fallback. */
  effective?: string;
  /** True when the server fell back to keyword search or MCP was unreachable. */
  degraded: boolean;
  /** Stable reason code when degraded is true. */
  reason?: string;
};

export type OliveMcpKnowledgeResult = {
  /** Markdown/plain block injected into the system prompt. */
  promptBlock: string;
  /** Tool names that returned usable data. */
  toolsUsed: string[];
  /** True when MCP returned enough material to answer Olive questions. */
  sufficient: boolean;
  /** Whether an optional web fallback was attempted. */
  usedWebFallback: boolean;
  /** Retrieval metadata so callers can surface budget / availability degradation. */
  retrieval: RetrievalMeta;
};

const MAX_SNIPPET_CHARS = 12_000;

function lower(s: string): string {
  return s.toLowerCase();
}

function looksLikeError(message: string): boolean {
  const m = lower(message);
  return (
    m.includes("traceback") ||
    m.includes("exception") ||
    m.includes("error:") ||
    m.includes("typeerror") ||
    m.includes("valueerror") ||
    m.includes("failed") ||
    m.includes("oom") ||
    m.includes("cuda error") ||
    m.includes("hf_config") ||
    m.includes("modulenotfounderror")
  );
}

/**
 * Determines whether a message describes an Olive Studio issue.
 *
 * @param message - The message to classify
 * @returns `true` if the message appears to describe an Olive Studio issue, `false` otherwise.
 */
function looksLikeStudioIssue(message: string): boolean {
  const m = lower(message);
  return (
    m.includes("hf_config") ||
    m.includes("olive studio") ||
    m.includes("apply fix") ||
    m.includes("parse & apply") ||
    m.includes("parse and apply") ||
    m.includes("recipe builder") ||
    m.includes("active provider") ||
    m.includes("mcp<2") ||
    m.includes("fastmcp") ||
    m.includes("/api/mcp/tool") ||
    m.includes("diagnose") ||
    m.includes("invalid requirement")
  );
}

/**
 * Determines whether a message concerns model quantization.
 *
 * @param message - The message to classify
 * @returns `true` if the message contains quantization-related terms, `false` otherwise.
 */
function wantsQuant(message: string): boolean {
  const m = lower(message);
  return /quant|awq|gptq|hqq|int4|int8|ptq|qat|calibration/.test(m);
}

/**
 * Determines whether a message mentions hardware or an execution provider.
 *
 * @param message - The message to inspect
 * @returns `true` if the message mentions hardware or an execution provider, `false` otherwise.
 */
function wantsHardware(message: string): boolean {
  const m = lower(message);
  return /hardware|tensorrt|openvino|qnn|directml|cuda|execution provider|ep\b|npu|gpu|cpu/.test(m);
}

function wantsPasses(message: string): boolean {
  const m = lower(message);
  return /pass(es)?\b|onnxconversion|conversion|pruning|lora|qlora|peft|graph optimizer/.test(m);
}

function wantsCompatibility(message: string): boolean {
  const m = lower(message);
  return /compatib|support(ed)?|does olive|can olive|model type|huggingface|pytorch/.test(m);
}

/**
 * Determines whether a message asks about pass ordering or sequencing.
 *
 * @returns `true` if the message concerns pass order or sequence, `false` otherwise.
 */
function wantsChain(message: string): boolean {
  const m = lower(message);
  return /order|chain|sequence|before quant|after convert|pipeline order/.test(m);
}

/**
 * Serializes a value as formatted JSON within a maximum character limit.
 *
 * @param value - The value to serialize
 * @param max - The maximum number of characters to include
 * @returns The serialized value, truncated when it exceeds `max`
 */
function clipJson(value: unknown, max = 3500): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n…(truncated)`;
  } catch {
    return String(value).slice(0, max);
  }
}

/**
 * Determines whether documentation search results provide sufficient coverage.
 *
 * @param result - The documentation search result to evaluate
 * @returns `true` if the result contains entries and meets the relevance threshold, `false` otherwise.
 */
function docsSearchSufficient(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  const count = typeof r.count === "number" ? r.count : 0;
  if (count <= 0) return false;
  const results = Array.isArray(r.results) ? r.results : [];
  const top = results[0] as { relevance?: number } | undefined;
  // `relevance` is normalized to roughly [0, 1] (semantic cosine or keyword
  // ratio) and already passed the MCP server's own match threshold before
  // being returned — any positive score here means a real hit, not a >=1
  // "many keyword hits" bar from the pre-semantic-search scale.
  return typeof top?.relevance === "number" ? top.relevance > 0 : results.length > 0;
}

/** Map EP / keyword targets to MCP KB canonical hardware profile names. */
const CANONICAL_HARDWARE: Record<string, string> = {
  cuda: "NVIDIA RTX 4090",
  tensorrt: "NVIDIA RTX 4090",
  "tensorrt-rtx": "NVIDIA RTX 4090",
  nvtensorrtrtx: "NVIDIA RTX 4090",
  directml: "NVIDIA RTX 4090",
  dml: "NVIDIA RTX 4090",
  openvino: "Intel Core i9 CPU",
  cpu: "Intel Core i9 CPU",
  qnn: "Qualcomm Snapdragon NPU",
  qualcomm: "Qualcomm Snapdragon NPU",
  rocm: "AMD MI300X / ROCm",
  "nvidia-gpu": "NVIDIA RTX 4090",
  "intel-cpu": "Intel Core i9 CPU",
  "qualcomm-npu": "Qualcomm Snapdragon NPU",
};

/**
 * Converts a hardware target to its canonical hardware profile name.
 *
 * @param target - The hardware target to normalize
 * @returns The canonical hardware name, or the original target when no mapping exists
 */
function toCanonicalHardware(target: string): string {
  const key = lower(target).replace(/\s+/g, "-");
  return CANONICAL_HARDWARE[key] ?? target;
}

/**
 * Classifies a model as small, medium, or large based on its parameter count in billions.
 *
 * @param message - The message to inspect for a model parameter count
 * @param workspace - Optional workspace context containing model identifiers
 * @returns The model size bucket, or `undefined` when no valid parameter count is found
 */
function inferModelSizeBucket(
  message: string,
  workspace: AiWorkspaceContext | null | undefined,
): "small" | "medium" | "large" | undefined {
  // Cap scan length and bound digit runs to avoid ReDoS on pathological input.
  const boundedMessage = message.slice(0, 400);
  const text =
    `${workspace?.model.displayName ?? ""} ${workspace?.model.huggingFaceId ?? ""} ${boundedMessage}`.slice(
      0,
      500,
    );
  const m = text.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*[bB]\b/);
  if (!m) return undefined;
  const billions = Number.parseFloat(m[1]!);
  if (!Number.isFinite(billions)) return undefined;
  if (billions < 3) return "small";
  if (billions <= 13) return "medium";
  return "large";
}

/**
 * Derives up to eight canonical pass names from the workspace recipe or active pass toggles.
 *
 * Respects the selected quantization/pruning/PEFT method and conversion format so the
 * review asks the MCP server to validate the actual pass type that would be emitted.
 *
 * @param workspace - Workspace context containing recipe pass types or active pass toggles
 * @returns An array of canonical pass names
 */
function canonicalPassNamesForChain(workspace: AiWorkspaceContext | null | undefined): string[] {
  const fromRecipe = workspace?.recipeSnapshot?.passTypes?.filter(Boolean);
  if (fromRecipe?.length) return fromRecipe.slice(0, 8);
  if (!workspace) return [];

  const state = workspace as unknown as UIState;
  const names: string[] = [];
  if (state.passes.conversion) {
    const resolved = resolvePassName("conversion", state);
    if (resolved) names.push(resolved);
  }
  if (state.passes.quantization) {
    const resolved = resolvePassName("quantization", state);
    if (resolved) names.push(resolved);
  }
  if (state.passes.pruning) {
    const resolved = resolvePassName("pruning", state);
    if (resolved) names.push(resolved);
  }
  if (state.passes.onnxTransforms) {
    const resolved = resolvePassName("transformer_opt", state);
    if (resolved) names.push(resolved);
  }
  if (state.passes.splitting) {
    const resolved = resolvePassName("splitting", state);
    if (resolved) names.push(resolved);
  }
  if (state.passes.peft) {
    const resolved = resolvePassName("peft", state);
    if (resolved) names.push(resolved);
  }
  return names.slice(0, 8);
}

/**
 * Infers the model type and target hardware for a quantization request.
 *
 * @param message - The user's request, used to identify model and hardware hints
 * @param workspace - Optional workspace context providing model and execution-provider information
 * @returns The inferred model type and canonical target hardware
 */
function inferQuantArgs(message: string, workspace: AiWorkspaceContext | null | undefined) {
  const m = lower(message);
  let modelType = "llm";
  if (/cnn|resnet|vision|image|yolo|mobilenet/.test(m)) modelType = "cnn";
  else if (/whisper|speech|audio|asr/.test(m)) modelType = "speech";
  else if (workspace?.model.displayName) {
    const name = lower(workspace.model.displayName);
    if (/resnet|vit|yolo|mobilenet|efficientnet/.test(name)) modelType = "cnn";
  }

  let targetHardware = "nvidia-gpu";
  const ep = lower(workspace?.hardware.executionProviderShort ?? "");
  if (ep.includes("openvino") || ep.includes("cpu")) targetHardware = "intel-cpu";
  else if (ep.includes("qnn")) targetHardware = "qualcomm-npu";
  else if (ep.includes("directml") || ep.includes("dml")) targetHardware = "directml";
  else if (ep.includes("tensorrt") || ep.includes("cuda") || ep.includes("nvtensor")) {
    targetHardware = "nvidia-gpu";
  } else if (/openvino|cpu/.test(m)) targetHardware = "intel-cpu";
  else if (/qnn|qualcomm|npu/.test(m)) targetHardware = "qualcomm-npu";

  return { model_type: modelType, target_hardware: toCanonicalHardware(targetHardware) };
}

/**
 * Determines the canonical hardware target from a message or workspace execution provider.
 *
 * @param message - The user message containing hardware references
 * @param workspace - Optional workspace context used when the message does not specify hardware
 * @returns The canonical hardware target
 */
function inferHardwareTarget(message: string, workspace: AiWorkspaceContext | null | undefined): string {
  const m = lower(message);
  if (/tensorrt\s*rtx|nvtensorrtrtx/.test(m)) return toCanonicalHardware("tensorrt-rtx");
  if (/tensorrt/.test(m)) return toCanonicalHardware("tensorrt");
  if (/openvino/.test(m)) return toCanonicalHardware("openvino");
  if (/qnn|qualcomm/.test(m)) return toCanonicalHardware("qnn");
  if (/directml|dml/.test(m)) return toCanonicalHardware("directml");
  if (/cuda/.test(m)) return toCanonicalHardware("cuda");
  const ep = workspace?.hardware.executionProviderShort;
  return ep && ep.length > 0 ? toCanonicalHardware(ep) : toCanonicalHardware("cuda");
}

/**
 * Respects OLIVE_MCP_RETRIEVAL_MODE and falls back to auto when unknown.
 *
 * @returns A valid retrieval mode for MCP search tools.
 */
export function getRetrievalMode(): "auto" | "keyword" | "semantic" {
  const raw = (process.env.OLIVE_MCP_RETRIEVAL_MODE ?? "auto").trim().toLowerCase();
  if (raw === "keyword") return "keyword";
  if (raw === "semantic") return "semantic";
  return "auto";
}

/**
 * Map active UI pass toggles to the get_olive_passes filter categories.
 *
 * @param workspace - The workspace context
 * @returns Category names accepted by get_olive_passes, ordered by relevance.
 */
function activePassCategoriesForReview(workspace: AiWorkspaceContext | null | undefined): string[] {
  if (!workspace) return [];
  const cats: string[] = [];
  const p = workspace.passes;
  if (p.quantization) cats.push("quantization");
  if (p.conversion) cats.push("conversion");
  if (p.pruning) cats.push("pruning");
  if (p.peft || p.diffusionLora) cats.push("finetuning");
  if (p.onnxTransforms) cats.push("graph_optimization");
  if (p.splitting) cats.push("performance_tuning");
  return cats;
}

/**
 * Best-effort source_format hint for get_pass_chain.
 *
 * Only "huggingface" maps unambiguously to the "hf" token used by passes.json.
 * Azure / local paths are not inspected, so we omit the hint and let the chain
 * validation fall back to warnings rather than a false incompatibility error.
 *
 * @param modelSource - The workspace model source
 * @returns A source format string or undefined when unknown.
 */
function sourceFormatForPassChain(
  modelSource: AiWorkspaceContext["modelSource"] | undefined,
): string | undefined {
  if (modelSource === "huggingface") return "hf";
  return undefined;
}

/**
 * Build a concise, scoping query for search_olive_documentation from workspace context.
 *
 * @param workspace - The workspace context
 * @param targetHardware - Canonical hardware target
 * @returns Query tokens (without stopwords).
 */
function buildReviewQuery(
  workspace: AiWorkspaceContext | null | undefined,
  targetHardware: string,
): string[] {
  if (!workspace) return [];
  const terms: string[] = [];
  const epShort = workspace.hardware.executionProviderShort;
  if (epShort) terms.push(epShort);
  if (targetHardware) terms.push(targetHardware);

  const modelName = workspace.model.displayName;
  if (modelName && modelName !== "(not set)") {
    const short = modelName.split("/").pop() ?? modelName;
    terms.push(short.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 4).join(" "));
  }

  for (const label of workspace.activePassLabels.slice(0, 3)) {
    const head = label.split(" ")[0]?.toLowerCase() ?? "";
    if (head) terms.push(head);
  }

  return [...new Set(terms)].filter(Boolean);
}

/**
 * Selects Olive MCP tools relevant to an automatic Pipeline Review for the given workspace.
 *
 * Queries are scoped to the active passes, selected execution provider, and detected
 * hardware profile. Each documentation search is capped at top_k: 10.
 *
 * @param workspace - Workspace context derived from the current Olive Studio UI state
 * @returns MCP tool requests for review-scoped knowledge
 */
export function selectOliveMcpToolsForReview(
  workspace: AiWorkspaceContext | null | undefined,
): McpToolRequest[] {
  if (!workspace) return [];

  const targetHardware = inferHardwareTarget("", workspace);
  const quant = inferQuantArgs("", workspace);
  const modelSize = inferModelSizeBucket("", workspace);
  const passNames = canonicalPassNamesForChain(workspace);
  const mode = getRetrievalMode();
  const categories = activePassCategoriesForReview(workspace);

  const requests: McpToolRequest[] = [];

  if (categories.length > 0) {
    requests.push({
      toolName: "get_olive_passes",
      args: { filter: categories[0] },
    });
  }

  requests.push({
    toolName: "get_hardware_optimization_guide",
    args: {
      target_hardware: targetHardware,
      ...(modelSize ? { model_size: modelSize } : {}),
    },
  });

  if (passNames.length > 0) {
    requests.push({
      toolName: "get_pass_chain",
      args: {
        pass_names: passNames,
        ...(sourceFormatForPassChain(workspace.modelSource)
          ? { source_format: sourceFormatForPassChain(workspace.modelSource) }
          : {}),
      },
    });
  }

  if (workspace.passes.quantization) {
    requests.push({
      toolName: "get_quantization_strategy",
      args: {
        model_type: quant.model_type,
        target_hardware: quant.target_hardware,
        latency_budget: "<500ms",
        accuracy_threshold: "<2% drop",
      },
    });
  }

  const queryTerms = buildReviewQuery(workspace, targetHardware);
  if (queryTerms.length > 0) {
    requests.push({
      toolName: "search_olive_documentation",
      args: {
        query: queryTerms.join(" ").slice(0, 500),
        top_k: 10,
        live: true,
        mode,
      },
    });
  }

  return requests;
}

/**
 * Selects Olive MCP tools relevant to a chat message and optional workspace context.
 *
 * @param message - The user's chat message
 * @param workspace - Optional workspace context used to refine tool arguments
 * @returns MCP tool requests for documentation and message-specific guidance
 */
export function selectOliveMcpToolsForChat(
  message: string,
  workspace?: AiWorkspaceContext | null,
): McpToolRequest[] {
  const mode = getRetrievalMode();
  const requests: McpToolRequest[] = [
    {
      toolName: "search_olive_documentation",
      args: { query: message.slice(0, 500), top_k: 20, live: false, mode },
    },
  ];

  if (looksLikeError(message) || looksLikeStudioIssue(message)) {
    requests.push({
      toolName: "troubleshoot_olive_error",
      args: { error_message: message.slice(0, 4000), domain: "auto" },
    });
  }

  if (wantsQuant(message)) {
    requests.push({
      toolName: "get_quantization_strategy",
      args: inferQuantArgs(message, workspace),
    });
  }

  if (wantsHardware(message)) {
    const modelSize = inferModelSizeBucket(message, workspace);
    requests.push({
      toolName: "get_hardware_optimization_guide",
      args: {
        target_hardware: inferHardwareTarget(message, workspace),
        ...(modelSize ? { model_size: modelSize } : {}),
      },
    });
  }

  if (wantsPasses(message)) {
    const filterMatch = message.match(
      /\b(quantization|pruning|conversion|peft|lora|optimization|transforms)\b/i,
    );
    requests.push({
      toolName: "get_olive_passes",
      args: filterMatch ? { filter: filterMatch[1].toLowerCase() } : {},
    });
  }

  if (wantsCompatibility(message)) {
    requests.push({
      toolName: "get_model_compatibility",
      args: {
        model_name: workspace?.model.displayName || message.slice(0, 120),
        framework: workspace?.modelSource === "huggingface" ? "huggingface" : "pytorch",
      },
    });
  }

  if (wantsChain(message) && workspace?.activePassLabels?.length) {
    const passNames = canonicalPassNamesForChain(workspace);
    if (passNames.length > 0) {
      requests.push({
        toolName: "get_pass_chain",
        args: { pass_names: passNames },
      });
    }
  }

  return requests;
}

/**
 * Retrieves supplemental web search results from the configured Olive Studio endpoint.
 *
 * @param query - Search query, limited to 400 characters
 * @returns Formatted search results, or `null` when search is unavailable, fails, or produces no results
 */
export async function optionalWebSearchFallback(query: string): Promise<string | null> {
  const endpoint = process.env.OLIVE_STUDIO_WEB_SEARCH_URL?.trim();
  if (!endpoint) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: query.slice(0, 400) }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; snippet?: string }>;
      };
      const rows = (data.results ?? []).slice(0, 5);
      if (rows.length === 0) return null;
      return rows
        .map((r, i) => `${i + 1}. ${r.title ?? "result"}\n   ${r.url ?? ""}\n   ${r.snippet ?? ""}`)
        .join("\n");
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

/**
 * Build retrieval metadata from a search_olive_documentation tool result.
 *
 * @param searchResult - Raw tool result, or undefined/error sentinel
 * @param requestedMode - The mode requested by the client
 * @returns RetrievalMeta for the knowledge result
 */
function retrievalMetaFromSearch(
  searchResult: { result?: unknown; error?: string; unavailable?: boolean } | undefined,
  requestedMode: "auto" | "keyword" | "semantic",
): RetrievalMeta {
  if (!searchResult || searchResult.unavailable) {
    return { mode: requestedMode, effective: "keyword", degraded: true, reason: "mcp_unavailable" };
  }
  if (searchResult.error) {
    return { mode: requestedMode, effective: "keyword", degraded: true, reason: "mcp_error" };
  }
  const r = (searchResult.result ?? {}) as Record<string, unknown>;
  const meta = (r.retrieval ?? {}) as Record<string, unknown>;
  return {
    mode: requestedMode,
    effective: typeof meta.effective === "string" ? meta.effective : requestedMode,
    degraded: meta.degraded === true,
    reason: typeof meta.reason === "string" ? meta.reason : undefined,
  };
}

/**
 * Merge multiple retrieval metadata objects into one summary.
 *
 * @param requestedMode - The mode the client requested
 * @param metas - Per-tool retrieval metadata
 * @returns Merged RetrievalMeta
 */
function mergeRetrievalMeta(
  requestedMode: "auto" | "keyword" | "semantic",
  metas: RetrievalMeta[],
): RetrievalMeta {
  let degraded = false;
  let reason: string | undefined;
  let effective: "auto" | "keyword" | "semantic" | undefined;
  const isKnownMode = (v: string): v is "auto" | "keyword" | "semantic" =>
    v === "auto" || v === "keyword" || v === "semantic";
  for (const m of metas) {
    if (m.degraded) {
      degraded = true;
      if (!reason) reason = m.reason;
    }
    if (m.effective === "semantic") {
      effective = "semantic";
      break;
    }
    if (!effective && m.effective && isKnownMode(m.effective)) {
      effective = m.effective;
    }
  }
  if (!effective) effective = requestedMode;
  return { mode: requestedMode, effective, degraded, reason };
}

/**
 * Formats a list of tool sections and coverage flags into the OliveMcpKnowledgeResult shape.
 *
 * @param sections - Markdown sections for each successful tool
 * @param toolsUsed - Tool names that returned usable data
 * @param sufficient - Whether the gathered knowledge is sufficient to answer
 * @param usedWebFallback - Whether a web fallback was appended
 * @param retrieval - Retrieval metadata
 * @returns The formatted knowledge result
 */
function buildKnowledgeResult(
  sections: string[],
  toolsUsed: string[],
  sufficient: boolean,
  usedWebFallback: boolean,
  retrieval: RetrievalMeta,
): OliveMcpKnowledgeResult {
  if (sections.length === 0) {
    return {
      promptBlock:
        "Olive MCP knowledge: unavailable for this turn (tools returned no usable data). " +
        "Say when you are unsure and avoid inventing Olive APIs or pass names.",
      toolsUsed: [],
      sufficient: false,
      usedWebFallback,
      retrieval,
    };
  }

  const header = [
    "PRIMARY SOURCE — Olive MCP knowledge (authoritative for Olive Studio answers).",
    "Prefer these excerpts over training memory for Olive passes, configs, hardware EPs, and troubleshooting.",
    "If something is missing here, say so. Do not invent Olive APIs, pass types, or config keys.",
    usedWebFallback
      ? "A secondary web fallback is included only because MCP coverage was thin; prefer MCP sections when they conflict."
      : "No external web search was used.",
    `Tools used: ${toolsUsed.join(", ") || "(none)"}`,
  ].join("\n");

  let promptBlock = `${header}\n\n${sections.join("\n\n")}`;
  if (promptBlock.length > MAX_SNIPPET_CHARS) {
    promptBlock = `${promptBlock.slice(0, MAX_SNIPPET_CHARS)}\n\n…(MCP context truncated)`;
  }

  return { promptBlock, toolsUsed, sufficient, usedWebFallback, retrieval };
}

/**
 * Gather Olive MCP knowledge from a set of tool requests.
 *
 * @param requests - MCP tool requests to execute
 * @param opts.webFallbackQuery - Optional query for the web fallback
 * @param opts.sufficientFn - Optional override for sufficiency heuristics
 * @returns The formatted knowledge result
 */
async function gatherFromRequests(
  requests: McpToolRequest[],
  opts: {
    webFallbackQuery?: string;
    sufficientFn?: (anyOk: boolean, docsOk: boolean, toolsUsed: string[]) => boolean;
  } = {},
): Promise<OliveMcpKnowledgeResult> {
  const results = ((await callOliveMcpTools(requests)) as { result?: unknown; error?: string; unavailable?: boolean }[] | undefined) ??
    [];
  const requestedMode = getRetrievalMode();

  const sections: string[] = [];
  const toolsUsed: string[] = [];
  let docsOk = false;
  let anyOk = false;
  const retrievalMetas: RetrievalMeta[] = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!;
    const out = results[i];
    if (req.toolName === "search_olive_documentation") {
      retrievalMetas.push(retrievalMetaFromSearch(out, requestedMode));
    }
    if (!out || out.error || out.result === undefined) continue;
    anyOk = true;
    toolsUsed.push(req.toolName);
    if (req.toolName === "search_olive_documentation" && docsSearchSufficient(out.result)) {
      docsOk = true;
    }
    sections.push(`### MCP tool: ${req.toolName}\n\`\`\`json\n${clipJson(out.result)}\n\`\`\``);
  }

  let usedWebFallback = false;
  const sufficientFn =
    opts.sufficientFn ?? ((anyOk, docsOk_, toolsUsed_) => anyOk && (docsOk_ || toolsUsed_.length >= 2));
  let sufficient = sufficientFn(anyOk, docsOk, toolsUsed);

  if (!sufficient && opts.webFallbackQuery) {
    const web = await optionalWebSearchFallback(opts.webFallbackQuery);
    if (web) {
      usedWebFallback = true;
      sections.push(`### Web search fallback (secondary)\n${web}`);
      // Still not "sufficient" Olive-KB coverage; prompt will tell the model to treat this as secondary.
    }
  }

  // Recompute sufficiency after optional web fallback (web does not make MCP sufficient).
  sufficient = sufficientFn(anyOk, docsOk, toolsUsed);

  const retrieval = mergeRetrievalMeta(requestedMode, retrievalMetas);
  return buildKnowledgeResult(sections, toolsUsed, sufficient, usedWebFallback, retrieval);
}

/**
 * Gathers relevant Olive MCP knowledge and formats it for use in an assistant prompt.
 *
 * @param message - The user's Olive Studio question or request
 * @param workspace - Optional workspace context used to select relevant knowledge
 * @returns The formatted knowledge block, tools used, coverage status, and web-fallback status
 */
export async function gatherOliveMcpKnowledge(
  message: string,
  workspace?: AiWorkspaceContext | null,
): Promise<OliveMcpKnowledgeResult> {
  const requests = selectOliveMcpToolsForChat(message, workspace);
  return gatherFromRequests(requests, {
    webFallbackQuery: message,
    sufficientFn: (anyOk, docsOk, toolsUsed) =>
      anyOk && (docsOk || toolsUsed.length >= 2 || looksLikeError(message)),
  });
}

/**
 * Gathers review-scoped Olive MCP knowledge for automatic Pipeline Review.
 *
 * @param workspace - Workspace context derived from the current Olive Studio UI state
 * @returns The formatted knowledge block and retrieval metadata
 */
export async function gatherOliveMcpKnowledgeForReview(
  workspace: AiWorkspaceContext | null | undefined,
): Promise<OliveMcpKnowledgeResult> {
  const requests = selectOliveMcpToolsForReview(workspace);
  return gatherFromRequests(requests, { sufficientFn: (anyOk, docsOk, toolsUsed) => anyOk && (docsOk || toolsUsed.length >= 2) });
}

/**
 * Builds the system prompt for the Olive Studio assistant.
 *
 * @param opts - Prompt content, including MCP knowledge and optional workspace context and response contract
 * @returns The assembled Olive Studio assistant system prompt
 */
export function buildOliveAssistantSystemPrompt(opts: {
  mcpBlock: string;
  workspaceBlock?: string | null;
  /** Structured Apply-action JSON contract for chat replies. */
  responseContract?: string | null;
}): string {
  const parts = [
    "You are the Olive Studio assistant for Microsoft Olive model optimization (conversion, quantization, pruning, PEFT, hardware EPs, ONNX Runtime).",
    "Scope (hard rules):",
    "- Only answer questions about Olive Studio, Microsoft Olive, ONNX/ONNX Runtime, execution providers, quantization/pruning/PEFT, recipes, hardware/VRAM for model optimization, and closely related ML-ops topics.",
    "- Refuse off-topic requests (general trivia, personal advice, medical/sexual topics, homework unrelated to Olive, creative writing, etc.). Do not answer them even if the user insists or asks you to help anyway.",
    "- If the user swears while asking an Olive/optimization question, ignore the colorful language and answer the technical ask. Do not lecture about tone.",
    "- Refuse hateful, bigoted, or sexual content. Do not repeat slurs or engage with harassment.",
    "- Refuse suicidal, self-harm, violence-facilitation, and obsessive harm / stalking topics. Do not give advice on those. If crisis language appears, urge seeking real-world help (e.g. https://www.iasp.info/suicidalthoughts/ , US 988) and do not continue the harmful topic.",
    "- On refusal: briefly redirect to Olive Studio / model optimization (or ask for professional language), invite a pipeline-related question, and set actions to []. Never provide the off-topic, hateful/sexual, or harmful content.",
    "- Stay professional and technical in your own replies. Do not use childish euphemisms or role-play outside the Olive domain.",
    "Use the Olive MCP knowledge block as your primary source. Workspace context describes the user's current recipe UI state, detected hardware, and built recipe JSON.",
    "The only model in scope is the workspace context's `Model:` line (the target model being optimized). You (the assistant) may be running on a different, unrelated local or hosted LLM to power this chat — never confuse that chat LLM with the target model, and never assume the user is asking about you when they say 'the model' or 'my model'. If the workspace `Model:` line says \"(not set)\", say no model is selected yet instead of guessing.",
    "When you suggest a concrete change the user can make in Olive Studio, include an Apply action with a valid patch so they can click Apply.",
    "",
    opts.mcpBlock,
  ];
  if (opts.workspaceBlock?.trim()) {
    parts.push("", "Workspace context:", opts.workspaceBlock.trim());
  }
  if (opts.responseContract?.trim()) {
    parts.push("", opts.responseContract.trim());
  }
  return parts.join("\n");
}
