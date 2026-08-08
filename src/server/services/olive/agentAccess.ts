/**
 * Studio-owned agent/MCP access policy.
 * Env overrides are for dev/CI only; product defaults live in StudioConfig.
 */
import { readStudioConfig, writeStudioConfig } from "../../config.ts";
import type { AgentAccessPolicy } from "../../types.ts";

export type ResolvedAgentAccess = {
  mcpAccess: boolean;
  allowJobInspection: boolean;
  allowRecipeChanges: boolean;
  allowJobSubmission: boolean;
  allowJobCancellation: boolean;
  /** True when OLIVE_MCP_ALLOW_JOBS (or related) overrode disk defaults. */
  envOverrideActive: boolean;
};

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function falsyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/** Resolve effective policy: disk defaults + optional env overrides. */
export function resolveAgentAccess(): ResolvedAgentAccess {
  const disk = readStudioConfig().agentAccess ?? {};
  let mcpAccess = disk.mcpAccess !== false;
  let allowJobInspection = disk.allowJobInspection !== false;
  let allowRecipeChanges = disk.allowRecipeChanges !== false;
  let allowJobSubmission = disk.allowJobSubmission === true;
  let allowJobCancellation = disk.allowJobCancellation === true;
  let envOverrideActive = false;

  // Dev/CI: OLIVE_MCP_ALLOW_JOBS enables submit+cancel (does not disable inspection).
  if (truthyEnv("OLIVE_MCP_ALLOW_JOBS")) {
    allowJobSubmission = true;
    allowJobCancellation = true;
    envOverrideActive = true;
  }
  if (falsyEnv("OLIVE_MCP_ALLOW_JOB_INSPECTION")) {
    allowJobInspection = false;
    envOverrideActive = true;
  }
  if (truthyEnv("OLIVE_MCP_ALLOW_JOB_INSPECTION")) {
    allowJobInspection = true;
    envOverrideActive = true;
  }
  if (falsyEnv("OLIVE_MCP_ACCESS")) {
    mcpAccess = false;
    envOverrideActive = true;
  }

  return {
    mcpAccess,
    allowJobInspection,
    allowRecipeChanges,
    allowJobSubmission,
    allowJobCancellation,
    envOverrideActive,
  };
}

export function getAgentAccessPublic(): ResolvedAgentAccess & { source: "studio" } {
  return { ...resolveAgentAccess(), source: "studio" };
}

export function updateAgentAccess(patch: AgentAccessPolicy): ResolvedAgentAccess & { source: "studio" } {
  const current = readStudioConfig().agentAccess ?? {};
  const next: AgentAccessPolicy = { ...current };
  const keys: (keyof AgentAccessPolicy)[] = [
    "mcpAccess",
    "allowJobInspection",
    "allowRecipeChanges",
    "allowJobSubmission",
    "allowJobCancellation",
  ];
  for (const k of keys) {
    if (typeof patch[k] === "boolean") next[k] = patch[k];
  }
  writeStudioConfig({ agentAccess: next });
  return getAgentAccessPublic();
}

export function denyUnless(
  predicate: (p: ResolvedAgentAccess) => boolean,
  reason: string,
): { ok: true; policy: ResolvedAgentAccess } | { ok: false; error: string; reason: string; policy: ResolvedAgentAccess } {
  const policy = resolveAgentAccess();
  if (!policy.mcpAccess) {
    return { ok: false, error: "mcp_access_disabled", reason: "MCP access is disabled in Studio settings", policy };
  }
  if (!predicate(policy)) {
    return { ok: false, error: "forbidden", reason, policy };
  }
  return { ok: true, policy };
}
