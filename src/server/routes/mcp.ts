/**
 * MCP (Model Compatibility Protocol) route handlers.
 * Tool proxy, KB status, KB sync, and loopback-only studio-recipe bridge.
 */
import type { NextFunction, Request, Response, Router } from "express";
import path from "path";
import fs from "fs";

import { reloadPassSchemas, type PassesJson } from "../../lib/schemaEngine.ts";
import {
  getKbStatusCache,
  setKbStatusCache,
  isKbSyncInProgress,
  setKbSyncInProgress,
} from "../services/mcp/state.ts";
import { callOliveMcpTool, MCP_UNAVAILABLE_ERROR, reconnectMcpClient } from "../services/mcp/client.ts";
import { isAllowedMcpToolName } from "../services/mcp/allowedTools.ts";
import { evaluateStudioRecipeBridge } from "../services/mcp/studioRecipeBridge.ts";
import {
  hasProxyForwardingHeaders,
  isLoopbackRemoteAddress,
  studioLocalOnly,
} from "../middleware/localOnly.ts";
import {
  kbStatusRateLimit,
  kbSyncRateLimit,
  mcpSettingsRateLimit,
  studioRecipeRateLimit,
  mcpToolRateLimit,
} from "../middleware/rateLimit.ts";
import { parseBody, isParseBodyError } from "../middleware/bodyGuard.ts";
import { readStudioConfig, writeStudioConfig } from "../config.ts";
import type { KbStatusCache } from "../types.ts";
import { denyUnless } from "../services/olive/agentAccess.ts";

/**
 * Strict loopback gate for the MCP tool proxy (including write-capable tools
 * such as record_troubleshoot_feedback). Rejects reverse-proxy hops and
 * non-loopback clients. Never honors OLIVE_ARENA_ALLOW_REMOTE — this proxy is
 * local MCP ↔ Studio only.
 */
function mcpToolLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (hasProxyForwardingHeaders(req) || !isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: "MCP tool proxy is only available from loopback" });
    return;
  }
  next();
}

function studioRecipeLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (hasProxyForwardingHeaders(req)) {
    res.status(403).json({
      ok: false,
      error: "Studio recipe bridge is only available from loopback (not via reverse proxy)",
    });
    return;
  }
  if (isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    next();
    return;
  }
  res.status(403).json({
    ok: false,
    error: "Studio recipe bridge is only available from loopback",
  });
}

/**
 * Determines whether a value is a non-null object with string keys.
 *
 * @param value - The value to evaluate
 * @returns `true` if the value is a record object, `false` otherwise.
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type KbFailureReason = "missing" | "unreadable" | "invalid";

type KbReadResult = { ok: true; data: PassesJson } | { ok: false; reason: KbFailureReason; message: string };

/** Stable, non-sensitive client-facing messages (server logs keep the detail). */
const KB_CLIENT_MESSAGE: Record<KbFailureReason, string> = {
  missing: "Knowledge base has not been generated yet.",
  unreadable: "Knowledge base could not be read.",
  invalid: "Knowledge base file is malformed.",
};

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validate a single pass entry against the fields `buildParamSchemas` consumes.
 * Optional fields are only checked when present, so absent fields still fall back
 * to their defaults — but a present-but-malformed field is rejected before it
 * reaches schema rebuilding.
 */
function isValidPassEntry(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (typeof value.name !== "string") return false;
  if (value.type !== undefined && typeof value.type !== "string") return false;
  if (value.class !== undefined && typeof value.class !== "string") return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.typical_compression !== undefined && typeof value.typical_compression !== "string") return false;
  if (value.input_formats !== undefined && !isStringArray(value.input_formats)) return false;
  if (value.output_formats !== undefined && !isStringArray(value.output_formats)) return false;
  if (value.required_params !== undefined && !isStringArray(value.required_params)) return false;
  if (value.hardware_requirements !== undefined && !isStringArray(value.hardware_requirements)) return false;
  if (value.gotchas !== undefined && !isStringArray(value.gotchas)) return false;
  // optional_params is a Record<string, ParamSchema>: object of objects.
  if (value.optional_params !== undefined) {
    if (!isObjectRecord(value.optional_params)) return false;
    if (!Object.values(value.optional_params).every((v) => isObjectRecord(v))) return false;
  }
  return true;
}

/** Runtime shape check for the fields `/mcp/kb-status` and `reloadPassSchemas` consume. */
function isValidPassesJson(value: unknown): value is PassesJson {
  if (!isObjectRecord(value)) return false;
  if (value.version !== undefined && typeof value.version !== "string") return false;
  if (value.last_updated !== undefined && typeof value.last_updated !== "string") return false;
  if (value.passes !== undefined) {
    if (!Array.isArray(value.passes)) return false;
    if (!value.passes.every((p) => isValidPassEntry(p))) return false;
  }
  return true;
}

