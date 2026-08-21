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

  describe("persisted provider/model preference", () => {
    const STORAGE_KEY = "olive-studio:ai-model-pref";
    const seedPref = (provider: string, model: string) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, model }));

    const renderSettings = () =>
      renderHook(() =>
        useAiProviderSettings({
          isOpen: false,
          activeTab: "settings",
          onProviderActivated: vi.fn(),
          onProviderCleared: vi.fn(),
          onProviderMissing: vi.fn(),
        }),
      );

    it("defaults to Gemini when no preference is stored", () => {
      const { result } = renderSettings();
      expect(result.current.settingsProvider).toBe("gemini");
      expect(result.current.settingsModel).toBe("gemini-3.7-flash");
    });

    it("restores a previously persisted provider/model on initial render", () => {
      seedPref("anthropic", "claude-sonnet-4-6");
      const { result } = renderSettings();
      expect(result.current.settingsProvider).toBe("anthropic");
      expect(result.current.settingsModel).toBe("claude-sonnet-4-6");
    });

    it("falls back to the provider default when the persisted model was removed from the catalog", () => {
      seedPref("gemini", "gemini-2.5-flash");
      const { result } = renderSettings();
      expect(result.current.settingsProvider).toBe("gemini");
      expect(result.current.settingsModel).toBe("gemini-3.7-flash");
    });

    it("rejects a persisted model that does not belong to the persisted provider", () => {
      seedPref("openai", "gemini-3.7-flash");
      const { result } = renderSettings();
      expect(result.current.settingsProvider).toBe("openai");
      expect(result.current.settingsModel).toBe("gpt-4o");
    });

    it("accepts a freehand model for providers with an empty static catalog", () => {
      seedPref("openai-compat", "my-fine-tuned-model");
      const { result } = renderSettings();
      expect(result.current.settingsProvider).toBe("openai-compat");
      expect(result.current.settingsModel).toBe("my-fine-tuned-model");
    });

    it("persists the current selection back to localStorage when it changes", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => Promise.resolve(jsonResponse({ models: [], source: "fallback" })));

      const { result } = renderSettings();
      await act(async () => {
        result.current.selectProvider("openai");
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
        provider: "openai",
        model: "gpt-4o",
      });
    });
  });
});
