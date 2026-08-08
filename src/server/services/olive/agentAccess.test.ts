import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { denyUnless, resolveAgentAccess, updateAgentAccess } from "./agentAccess.ts";
import { writeStudioConfig } from "../../config.ts";

function resetAgentAccessEnvAndDisk(): void {
  writeStudioConfig({ agentAccess: {} });
  delete process.env.OLIVE_MCP_ALLOW_JOBS;
  delete process.env.OLIVE_MCP_ALLOW_JOB_INSPECTION;
  delete process.env.OLIVE_MCP_ACCESS;
}

beforeEach(() => {
  resetAgentAccessEnvAndDisk();
});

afterEach(() => {
  resetAgentAccessEnvAndDisk();
});

describe("resolveAgentAccess", () => {
  it("defaults inspection on and submission off", () => {
    const p = resolveAgentAccess();
    expect(p.allowJobInspection).toBe(true);
    expect(p.allowJobSubmission).toBe(false);
    expect(p.allowJobCancellation).toBe(false);
    expect(p.mcpAccess).toBe(true);
  });

  it("reads disk policy", () => {
    updateAgentAccess({ allowJobSubmission: true, allowJobCancellation: true });
    const p = resolveAgentAccess();
    expect(p.allowJobSubmission).toBe(true);
    expect(p.allowJobCancellation).toBe(true);
  });

  it("OLIVE_MCP_ALLOW_JOBS enables submit and cancel", () => {
    process.env.OLIVE_MCP_ALLOW_JOBS = "1";
    const p = resolveAgentAccess();
    expect(p.allowJobSubmission).toBe(true);
    expect(p.allowJobCancellation).toBe(true);
    expect(p.envOverrideActive).toBe(true);
  });

  it("OLIVE_MCP_ALLOW_JOB_INSPECTION=0 denies inspection", () => {
    process.env.OLIVE_MCP_ALLOW_JOB_INSPECTION = "0";
    const p = resolveAgentAccess();
    expect(p.allowJobInspection).toBe(false);
    expect(p.envOverrideActive).toBe(true);
  });

  it("OLIVE_MCP_ACCESS=0 disables master MCP access", () => {
    process.env.OLIVE_MCP_ACCESS = "0";
    const p = resolveAgentAccess();
    expect(p.mcpAccess).toBe(false);
    expect(p.envOverrideActive).toBe(true);
  });
});

describe("denyUnless", () => {
  it("denies without returning the full resolved policy object", () => {
    process.env.OLIVE_MCP_ACCESS = "0";
    const gate = denyUnless((p) => p.allowJobSubmission, "submit disabled");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toBe("mcp_access_disabled");
      expect(gate.required).toEqual({ mcpAccess: true });
      expect(gate).not.toHaveProperty("policy");
    }
  });

  it("returns forbidden without policy payload when a capability is off", () => {
    const gate = denyUnless((p) => p.allowJobSubmission, "Job submission is disabled");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toBe("forbidden");
      expect(gate).not.toHaveProperty("policy");
    }
  });
});
