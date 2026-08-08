import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AgentAccessControls } from "./AgentAccessControls";

const basePolicy = {
  mcpAccess: true,
  allowJobInspection: true,
  allowRecipeChanges: true,
  allowJobSubmission: false,
  allowJobCancellation: false,
  envOverrideActive: false,
  source: "studio",
};

describe("AgentAccessControls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/olive/agent-access") && (!init || init.method === "GET" || !init.method)) {
          return {
            ok: true,
            json: async () => ({ ok: true, policy: basePolicy }),
          } as Response;
        }
        if (url.includes("/api/olive/agent-access") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body ?? "{}")) as Record<string, boolean>;
          return {
            ok: true,
            json: async () => ({
              ok: true,
              policy: { ...basePolicy, ...body },
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({ error: "not found" }) } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads policy and toggles submission", async () => {
    render(<AgentAccessControls />);
    const openBtn = await screen.findByRole("button", { name: /Agent \/ MCP access policy/i });
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(document.getElementById("agent-access-allowJobSubmission")).toBeTruthy();
    });

    const submitToggle = document.getElementById(
      "agent-access-allowJobSubmission",
    ) as HTMLInputElement;
    expect(submitToggle.checked).toBe(false);

    fireEvent.click(submitToggle);

    await waitFor(() => {
      expect(
        (document.getElementById("agent-access-allowJobSubmission") as HTMLInputElement).checked,
      ).toBe(true);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/olive/agent-access",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
