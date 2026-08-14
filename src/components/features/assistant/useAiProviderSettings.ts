import { useState, useEffect, useMemo, useRef } from "react";
import { canActivateWithEnvKey, hydratedSettingsBaseUrl } from "@/lib/envCredentialUi";
import { openExternal } from "@/lib/openExternal";
import { PROVIDER_OPTIONS, normalizeUiProviderId, type ProviderId } from "./aiProviderCatalog";
import type { ProviderStatus, SidebarTab } from "./types";

interface UseAiProviderSettingsOptions {
  isOpen: boolean;
  activeTab: SidebarTab;
  /** Called after a provider is saved / signed in and is ready for audit + chat. */
  onProviderActivated: () => void;
  /** Called after the active provider is cleared. */
  onProviderCleared: () => void;
  /** Called on open when no provider is configured at all. */
  onProviderMissing: () => void;
}

export type AiProviderSettings = ReturnType<typeof useAiProviderSettings>;

function isLocalAllowEmptyKey(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function validateApiKeyProviderForm(input: {
  settingsProvider: ProviderId;
  key: string;
  model: string;
  isCompatMode: boolean;
  resolvedBaseUrl: string | undefined;
  cloudflareAccountId: string;
  envUsable: boolean;
}): string | null {
  const allowEmptyKey =
    input.envUsable ||
    input.settingsProvider === "openai-compat" ||
    isLocalAllowEmptyKey(input.resolvedBaseUrl);
  if (input.settingsProvider === "cloudflare") {
    // Env-only activation requires both manual fields empty. A partial paste is rejected.
    if (input.envUsable && Boolean(input.key) !== Boolean(input.cloudflareAccountId)) {
      return input.key
        ? "Enter a Cloudflare account ID, or clear the token to use env credentials."
        : "Enter a Cloudflare API token, or clear the account ID to use env credentials.";
    }
    if (!input.key && !input.envUsable) return "Enter a Cloudflare API token.";
    if (!input.cloudflareAccountId && !input.envUsable) {
      return "Enter a Cloudflare account ID (CLOUDFLARE_ACCOUNT_ID).";
    }
  } else if (!input.key && !allowEmptyKey) {
    return "Enter an API key.";
  }
  if (!input.model || input.model === "n/a") {
    return input.isCompatMode ? "Enter a model name." : "Select a model.";
  }
  if (input.isCompatMode && !input.resolvedBaseUrl) {
    return "Base URL is required for OpenAI-compatible providers.";
  }
  return null;
}

async function persistApiKeyProvider(input: {
  settingsProvider: ProviderId;
  key: string;
  model: string;
  resolvedBaseUrl: string | undefined;
  cloudflareAccountId: string;
}): Promise<void> {
  // Paste path: store token+account. Env-usable path skips this and relies on server resolve.
  if (input.settingsProvider === "cloudflare" && input.key && input.cloudflareAccountId) {
    const credRes = await fetch("/api/cloudflare/login/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: input.key, accountId: input.cloudflareAccountId }),
    });
    const credData = (await credRes.json().catch(() => ({}))) as { error?: string };
    if (!credRes.ok) throw new Error(credData.error || `HTTP ${credRes.status}`);
  }
  const r = await fetch("/api/ai/provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: input.settingsProvider,
      apiKey: input.key || undefined,
      model: input.model,
      baseUrl: input.resolvedBaseUrl,
    }),
  });
  const contentType = r.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
}

/**
 * Manages AI provider settings, model catalogs, provider status, and Codex and Devin authentication flows.
 *
 * @param options - Hook state and lifecycle callbacks for the settings interface
 * @returns Provider configuration state, form controls, model refresh operations, authentication handlers, and provider activation controls
 */