/**
 * Read the passes.json KB file synchronously (ESM-safe, no require()).
 * Distinguishes a genuinely missing KB from a read/parse/schema failure so callers
 * don't report a corrupt-but-present KB as merely "unavailable".
 */
function readPassesJson(): KbReadResult {
  const passesPath = path.join(
    process.cwd(),
    "olive-mcp-server",
    "olive_mcp_server",
    "knowledge_base",
    "passes.json",
  );
  let raw: string;
  try {
    raw = fs.readFileSync(passesPath, "utf-8");
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: "missing",
        message: "passes.json not found — KB has not been generated yet.",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "unreadable", message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "invalid", message: `passes.json is not valid JSON: ${message}` };
  }
  if (!isValidPassesJson(parsed)) {
    return { ok: false, reason: "invalid", message: "passes.json does not match the expected KB schema." };
  }
  return { ok: true, data: parsed };
}

/**
 * Converts a knowledge-base failure into a client-safe error response.
 *
 * @param kb - The knowledge-base failure reason and server-side message
 * @returns The failure reason and a client-safe error message
 */
function kbFailureResponse(kb: { reason: KbFailureReason; message: string }): {
  reason: KbFailureReason;
  error: string;
} {
  console.warn(`[mcp] KB unavailable (${kb.reason}): ${kb.message}`);
  return { reason: kb.reason, error: KB_CLIENT_MESSAGE[kb.reason] };
}

/**
 * Reads the persisted knowledge-base synchronization timestamp from studio configuration.
 *
 * @returns The trimmed valid timestamp string, or `null` when no valid timestamp is configured.
 */
function readPersistedKbLastSync(): string | null {
  const config = readStudioConfig();
  const value = config.kbLastSync;
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value.trim() : null;
}

/**
 * Enforces the optional SYNC_KB_TOKEN for the KB sync endpoint.
 * Setting `SYNC_KB_TOKEN` (server-side) enables enforcement: the request
 * must include the matching `x-sync-token` header. `VITE_SYNC_KB_TOKEN`
 * must be set to the same value at build time so the bundled UI can send
 * the header; that Vite-exposed value is client-visible and must not be
 * treated as a secret.
 */
