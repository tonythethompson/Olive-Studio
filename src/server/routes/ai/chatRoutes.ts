/**
 * Assistant chat, pipeline validation, and analysis routes:
 * POST /ai/chat, POST /ai/validate, POST /ai/analyze-state.
 */
import type { Router } from "express";

import { parseBody, isParseBodyError } from "../../middleware/bodyGuard.ts";

import { callAI } from "../../services/ai/index.ts";
import {
  buildOliveAssistantSystemPrompt,
  gatherOliveMcpKnowledge,
} from "../../services/ai/oliveMcpKnowledge.ts";
import { parseJsonFromAiResponse } from "../../../lib/aiResponse.ts";
import { parseAuditAnalysisReply } from "../../../lib/auditAnalysis.ts";
import { filterAuditAnalysis } from "../../../lib/auditSuggestionFilter.ts";
import {
  buildAiWorkspaceContext,
  formatAiWorkspaceContextForPrompt,
  type AiWorkspaceContext,
} from "../../../lib/aiWorkspaceContext.ts";
import { CHAT_JSON_RESPONSE_CONTRACT, parseChatStructuredReply } from "../../../lib/chatActions.ts";
import { getChatScopeBlock } from "../../../lib/chatScope.ts";
import { validateOliveRecipeStructure } from "../../../lib/oliveRecipeSchema.ts";
import type { UIState } from "../../../types.ts";