export function useAiProviderSettings({
  isOpen,
  activeTab,
  onProviderActivated,
  onProviderCleared,
  onProviderMissing,
}: UseAiProviderSettingsOptions) {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ source: "none" });
  const [settingsProvider, setSettingsProvider] = useState<ProviderId>("gemini");
  const [settingsModel, setSettingsModel] = useState("gemini-2.5-flash");
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsBaseUrl, setSettingsBaseUrl] = useState("");
  const [settingsCloudflareAccountId, setSettingsCloudflareAccountId] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
  const [codexAccount, setCodexAccount] = useState<{
    ready?: boolean;
    account?: { type?: string; email?: string | null; planType?: string } | null;
    error?: string;
  } | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexMessage, setCodexMessage] = useState<string | null>(null);
  const [devinStatus, setDevinStatus] = useState<{
    signedIn?: boolean;
    name?: string;
    error?: string;
  } | null>(null);
  const [devinToken, setDevinToken] = useState("");
  const [devinModels, setDevinModels] = useState<Array<{ id: string; name: string }>>([]);
  const [devinBusy, setDevinBusy] = useState(false);
  const [devinMessage, setDevinMessage] = useState<string | null>(null);
  /** Live model lists keyed by provider — populated automatically on first selection. */
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState<"live" | "fallback" | null>(null);
  const [modelsHint, setModelsHint] = useState<string | null>(null);
  /** Providers already auto-refreshed this session (skip repeat unless force). */
  const modelsFetchedRef = useRef<Set<string>>(new Set());
  /** Sequence counter to guard against stale responses in refreshProviderModels. */
  const refreshSequenceRef = useRef(0);
  /** Last values used for model fetching to avoid redundant refetches. */
  const lastFetchedApiKeyRef = useRef<string>("");
  const lastFetchedBaseUrlRef = useRef<string>("");
  /**
   * True once the user (or a saved/active provider) deliberately chose a model id.
   * Lets catalog refresh preserve freehand ids without blocking the initial live list apply.
   */
  const userModelOverrideRef = useRef(false);

  const providerOption =
    PROVIDER_OPTIONS.find((p) => p.id === settingsProvider) ?? PROVIDER_OPTIONS[0]!;
  const isCompatMode = settingsProvider === "openai-compat" || !!providerOption.baseUrl;

  const isStaleRefresh = (sequence: number) => sequence !== refreshSequenceRef.current;

  const setSettingsModelFromUi = (modelId: string) => {
    userModelOverrideRef.current = true;
    setSettingsModel(modelId);
  };

  const setCustomModelFromUi = (modelId: string) => {
    userModelOverrideRef.current = true;
    setCustomModel(modelId);
  };

  const applyFetchedModels = (providerId: ProviderId, models: Array<{ id: string; label: string }>) => {
    setLiveModelsByProvider((prev) => ({ ...prev, [providerId]: models }));
    if (providerId === "devin") {
      setDevinModels(models.map((m) => ({ id: m.id, name: m.label })));
    }
    // Keep known selections. Preserve freehand only after an explicit UI/saved choice.
    setSettingsModel((current) => {
      if (models.some((m) => m.id === current)) return current;
      if (userModelOverrideRef.current && current.trim()) return current;
      return models[0]!.id;
    });
    setCustomModel((current) => {
      if (!current) return models[0]!.id;
      if (models.some((m) => m.id === current)) return current;
      if (userModelOverrideRef.current) return current;
      return models[0]!.id;
    });
  };

  const applyModelsResponse = (
    providerId: ProviderId,
    data: {
      models?: Array<{ id: string; label: string }>;
      source?: "live" | "fallback";
      error?: string;
    },
  ) => {
    const models = Array.isArray(data.models) ? data.models : [];
    if (models.length > 0) applyFetchedModels(providerId, models);
    setModelsSource(data.source ?? (models.length > 0 ? "live" : "fallback"));
    if (data.error && data.source === "fallback") {
      setModelsHint(data.error);
      return;
    }
    if (data.source === "live") setModelsHint(null);
  };

  /**
   * Fetch live model catalog for a provider on first selection (or force re-fetch).
   * Uses env/runtime keys on the server; optional client key/baseUrl for typed-but-unsaved creds.
   * Always falls back to PROVIDER_OPTIONS hardcodes if the live call fails or has no key.
   */
  const refreshProviderModels = async (
    providerId: ProviderId,
    opts?: { force?: boolean; apiKey?: string; baseUrl?: string },
  ) => {
    if (!opts?.force && modelsFetchedRef.current.has(providerId)) return;

    modelsFetchedRef.current.add(providerId);
    refreshSequenceRef.current += 1;
    const currentSequence = refreshSequenceRef.current;
    setModelsLoading(true);
    setModelsHint(null);

    const body: { provider: string; apiKey?: string; baseUrl?: string } = {
      provider: providerId,
    };
    const key = opts?.apiKey?.trim();
    const base = opts?.baseUrl?.trim();
    if (key) body.apiKey = key;
    if (base) body.baseUrl = base;

    try {
      const r = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as {
        models?: Array<{ id: string; label: string }>;
        source?: "live" | "fallback";
        error?: string;
      };
      if (isStaleRefresh(currentSequence)) return;
      applyModelsResponse(providerId, data);
    } catch (err: unknown) {
      if (isStaleRefresh(currentSequence)) return;
      setModelsSource("fallback");
      setModelsHint(err instanceof Error ? err.message : "Could not refresh models");
      // Allow retry on next selection if network failed entirely
      modelsFetchedRef.current.delete(providerId);
    } finally {
      if (!isStaleRefresh(currentSequence)) setModelsLoading(false);
    }
  };

  const fetchProviderStatus = async (signal?: AbortSignal): Promise<ProviderStatus> => {
    try {
      const r = signal ? await fetch("/api/ai/provider", { signal }) : await fetch("/api/ai/provider");
      if (signal?.aborted) return { source: "none" };
      const contentType = r.headers.get("content-type") ?? "";
      if (!r.ok || !contentType.includes("application/json")) {
        const fallback: ProviderStatus = { source: "none" };
        setProviderStatus(fallback);
        return fallback;
      }
      const d = (await r.json()) as ProviderStatus;
      if (signal?.aborted) return { source: "none" };
      setProviderStatus(d);
      if (d.provider) {
        const uiProvider = normalizeUiProviderId(d.provider);
        if (uiProvider) setSettingsProvider(uiProvider);
      }
      if (d.model) {
        userModelOverrideRef.current = true;
        setSettingsModel(d.model);
        setCustomModel(d.model);
      }
      // Null/empty/absent server baseUrl clears stale client URLs (e.g. left a local engine).
      setSettingsBaseUrl(hydratedSettingsBaseUrl(d.baseUrl));
      return d;
    } catch {
      if (signal?.aborted) return { source: "none" };
      const fallback: ProviderStatus = { source: "none" };
      setProviderStatus(fallback);
      return fallback;
    }
  };

  const refreshCodexAccount = async () => {
    try {
      const r = await fetch("/api/codex/account");
      const data = (await r.json()) as {
        ok?: boolean;
        ready?: boolean;
        account?: { type?: string; email?: string | null; planType?: string } | null;
        error?: string;
      };
      setCodexAccount(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCodexAccount({ ready: false, error: msg });
      return null;
    }
  };

  const refreshDevinAccount = async () => {
    try {
      const r = await fetch("/api/devin/account");
      const data = (await r.json()) as { signedIn?: boolean; name?: string; error?: string };
      setDevinStatus(data);
      if (data.signedIn) {
        // Prefer unified catalog (also fills liveModelsByProvider)
        await refreshProviderModels("devin", { force: true });
      }
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDevinStatus({ signedIn: false, error: msg });
      return null;
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load status on open
    fetchProviderStatus().then((status) => {
      if (status.source === "none") onProviderMissing();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Refresh Codex / Devin account + auto-load model list when Settings is open
  useEffect(() => {
    if (!isOpen || activeTab !== "settings") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load account + models
    if (settingsProvider === "codex") void refreshCodexAccount();
    if (settingsProvider === "devin") void refreshDevinAccount();
    void refreshProviderModels(settingsProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, settingsProvider]);

  /** Models shown in the dropdown: live catalog if loaded, else static PROVIDER_OPTIONS. */
  const displayedModels = useMemo(() => {
    if (settingsProvider === "devin" && devinModels.length > 0) {
      return devinModels.map((m) => ({ id: m.id, label: m.name }));
    }
    const live = liveModelsByProvider[settingsProvider];
    if (live && live.length > 0) return live;
    return providerOption.models.map((m) => ({ id: m, label: m }));
  }, [settingsProvider, devinModels, liveModelsByProvider, providerOption.models]);

  /** Switch provider: reset the dependent form fields and re-list models. */
  const selectProvider = (id: ProviderId) => {
    setSettingsProvider(id);
    const opt = PROVIDER_OPTIONS.find((p) => p.id === id)!;
    // Prefer cached live list; otherwise static default until fetch returns
    const cached = liveModelsByProvider[id];
    const first = cached?.[0]?.id ?? opt.models[0] ?? "";
    userModelOverrideRef.current = false;
    setSettingsModel(first);
    setCustomModel(id === "openai-compat" ? "" : first);
    setSettingsBaseUrl(opt.baseUrl ?? "");
    setModelsHint(null);
    // Always refresh model catalog on selection (first time auto; force if re-pick)
    void refreshProviderModels(id, { force: true });
  };

  /** Manual "Refresh" button next to the model dropdown. */
  const refreshModels = () =>
    void refreshProviderModels(settingsProvider, {
      force: true,
      // Omit empty paste so server uses runtime override / Windows+dotenv env keys.
      apiKey: settingsApiKey.trim() || undefined,
      baseUrl: settingsBaseUrl.trim() || providerOption.baseUrl || undefined,
    });

  /** Re-list models with the key the user just typed (env may already work). */
  const refreshModelsForTypedApiKey = () => {
    const trimmedKey = settingsApiKey.trim();
    if (trimmedKey && trimmedKey !== lastFetchedApiKeyRef.current) {
      lastFetchedApiKeyRef.current = trimmedKey;
      void refreshProviderModels(settingsProvider, {
        force: true,
        apiKey: trimmedKey,
        baseUrl: settingsBaseUrl || providerOption.baseUrl || undefined,
      });
    }
  };

  const refreshModelsForTypedBaseUrl = () => {
    const trimmedUrl = settingsBaseUrl.trim();
    if (trimmedUrl && trimmedUrl !== lastFetchedBaseUrlRef.current) {
      lastFetchedBaseUrlRef.current = trimmedUrl;
      void refreshProviderModels(settingsProvider, {
        force: true,
        apiKey: settingsApiKey || undefined,
        baseUrl: trimmedUrl,
      });
    }
  };

  /**
   * Codex/Devin logout clears auth cookies/tokens but leaves `/api/ai/provider`
   * pointing at that provider. Drop the runtime selection when it matches so
   * pipeline review results are not left displayed as current.
   */
  const clearReviewAfterAuthLogout = async (providerId: "codex" | "devin") => {
    const status = await fetchProviderStatus();
    const activeId = normalizeUiProviderId(status.provider ?? "") ?? status.provider;
    const shouldClearReview = status.source === "none" || activeId === providerId;
    if (status.source !== "none" && activeId === providerId) {
      try {
        const r = await fetch("/api/ai/provider", { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await fetchProviderStatus();
      } catch {
        // Auth is already gone. Drop local selection so reopening the sidebar
        // does not re-trigger analysis against the logged-out provider.
        setProviderStatus({ source: "none" });
      }
    }
    if (shouldClearReview) {
      onProviderCleared();
    }
  };

  const handleCodexLogin = async () => {
    setCodexBusy(true);
    setCodexMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/codex/login", { method: "POST" });
      const data = (await r.json()) as {
        ok?: boolean;
        authUrl?: string;
        error?: string;
        message?: string;
      };
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (data.authUrl) {
        void openExternal(data.authUrl);
      }
      setCodexMessage(data.message || "Complete sign-in in the browser, then click Refresh status.");
      // Poll account a few times after login window opens
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 2500));
        const acc = await refreshCodexAccount();
        if (acc?.ready) {
          setCodexMessage(
            `Signed in${acc.account && "planType" in (acc.account as object) ? ` (${(acc.account as { planType?: string }).planType})` : ""}. Codex is active for audit/chat.`,
          );
          await fetch("/api/ai/provider", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "codex", model: settingsModel || "default" }),
          });
          await fetchProviderStatus();
          onProviderActivated();
          break;
        }
      }
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexBusy(false);
    }
  };

  const handleCodexLogout = async () => {
    setCodexBusy(true);
    setCodexMessage(null);
    try {
      await fetch("/api/codex/logout", { method: "POST" });
      await refreshCodexAccount();
      setCodexMessage("Signed out of Codex.");
      // Logout clears Codex auth only; runtime /ai/provider can still be "codex".
      await clearReviewAfterAuthLogout("codex");
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexBusy(false);
    }
  };

  const handleDevinOpenSignIn = async () => {
    setDevinBusy(true);
    setDevinMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/devin/login");
      const data = (await r.json()) as { ok?: boolean; authUrl?: string; error?: string };
      if (!r.ok || !data.ok || !data.authUrl) throw new Error(data.error || `HTTP ${r.status}`);
      void openExternal(data.authUrl);
      setDevinMessage("Sign in in the browser, then paste the token shown on the page below.");
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  const handleDevinCompleteLogin = async () => {
    setDevinBusy(true);
    setDevinMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/devin/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: devinToken }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; name?: string; message?: string };
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setDevinToken("");
      setDevinMessage(data.message || `Signed in as ${data.name ?? "Devin"}.`);
      await refreshDevinAccount();
      await fetch("/api/ai/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "devin", model: settingsModel || "swe-1-6" }),
      });
      await fetchProviderStatus();
      onProviderActivated();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  const handleDevinLogout = async () => {
    setDevinBusy(true);
    try {
      await fetch("/api/devin/logout", { method: "POST" });
      setDevinStatus({ signedIn: false });
      setDevinMessage("Signed out of Devin.");
      // Logout clears Devin auth only; runtime /ai/provider can still be "devin".
      await clearReviewAfterAuthLogout("devin");
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  /** Point the server at Devin using the already-signed-in browser token. */
  const activateDevinProvider = async () => {
    if (!devinStatus?.signedIn) {
      setProviderSaveError("Sign in to Devin and paste the browser token first.");
      return;
    }
    setIsSavingProvider(true);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/ai/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "devin", model: settingsModel || "swe-1-6" }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      await fetchProviderStatus();
      onProviderActivated();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingProvider(false);
    }
  };

  /** Validate the manual form, then persist the key/model/base URL server-side. */
  const saveApiKeyProvider = async () => {
    const key = settingsApiKey.trim();
    const model = isCompatMode ? customModel.trim() || settingsModel : settingsModel;
    const resolvedBaseUrl = settingsBaseUrl.trim() || providerOption.baseUrl || undefined;
    const cloudflareAccountId = settingsCloudflareAccountId.trim();
    const envUsable = canActivateWithEnvKey(providerStatus.envCredentials, settingsProvider);
    const validationError = validateApiKeyProviderForm({
      settingsProvider,
      key,
      model,
      isCompatMode,
      resolvedBaseUrl,
      cloudflareAccountId,
      envUsable,
    });
    if (validationError) {
      setProviderSaveError(validationError);
      return;
    }
    setIsSavingProvider(true);
    setProviderSaveError("");
    try {
      await persistApiKeyProvider({
        settingsProvider,
        key,
        model,
        resolvedBaseUrl,
        cloudflareAccountId,
      });
      await fetchProviderStatus();
      setSettingsApiKey("");
      setSettingsCloudflareAccountId("");
      onProviderActivated();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : "Failed to save provider.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  /** Activate LM Studio / Ollama as openai-compat local provider. Returns true on success. */
  const enableLocalAiProvider = async (
    source: "lms" | "ollama",
    modelTag: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const baseUrl = source === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:1234/v1";
    setIsSavingProvider(true);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/ai/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compat",
          apiKey: "local",
          model: modelTag,
          baseUrl,
        }),
        signal,
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (signal?.aborted) return false;
      setSettingsProvider("openai-compat");
      userModelOverrideRef.current = true;
      setSettingsModel(modelTag);
      setCustomModel(modelTag);
      setSettingsBaseUrl(baseUrl);
      await fetchProviderStatus(signal);
      if (signal?.aborted) return false;
      // Stay on Settings after local enable (do not jump to Audit).
      return true;
    } catch (err: unknown) {
      if (signal?.aborted) return false;
      setProviderSaveError(err instanceof Error ? err.message : "Failed to enable local provider.");
      return false;
    } finally {
      setIsSavingProvider(false);
    }
  };

  /** Save button / Enter key: routes to the flow the selected provider needs. */
  const saveProvider = async () => {
    if (settingsProvider === "codex") {
      // Codex uses browser ChatGPT login, not an API key field
      await handleCodexLogin();
      return;
    }
    if (settingsProvider === "devin") {
      await activateDevinProvider();
      return;
    }
    await saveApiKeyProvider();
  };

  const clearProvider = async () => {
    await fetch("/api/ai/provider", { method: "DELETE" });
    await fetchProviderStatus();
    onProviderCleared();
  };

  return {
    providerStatus,
    providerOption,
    isCompatMode,
    settingsProvider,
    selectProvider,
    settingsModel,
    setSettingsModel: setSettingsModelFromUi,
    settingsApiKey,
    setSettingsApiKey,
    settingsCloudflareAccountId,
    setSettingsCloudflareAccountId,
    settingsBaseUrl,
    setSettingsBaseUrl,
    customModel,
    setCustomModel: setCustomModelFromUi,
    displayedModels,
    modelsLoading,
    modelsSource,
    modelsHint,
    refreshModels,
    refreshModelsForTypedApiKey,
    refreshModelsForTypedBaseUrl,
    isSavingProvider,
    providerSaveError,
    saveProvider,
    enableLocalAiProvider,
    clearProvider,
    refreshProviderStatus: fetchProviderStatus,
    codexAccount,
    codexBusy,
    codexMessage,
    refreshCodexAccount,
    handleCodexLogin,
    handleCodexLogout,
    devinStatus,
    devinBusy,
    devinMessage,
    devinToken,
    setDevinToken,
    refreshDevinAccount,
    handleDevinOpenSignIn,
    handleDevinCompleteLogin,
    handleDevinLogout,
  };
}
