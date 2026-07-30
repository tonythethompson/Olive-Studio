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

type KbReadResult =
  | { ok: true; data: PassesJson }
  | { ok: false; reason: "missing" | "unreadable" | "invalid"; message: string };

/**
 * Read the passes.json KB file synchronously (ESM-safe, no require()).
 * Distinguishes a genuinely missing KB from a read/parse failure so callers
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
  try {
    return { ok: true, data: JSON.parse(raw) as PassesJson };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "invalid", message: `passes.json is not valid JSON: ${message}` };
  }
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
      return res.json({ available: false, reason: kb.reason, error: kb.message });
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
        return res.json({ ok: false, reason: kb.reason, error: kb.message });
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
