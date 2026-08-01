/**
 * Olive MCP-first knowledge gathering for Assistant chat.
 *
 * Chat must prefer the local Olive MCP KB (+ live Olive docs via MCP) over model
 * memory. Optional external web search runs only when MCP coverage is thin and
 * a search backend is configured.
 */
import type { AiWorkspaceContext } from "../../../lib/aiWorkspaceContext.ts";
import { callOliveMcpTools, type McpToolRequest } from "../mcp/client.ts";

export type OliveMcpKnowledgeResult = {
  /** Markdown/plain block injected into the system prompt. */
  promptBlock: string;
  /** Tool names that returned usable data. */
  toolsUsed: string[];
  /** True when MCP returned enough material to answer Olive questions. */
  sufficient: boolean;
  /** Whether an optional web fallback was attempted. */
  usedWebFallback: boolean;
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

function wantsQuant(message: string): boolean {
  const m = lower(message);
  return /quant|awq|gptq|hqq|int4|int8|ptq|qat|calibration/.test(m);
}

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

function wantsChain(message: string): boolean {
  const m = lower(message);
  return /order|chain|sequence|before quant|after convert|pipeline order/.test(m);
}

function clipJson(value: unknown, max = 3500): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n…(truncated)`;
  } catch {
    return String(value).slice(0, max);
  }
}

function docsSearchSufficient(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  const count = typeof r.count === "number" ? r.count : 0;
  if (count <= 0) return false;
  const results = Array.isArray(r.results) ? r.results : [];
  const top = results[0] as { relevance?: number } | undefined;
  return typeof top?.relevance === "number" ? top.relevance >= 1 : results.length > 0;
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

function toCanonicalHardware(target: string): string {
  const key = lower(target).replace(/\s+/g, "-");
  return CANONICAL_HARDWARE[key] ?? target;
}

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

function canonicalPassNamesForChain(workspace: AiWorkspaceContext | null | undefined): string[] {
  const fromRecipe = workspace?.recipeSnapshot?.passTypes?.filter(Boolean);
  if (fromRecipe?.length) return fromRecipe.slice(0, 8);
  return (workspace?.activePassLabels ?? [])
    .map((label) => {
      const head = label.split(" ")[0]?.toLowerCase() ?? "";
      if (head === "conversion") return "OnnxConversion";
      if (head === "quantization") return "OnnxQuantization";
      if (head === "pruning") return "OnnxMatMul4Quantizer";
      if (head === "peft") return "LoRA";
      if (head === "onnx") return "OnnxModelOptimizer";
      return label.split(" ")[0] ?? label;
    })
    .slice(0, 8);
}

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

/** Select MCP tool calls for a user chat message (+ optional workspace). */
export function selectOliveMcpToolsForChat(
  message: string,
  workspace?: AiWorkspaceContext | null,
): McpToolRequest[] {
  const requests: McpToolRequest[] = [
    { toolName: "search_olive_documentation", args: { query: message.slice(0, 500), top_k: 6, live: false } },
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
 * Optional external web search. Only runs when:
 * - MCP coverage is insufficient, and
 * - OLIVE_STUDIO_WEB_SEARCH_URL is set (POST JSON `{ query }` → `{ results: [{ title, url, snippet }] }`).
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

export async function gatherOliveMcpKnowledge(
  message: string,
  workspace?: AiWorkspaceContext | null,
): Promise<OliveMcpKnowledgeResult> {
  const requests = selectOliveMcpToolsForChat(message, workspace);
  const results = await callOliveMcpTools(requests);

  const sections: string[] = [];
  const toolsUsed: string[] = [];
  let docsOk = false;
  let anyOk = false;

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!;
    const out = results[i];
    if (!out || out.error || out.result === undefined) continue;
    anyOk = true;
    toolsUsed.push(req.toolName);
    if (req.toolName === "search_olive_documentation" && docsSearchSufficient(out.result)) {
      docsOk = true;
    }
    sections.push(`### MCP tool: ${req.toolName}\n\`\`\`json\n${clipJson(out.result)}\n\`\`\``);
  }

  let usedWebFallback = false;
  const sufficient = anyOk && (docsOk || toolsUsed.length >= 2 || looksLikeError(message));

  if (!sufficient) {
    const web = await optionalWebSearchFallback(message);
    if (web) {
      usedWebFallback = true;
      sections.push(`### Web search fallback (secondary)\n${web}`);
      // Still not "sufficient" Olive-KB coverage; prompt will tell the model to treat this as secondary.
    }
  }

  if (sections.length === 0) {
    return {
      promptBlock:
        "Olive MCP knowledge: unavailable for this turn (tools returned no usable data). " +
        "Say when you are unsure and avoid inventing Olive APIs or pass names.",
      toolsUsed: [],
      sufficient: false,
      usedWebFallback,
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

  return { promptBlock, toolsUsed, sufficient, usedWebFallback };
}

/** System prompt preamble for Olive Studio chat. */
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
