/**
 * MCP (Model Compatibility Protocol) route handlers.
 * Tool proxy, KB status, KB sync.
 */
import type { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

import { reloadPassSchemas, type PassesJson } from "../../lib/schemaEngine.ts";
import {
  getKbStatusCache,
  setKbStatusCache,
  isKbSyncInProgress,
  setKbSyncInProgress,
} from "../services/mcp/state.ts";
import { kbStatusRateLimit, kbSyncRateLimit } from "../middleware/rateLimit.ts";
import { getVenvPython } from "../services/venv/paths.ts";

const execFileAsync = promisify(execFile);

/** Sanitize a tool name to prevent command injection. */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Invokes a tool function in olive_mcp_server and returns its result. */
async function callOliveMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result?: unknown; error?: string }> {
  const serverDir = path.join(process.cwd(), "olive-mcp-server");
  const venvPython = getVenvPython();
  const safeName = sanitizeToolName(toolName);
  const argsJson = JSON.stringify(args);

  try {
    const { stdout, stderr } = await execFileAsync(
      venvPython,
      [
        "-c",
        `from olive_mcp_server.mcp_server import call_tool; print(call_tool("${safeName}", ${argsJson}))`,
      ],
      { timeout: 30_000, cwd: serverDir },
    );
    const output = `${stdout} ${stderr}`.trim();
    try {
      const parsed = JSON.parse(output);
      if (isObjectRecord(parsed) && parsed.error) {
        return { error: String(parsed.error) };
      }
      return { result: parsed };
    } catch {
      return { result: output };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg || `MCP tool ${safeName} failed` };
  }
}

type KbFailureReason = "missing" | "unreadable" | "invalid";

type KbReadResult = { ok: true; data: PassesJson } | { ok: false; reason: KbFailureReason; message: string };

/** Stable, non-sensitive client-facing messages (server logs keep the detail). */
const KB_CLIENT_MESSAGE: Record<KbFailureReason, string> = {
  missing: "Knowledge base has not been generated yet.",
  unreadable: "Knowledge base could not be read.",
  invalid: "Knowledge base file is malformed.",
};

/** Runtime shape check for the fields `/mcp/kb-status` and `reloadPassSchemas` consume. */
function isValidPassesJson(value: unknown): value is PassesJson {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== undefined && typeof obj.version !== "string") return false;
  if (obj.last_updated !== undefined && typeof obj.last_updated !== "string") return false;
  if (obj.passes !== undefined) {
    if (!Array.isArray(obj.passes)) return false;
    // Every entry must be an object with a string `name` (schema keys off it).
    const entriesOk = obj.passes.every(
      (p) => typeof p === "object" && p !== null && typeof (p as { name?: unknown }).name === "string",
    );
    if (!entriesOk) return false;
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

/** Log the detailed reason server-side; return a stable, safe message to clients. */
function kbFailureResponse(kb: { reason: KbFailureReason; message: string }): {
  reason: KbFailureReason;
  error: string;
} {
  console.warn(`[mcp] KB unavailable (${kb.reason}): ${kb.message}`);
  return { reason: kb.reason, error: KB_CLIENT_MESSAGE[kb.reason] };
}

export function mountMcpRoutes(router: Router): void {
  // ─── MCP Tool Proxy ───────────────────────────────────────────────────
  router.post("/mcp/tool", async (req, res) => {
    const { toolName, args } = req.body as { toolName?: string; args?: Record<string, unknown> };
    if (!toolName) {
      return res.status(400).json({ error: "Missing toolName" });
    }
    try {
      const result = await callOliveMcpTool(toolName, args ?? {});
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  // ─── KB Status ────────────────────────────────────────────────────────
  router.get("/mcp/kb-status", kbStatusRateLimit, (_req, res) => {
    const cached = getKbStatusCache();
    if (cached) return res.json(cached);

    const kb = readPassesJson();
    if (!kb.ok) {
      // Don't cache a failure — a missing/corrupt KB may be fixed at runtime.
      return res.json({ available: false, ...kbFailureResponse(kb) });
    }
    const status = {
      available: true,
      version: kb.data.version ?? "unknown",
      lastUpdated: kb.data.last_updated ?? null,
      passCount: kb.data.passes?.length ?? 0,
    };
    setKbStatusCache(status);
    return res.json(status);
  });

  // ─── KB Sync ──────────────────────────────────────────────────────────
  router.post("/mcp/sync-kb", kbSyncRateLimit, async (_req, res) => {
    if (isKbSyncInProgress()) {
      return res.status(409).json({ ok: false, error: "Sync already in progress" });
    }
    setKbSyncInProgress(true);
    try {
      const kb = readPassesJson();
      if (!kb.ok) {
        return res.json({ ok: false, ...kbFailureResponse(kb) });
      }
      reloadPassSchemas(kb.data);
      const status = {
        available: true,
        version: kb.data.version ?? "unknown",
        lastUpdated: kb.data.last_updated ?? null,
        passCount: kb.data.passes?.length ?? 0,
        lastSync: new Date().toISOString(),
      };
      setKbStatusCache(status);
      return res.json({ ok: true, ...status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.json({ ok: false, error: msg });
    } finally {
      setKbSyncInProgress(false);
    }
  });
}
