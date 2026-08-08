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

/**
 * Determines whether an environment variable contains a recognized truthy value.
 *
 * @param name - The environment variable name
 * @returns `true` if the value is `1`, `true`, `yes`, or `on`, ignoring case and surrounding whitespace; `false` otherwise.
 */
function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Determines whether an environment variable contains a recognized false-like value.
 *
 * @param name - The environment variable name
 * @returns `true` if the value is `0`, `false`, `no`, or `off`, ignoring surrounding whitespace and letter case; `false` otherwise.
 */
function falsyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Resolves the effective agent access policy from Studio configuration and environment overrides.
 *
 * @returns The resolved access policy, including whether an environment override was applied
 */
export function resolveAgentAccess(): ResolvedAgentAccess {
  const disk = readStudioConfig().agentAccess ?? {};
  let mcpAccess = disk.mcpAccess !== false;
  let allowJobInspection = disk.allowJobInspection !== false;
  const allowRecipeChanges = disk.allowRecipeChanges !== false;
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

/**
 * Retrieves the effective Studio agent access policy for public consumption.
 *
 * @returns The resolved agent access policy with `source` set to `"studio"`
 */
export function getAgentAccessPublic(): ResolvedAgentAccess & { source: "studio" } {
  return { ...resolveAgentAccess(), source: "studio" };
}

/**
 * Updates the configured agent access policy with the supplied boolean settings.
 *
 * @param patch - Policy fields to update; only supported boolean values are applied.
 * @returns The resolved agent access policy with its source identified as `"studio"`.
 */
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

export type DenyUnlessResult =
  | { ok: true; policy: ResolvedAgentAccess }
  | {
      ok: false;
      error: string;
      reason: string;
      /** Which switch to flip — not the full resolved policy (avoids leaking env override detail on 403). */
      required?: Partial<
        Pick<
          ResolvedAgentAccess,
          "mcpAccess" | "allowJobInspection" | "allowJobSubmission" | "allowJobCancellation"
        >
      >;
    };

/**
 * True when the request looks like same-origin Studio UI (browser fetch / EventSource).
 *
 * Non-browser loopback clients (MCP, curl, scripts) omit Fetch Metadata, so omitting
 * `X-Olive-MCP-Agent` cannot bypass agent policy: those clients still hit `denyUnless`.
 */
export function isStudioUiRequest(req: { get: (name: string) => string | undefined }): boolean {
  return (req.get("sec-fetch-site") || "").toLowerCase() === "same-origin";
}

/**
 * Enforces the resolved MCP access policy for a request.
 *
 * @param predicate - Condition that the resolved policy must satisfy
 * @param reason - Explanation returned when the policy does not satisfy the condition
 * @returns The resolved policy when access is allowed, or a structured denial with an error and reason
 */
export function denyUnless(
  predicate: (p: ResolvedAgentAccess) => boolean,
  reason: string,
): DenyUnlessResult {
  const policy = resolveAgentAccess();
  if (!policy.mcpAccess) {
    return {
      ok: false,
      error: "mcp_access_disabled",
      reason: "MCP access is disabled in Studio settings",
      required: { mcpAccess: true },
    };
  }
  if (!predicate(policy)) {
    return { ok: false, error: "forbidden", reason };
  }
  return { ok: true, policy };
}

/**
 * Apply agent policy unless the caller is same-origin Studio UI.
 * Loopback alone is not an agent identity boundary.
 */
export function denyAgentUnlessUi(
  req: { get: (name: string) => string | undefined },
  predicate: (p: ResolvedAgentAccess) => boolean,
  reason: string,
): DenyUnlessResult | { ok: true; ui: true } {
  if (isStudioUiRequest(req)) {
    return { ok: true, ui: true };
  }
  return denyUnless(predicate, reason);
}
