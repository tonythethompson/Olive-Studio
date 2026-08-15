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
  gatherOliveMcpKnowledgeForReview,
} from "../../services/ai/oliveMcpKnowledge.ts";
import { parseJsonFromAiResponse } from "../../../lib/aiResponse.ts";
import { parseAiReviewReply, REVIEW_FINDINGS_RESPONSE_CONTRACT } from "../../../lib/reviewFindingsParse.ts";
import { filterFindings } from "../../../lib/auditSuggestionFilter.ts";
import {
  buildAiWorkspaceContext,
  formatAiWorkspaceContextForPrompt,
  type AiWorkspaceContext,
} from "../../../lib/aiWorkspaceContext.ts";
import { CHAT_JSON_RESPONSE_CONTRACT, parseChatStructuredReply } from "../../../lib/chatActions.ts";
import { getChatScopeBlock } from "../../../lib/chatScope.ts";
import { validateOliveRecipeStructure } from "../../../lib/oliveRecipeSchema.ts";
import { parseUIStatePayload } from "../../../lib/pipelineValidation.ts";

export function mountChatRoutes(router: Router): void {
  router.post("/ai/chat", async (req, res) => {
    const body = parseBody<{
      message: string;
      chatHistory?: unknown;
      workspaceContext?: unknown;
      state?: unknown;
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
      let workspaceBlock: string | null;
      try {
        if (workspaceContext && typeof workspaceContext === "object") {
          workspace = workspaceContext as AiWorkspaceContext;
        } else if (state && typeof state === "object") {
          const parsedState = parseUIStatePayload(state);
          if (parsedState.ok) workspace = buildAiWorkspaceContext(parsedState.state);
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
          retrieval: mcpKnowledge.retrieval,
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
      const validation = validateOliveRecipeStructure(recipe);
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
    const body = parseBody<{ state: unknown }>(req.body, {
      state: { type: "object", message: "Missing state" },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const parsedState = parseUIStatePayload(body.parsed.state);
    if (!parsedState.ok) return res.status(400).json({ error: parsedState.error });
    const { state } = parsedState;
    try {
      const ctx = buildAiWorkspaceContext(state);
      // Cap context so small models still have room for full-sentence JSON.
      const ctxSummary = formatAiWorkspaceContextForPrompt(ctx).slice(0, 3500);

      // Review uses the same Olive MCP knowledge source as chat, scoped to the active workspace.
      const mcpKnowledge = await gatherOliveMcpKnowledgeForReview(ctx);

      const system = buildOliveAssistantSystemPrompt({
        mcpBlock: mcpKnowledge.promptBlock,
        workspaceBlock: ctxSummary,
        responseContract: REVIEW_FINDINGS_RESPONSE_CONTRACT,
      });

      let reply = await callAI(system, [{ role: "user", content: ctxSummary }], true);
      let parsed = parseAiReviewReply(reply);
      // Retry once only when the model returned unstructured or malformed JSON.
      if (!parsed.structured) {
        reply = await callAI(
          `${system}\nRetry with valid JSON only. Example with ONE finding (0 is also fine; do not pad to 3): ` +
            '{"score":60,"level":"Suboptimal","summary":"The pipeline can better match TensorRT RTX with AWQ int4 quantization.",' +
            '"findings":[{"id":"review-1","title":"Enable AWQ int4 quantization","description":"AWQ int4 reduces weight memory so the model fits consumer TensorRT RTX VRAM more efficiently.","severity":"warning","evidence":"Selected NvTensorRT-RTX with AWQ int4 is the recommended path for Llama-class models.","actions":[{"kind":"applyPatch","label":"Apply AWQ int4","payload":{"passes":{"quantization":true,"quantMethod":"awq","quantPrecision":"int4"}}}]}]}',
          [{ role: "user", content: ctxSummary }],
          true,
        );
        parsed = parseAiReviewReply(reply);
      }

      const filteredFindings = filterFindings(parsed.findings, ctx);
      const dropped = parsed.findings.length - filteredFindings.length;
      let summary = parsed.summary;
      if (dropped > 0) {
        const note = `Removed ${dropped} off-topic finding${dropped === 1 ? "" : "s"} that did not match this model/EP.`;
        summary = `${summary.replace(/\s+$/, "")} ${note}`.slice(0, 1200);
      }

      return res.json({
        score: parsed.score,
        level: parsed.level,
        summary,
        findings: filteredFindings,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });
}