function verifySyncKbToken(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.SYNC_KB_TOKEN?.trim();
  if (!configured) return next();

  const header = req.headers["x-sync-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided?.trim() === configured) return next();

  res.status(401).json({ ok: false, error: "Missing or invalid sync token" });
}

/**
 * Builds a knowledge-base status record from the provided passes data.
 *
 * @param data - The knowledge-base data used to populate the status record
 * @param lastSync - The synchronization timestamp, or `null` when unavailable
 * @returns The knowledge-base status record
 */
function buildKbStatus(data: PassesJson, lastSync?: string | null): KbStatusCache {
  return {
    available: true,
    version: data.version ?? "unknown",
    lastUpdated: data.last_updated ?? null,
    passCount: data.passes?.length ?? 0,
    lastSync: lastSync ?? readPersistedKbLastSync(),
  };
}

/**
 * Synchronizes the local knowledge base and updates its persisted freshness timestamp.
 *
 * @returns A successful status result, or an error response when the knowledge base cannot be read.
 */
export function performKbSync():
  { ok: true; status: KbStatusCache } | { ok: false; statusCode: number; body: Record<string, unknown> } {
  const kb = readPassesJson();
  if (!kb.ok) {
    return { ok: false, statusCode: 500, body: { ok: false, ...kbFailureResponse(kb) } };
  }
  reloadPassSchemas(kb.data);
  const lastSync = new Date().toISOString();
  writeStudioConfig({ kbLastSync: lastSync });
  const status = buildKbStatus(kb.data, lastSync);
  setKbStatusCache(status);
  return { ok: true, status };
}

/**
 * Registers MCP tool proxy, studio-recipe bridge, knowledge-base status,
 * and knowledge-base synchronization routes on a router.
 *
 * Paths are relative to the `/api` mount (e.g. `/mcp/tool` → `/api/mcp/tool`).
 *
 * @param router - The router on which to register the MCP routes
 */
export function mountMcpRoutes(router: Router): void {
  // ─── MCP Tool Proxy ───────────────────────────────────────────────────
  router.post("/mcp/tool", mcpToolLocalOnly, mcpToolRateLimit, async (req, res) => {
    const body = parseBody<{ toolName: string; args?: Record<string, unknown> }>(req.body, {
      toolName: { type: "string", message: "Missing toolName" },
      args: { type: "object", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    if (!isAllowedMcpToolName(body.parsed.toolName)) {
      return res.status(400).json({ error: "Unknown toolName" });
    }
    // Master mcpAccess switch — allow capability discovery so agents can see why tools are blocked.
    if (body.parsed.toolName !== "get_mcp_capabilities") {
      const gate = denyUnless(() => true, "MCP access is disabled in Studio settings");
      if (!gate.ok) {
        return res.status(403).json({
          error: gate.error,
          reason: gate.reason,
          ...("required" in gate && gate.required ? { required: gate.required } : {}),
        });
      }
    }
    try {
      const out = await callOliveMcpTool(body.parsed.toolName, body.parsed.args ?? {});
      if (out.unavailable) {
        return res.status(503).json({ available: false, error: out.error ?? MCP_UNAVAILABLE_ERROR });
      }
      if (out.error) {
        return res.status(500).json({ error: out.error });
      }
      // Clients expect the tool payload at the top level (not `{ result: ... }`).
      return res.json(out.result ?? {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  // ─── Studio recipe bridge (loopback-only, no Olive execution) ─────────
  // Separate from the Python-MCP tool proxy. Pure UIState → recipe/validation.
  router.post(
    "/mcp/studio-recipe",
    studioRecipeLocalOnly,
    studioRecipeRateLimit,
    (req, res) => {
      const gate = denyUnless(() => true, "MCP access is disabled in Studio settings");
      if (!gate.ok) {
        return res.status(403).json({
          ok: false,
          error: gate.error,
          reason: gate.reason,
          ...("required" in gate && gate.required ? { required: gate.required } : {}),
        });
      }
      try {
        const result = evaluateStudioRecipeBridge(req.body);
        if (!result.ok) {
          // Bad input from bridge (invalid_body | invalid_ui_state | invalid_passes).
          return res.status(400).json(result);
        }
        return res.json(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[mcp] studio-recipe bridge failed: ${msg}`);
        return res.status(500).json({ ok: false, error: "Studio recipe evaluation failed" });
      }
    },
  );

  // ─── KB Status ────────────────────────────────────────────────────────
  router.get("/mcp/kb-status", kbStatusRateLimit, (_req, res) => {
    const cached = getKbStatusCache();
    if (cached) {
      if (!cached.lastSync) {
        const persisted = readPersistedKbLastSync();
        if (persisted) {
          const merged = { ...cached, lastSync: persisted };
          setKbStatusCache(merged);
          return res.json(merged);
        }
      }
      return res.json(cached);
    }

    const kb = readPassesJson();
    if (!kb.ok) {
      // Don't cache a failure — a missing/corrupt KB may be fixed at runtime.
      return res.json({ available: false, ...kbFailureResponse(kb) });
    }
    const status = buildKbStatus(kb.data);
    setKbStatusCache(status);
    return res.json(status);
  });

  // ─── KB Sync (loopback-only + optional token) ─────────────────────────
  router.post("/mcp/sync-kb", studioLocalOnly, kbSyncRateLimit, verifySyncKbToken, async (_req, res) => {
    if (isKbSyncInProgress()) {
      return res.status(409).json({ ok: false, error: "Sync already in progress" });
    }
    setKbSyncInProgress(true);
    try {
      const result = performKbSync();
      if (!result.ok) {
        return res.status(result.statusCode).json(result.body);
      }
      return res.json({ ok: true, ...result.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp] sync-kb failed: ${msg}`);
      return res.status(500).json({ ok: false, error: "Knowledge base synchronization failed" });
    } finally {
      setKbSyncInProgress(false);
    }
  });

  // ─── MCP Settings (update env vars + restart server) ───────────────────
  router.post("/mcp/settings", studioLocalOnly, mcpSettingsRateLimit, async (req, res) => {
    const body = parseBody<{
      retrievalMode?: "auto" | "keyword" | "semantic";
      preloadEmbeddings?: boolean;
    }>(req.body, {
      retrievalMode: { type: "string", required: false },
      preloadEmbeddings: { type: "boolean", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });

    const parsed = body.parsed;
    const validModes = ["auto", "keyword", "semantic"];
    if (parsed.retrievalMode && !validModes.includes(parsed.retrievalMode)) {
      return res.status(400).json({ error: `retrievalMode must be one of: ${validModes.join(", ")}` });
    }

    // Persist to disk config
    const current = readStudioConfig();
    const mcpSettings = {
      ...current.mcpSettings,
      ...(parsed.retrievalMode !== undefined && { retrievalMode: parsed.retrievalMode }),
      ...(parsed.preloadEmbeddings !== undefined && { preloadEmbeddings: parsed.preloadEmbeddings }),
    };
    writeStudioConfig({ mcpSettings });

    // Reconnect the MCP server with new env vars
    try {
      await reconnectMcpClient();
      return res.json({ ok: true, mcpSettings });
    } catch {
      return res.status(500).json({ ok: false, error: "Failed to restart MCP server with new settings" });
    }
  });

  // ─── MCP Settings (read current) ───────────────────────────────────────
  router.get("/mcp/settings", kbStatusRateLimit, (_req, res) => {
    const { mcpSettings } = readStudioConfig();
    return res.json({ mcpSettings: mcpSettings ?? {} });
  });
}
