import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentAccess, updateAgentAccess } from "./agentAccess.ts";
import { writeStudioConfig } from "../../config.ts";

afterEach(() => {
  writeStudioConfig({ agentAccess: {} });
  delete process.env.OLIVE_MCP_ALLOW_JOBS;
  delete process.env.OLIVE_MCP_ALLOW_JOB_INSPECTION;
  delete process.env.OLIVE_MCP_ACCESS;
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
});
