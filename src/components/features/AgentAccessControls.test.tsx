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
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ allowJobSubmission: true }),
      }),
    );
  });

  it("drops an older policy update that resolves after a newer refresh", async () => {
    let resolvePut: (value: unknown) => void = () => {};
    const putPromise = new Promise((resolve) => {
      resolvePut = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/olive/agent-access") && method === "GET") {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              policy: { ...basePolicy, allowJobSubmission: false },
            }),
          } as Response;
        }
        if (url.includes("/api/olive/agent-access") && method === "PUT") {
          // The update stays in flight while a refresh starts and finishes.
          await putPromise;
          return {
            ok: true,
            json: async () => ({
              ok: true,
              policy: { ...basePolicy, allowJobSubmission: true },
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({ error: "not found" }) } as Response;
      }),
    );

    render(<AgentAccessControls />);
    const openBtn = await screen.findByRole("button", { name: /Agent \/ MCP access policy/i });
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(document.getElementById("agent-access-allowJobSubmission")).toBeTruthy();
    });

    // Start an update (PUT) that stays pending, then run a refresh that resolves first.
    const submitToggle = document.getElementById(
      "agent-access-allowJobSubmission",
    ) as HTMLInputElement;
    fireEvent.click(submitToggle);
    fireEvent.click(screen.getByRole("button", { name: /Refresh agent access policy/i }));

    // The newer refresh (GET) applied allowJobSubmission=false; resolve the stale PUT
    // afterwards — its result must be dropped, not applied over the refresh.
    resolvePut(undefined);
    await waitFor(() => {
      expect(submitToggle.checked).toBe(false);
    });
    // Give any delayed busy-clear a chance to run; the checkbox must stay false.
    await new Promise((r) => setTimeout(r, 350));
    expect(submitToggle.checked).toBe(false);
  });

  it("disables child toggles when mcpAccess is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/olive/agent-access") && (!init || init.method === "GET" || !init.method)) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              policy: { ...basePolicy, mcpAccess: false },
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({ error: "not found" }) } as Response;
      }),
    );

    render(<AgentAccessControls />);
    const openBtn = await screen.findByRole("button", { name: /Agent \/ MCP access policy/i });
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(document.getElementById("agent-access-allowJobSubmission")).toBeTruthy();
    });
    const submitToggle = document.getElementById(
      "agent-access-allowJobSubmission",
    ) as HTMLInputElement;
    expect(submitToggle.disabled).toBe(true);
  });

  it("shows env-override banner when policy.envOverrideActive is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/olive/agent-access") && (!init || init.method === "GET" || !init.method)) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              policy: { ...basePolicy, envOverrideActive: true },
            }),
          } as Response;
        }
        return { ok: false, json: async () => ({ error: "not found" }) } as Response;
      }),
    );

    render(<AgentAccessControls />);
    fireEvent.click(await screen.findByRole("button", { name: /Agent \/ MCP access policy/i }));
    await waitFor(() => {
      expect(screen.getByText(/Server env override active/i)).toBeTruthy();
    });
  });
});
