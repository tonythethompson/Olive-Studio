import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiProviderSettings } from "./useAiProviderSettings";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("useAiProviderSettings", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("calls onProviderCleared when handleCodexLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider")) return Promise.resolve(jsonResponse({ source: "none" }));
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/codex/logout", { method: "POST" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
  });

  it("clears retained Codex runtime provider and review on logout", async () => {
    const onProviderCleared = vi.fn();
    let providerDeleted = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        providerDeleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse(
            providerDeleted
              ? { source: "none" }
              : { source: "runtime", provider: "codex", model: "default" },
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("calls onProviderCleared when handleDevinLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("ai/provider")) return Promise.resolve(jsonResponse({ source: "none" }));
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleDevinLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/devin/logout", { method: "POST" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
  });

  it("clears retained Devin runtime provider and review on logout", async () => {
    const onProviderCleared = vi.fn();
    let providerDeleted = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        providerDeleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse(
            providerDeleted
              ? { source: "none" }
              : { source: "runtime", provider: "devin", model: "swe-1-6" },
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleDevinLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("clears review when retained Codex provider DELETE rejects after logout", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        return Promise.reject(new Error("network down"));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "codex", model: "default" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("clears local provider selection when DELETE returns a non-success status", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ error: "busy" }, { status: 500 }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "codex", model: "default" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("does not clear review when logging out of Codex while another provider is active", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "openai", model: "gpt-4o" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).not.toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).not.toHaveBeenCalled();
  });

  it("calls onProviderActivated after Devin sign-in completes while another runtime provider is active", async () => {
    const onProviderActivated = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/login/complete")) {
        return Promise.resolve(jsonResponse({ ok: true, name: "Ada" }));
      }
      if (urlStr.includes("devin/account")) {
        return Promise.resolve(jsonResponse({ signedIn: true, name: "Ada" }));
      }
      if (urlStr.includes("ai/models")) {
        return Promise.resolve(jsonResponse({ models: [], source: "fallback" }));
      }
      if (urlStr.includes("ai/provider") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "codex", model: "default" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated,
        onProviderCleared: vi.fn(),
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.selectProvider("devin");
      result.current.setDevinToken("browser-token");
    });
    await act(async () => {
      await result.current.handleDevinCompleteLogin();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/devin/login/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "browser-token" }),
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/provider",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"provider":"devin"'),
      }),
    );
    expect(onProviderActivated).toHaveBeenCalledTimes(1);
  });
});