export function mountChatRoutes(router: Router): void {
  router.post("/ai/chat", async (req, res) => {
    const body = parseBody<{
      message: string;
      chatHistory?: unknown;
      workspaceContext?: unknown;
      state?: UIState;
    }>(req.body, {
      message: { type: "string", message: "Missing message" },
      // Optional context fields are lenient by design: the handler ignores
      // malformed values, so pass them through unvalidated (unknown).
      chatHistory: { type: "unknown", required: false },
      workspaceContext: { type: "unknown", required: false },
      state: { type: "unknown", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { message, chatHistory, workspaceContext, state } = body.parsed;
    try {
      const scopeBlock = getChatScopeBlock(message);
      if (scopeBlock) {
        return res.json({
          reply: scopeBlock.reply,
          text: scopeBlock.reply,
          actions: [],
          mcp: { toolsUsed: [], sufficient: true, usedWebFallback: false },
        });
      }

      let workspace: AiWorkspaceContext | null = null;
      let workspaceBlock: string | null = null;
      try {
        if (workspaceContext && typeof workspaceContext === "object") {
          workspace = workspaceContext as AiWorkspaceContext;
        } else if (state && typeof state === "object") {
          workspace = buildAiWorkspaceContext(state);
        }
        workspaceBlock = workspace ? formatAiWorkspaceContextForPrompt(workspace) : null;
      } catch {
        // Workspace context is optional; ignore malformed client payloads.
        workspace = null;
        workspaceBlock = null;
      }

      // Olive MCP is the primary knowledge source for assistant chat.
      const mcpKnowledge = await gatherOliveMcpKnowledge(message, workspace);
      const system = buildOliveAssistantSystemPrompt({
        mcpBlock: mcpKnowledge.promptBlock,
        workspaceBlock,
        responseContract: CHAT_JSON_RESPONSE_CONTRACT,
      });

      const history = Array.isArray(chatHistory) ? chatHistory : [];
      const messages = history.concat([{ role: "user", content: message }]);
      const rawReply = await callAI(system, messages, true);
      const structured = parseChatStructuredReply(rawReply);
      // `reply` is canonical; `text` kept for older clients that read that field.
      return res.json({
        reply: structured.reply,
        text: structured.reply,
        actions: structured.actions,
        mcp: {
          toolsUsed: mcpKnowledge.toolsUsed,
          sufficient: mcpKnowledge.sufficient,
          usedWebFallback: mcpKnowledge.usedWebFallback,
        },
      });
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Pipeline Validation & Analysis ──────────────────────────────────────

  router.post("/ai/validate", async (req, res) => {
    const body = parseBody<{ recipe: unknown }>(req.body, {
      recipe: { type: "json", message: "Missing recipe" },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { recipe } = body.parsed;
    try {
      const validation = validateOliveRecipeStructure(
        typeof recipe === "string" ? JSON.parse(recipe) : recipe,
      );
      if (!validation.valid) return res.json({ valid: false, errors: validation.errors });
      const system =
        "You are an Olive model optimization validator. Review the recipe and return JSON: { valid: boolean, warnings: string[], suggestions: string[] }";
      const summary = JSON.stringify(recipe, null, 2).slice(0, 8000);
      const reply = await callAI(
        system,
        [{ role: "user", content: `Validate this Olive recipe: ${summary}` }],
        true,
      );
      const parsed = parseJsonFromAiResponse(reply);
      return res.json({ valid: true, ...(typeof parsed === "object" && parsed ? parsed : {}) });
    } catch (err: unknown) {
      return res.status(500).json({ valid: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/ai/analyze-state", async (req, res) => {
    const body = parseBody<{ state: UIState }>(req.body, {
      state: { type: "object", message: "Missing state" },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { state } = body.parsed;
    try {
      const ctx = buildAiWorkspaceContext(state);
      // Cap context so small models still have room for full-sentence JSON.
      const ctxSummary = formatAiWorkspaceContextForPrompt(ctx).slice(0, 3500);
      const system =
        "You analyze Olive optimization pipelines for ONNX Runtime / TensorRT / quantization. " +
        "Reply with ONE JSON object only (no markdown, no prose outside JSON). Schema: " +
        '{"score":0-100,"level":"Optimized"|"Suboptimal"|"Critical","summary":string,"suggestions":[{"title":string,"description":string,"impact":"High"|"Medium"|"Low","type":"warning"|"success"|"suggestion"|"info","autofix":{"pass":string,"value":string}}]}. ' +
        "Writing rules: summary must be 1-2 complete sentences. Each title must be a short readable phrase (not a bare field name like opset/dtype/cache). " +
        "Each description must be 1-2 complete sentences explaining why and what to change. Keep JSON valid with commas between elements. " +
        "Suggestion count (hard): Return 0 to 3 suggestions. Prefer fewer. Only include a suggestion if it is concrete, applyable, and would materially improve THIS workspace. " +
        "Never invent filler to reach 3. If the pipeline is already solid, return suggestions:[]. If only one real improvement exists, return exactly one. " +
        "Relevance rules (hard): Only suggest changes for the Model and execution provider in the workspace. " +
        "Never mention speech recognition / ASR / Whisper unless the model is an ASR model. " +
        "If execution provider is NvTensorRTRTXExecutionProvider, do NOT suggest TensorRTExecutionProvider, TensorRTPass, tensor_rt, TRT engine build/caching, or adding TensorRT after CUDA. That EP already is the consumer RTX path. " +
        "autofix.pass must be a UI field (e.g. quantMethod, quantPrecision, conversionInputTargetTypes, conversionOpset, ihvProvider), never a nested Olive JSON path like passes.conversion.config.input_model_dtype or systems.local_system.config.accelerators.";
      let reply = await callAI(system, [{ role: "user", content: ctxSummary }], true);
      let parsed = parseAuditAnalysisReply(reply);
      let analysis = filterAuditAnalysis(parsed, ctx);
      // Retry once only when parse fell back to unstructured text (empty suggestions).
      const looksSoft = !parsed.structured && parsed.suggestions.length === 0;
      if (looksSoft) {
        reply = await callAI(
          `${system}\nRetry with valid JSON only. Example with ONE suggestion (0 is also fine; do not pad to 3): ` +
            '{"score":60,"level":"Suboptimal","summary":"The pipeline can better match TensorRT RTX with AWQ int4 quantization.",' +
            '"suggestions":[{"title":"Enable AWQ quantization","description":"Switch the quant method to AWQ so weights fit TensorRT RTX more efficiently.","impact":"High","type":"suggestion","autofix":{"pass":"quantMethod","value":"awq"}}]}',
          [{ role: "user", content: ctxSummary }],
          true,
        );
        parsed = parseAuditAnalysisReply(reply);
        analysis = filterAuditAnalysis(parsed, ctx);
      }
      return res.json(analysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });
}
