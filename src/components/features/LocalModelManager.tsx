import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Displays installed local models with search, grouping, loading, and unloading controls.
 *
 * @param activeModel - The active model identifier to highlight.
 * @param isOpen - Whether the sidebar is open and keyboard shortcuts are enabled.
 * @param engine - The engine whose models and errors are displayed.
 * @param onActivate - Called after a model is loaded with its identifier and engine source.
 * @param showTitle - Whether to display the section heading.
 * @param emptyHint - Message shown when no models are installed.
 */
export function LocalModelManager({
  activeModel,
  isOpen,
  engine = "all",
  onActivate,
  showTitle = true,
  emptyHint,
}: {
  activeModel?: string;
  isOpen: boolean;
  engine?: "lms" | "ollama" | "all";
  /** Called after a model is loaded into the local engine so the parent can set Active Provider. */
  onActivate?: (modelTag: string, source: "lms" | "ollama") => void | Promise<void>;
  /** When false, parent owns the section heading (Settings Local panel). */
  showTitle?: boolean;
  /** Shown when the engine has no installed models (after load finishes). */
  emptyHint?: string;
}) {
  const [models, setModels] = useState<Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedPublishers, setCollapsedPublishers] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const togglePublisher = (publisher: string) => {
    setCollapsedPublishers((prev) => {
      const next = new Set(prev);
      if (next.has(publisher)) next.delete(publisher);
      else next.add(publisher);
      return next;
    });
  };

  // Global Cmd+K / Ctrl+K to focus search input (only when sidebar is open)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q));
  }, [models, searchQuery]);

  // Group filtered models by publisher (first segment of model ID)
  const groupedModels = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }>>();
    for (const m of filteredModels) {
      const parts = m.id.split("/");
      const publisher = parts.length > 1 ? parts[0] : "Other";
      if (!groups.has(publisher)) groups.set(publisher, []);
      groups.get(publisher)!.push(m);
    }
    // Sort publishers alphabetically, 'Other' last
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }, [filteredModels]);

  const refresh = async (isCancelled?: () => boolean) => {
    setLoading(true);
    setError("");
    try {
      const fetchLms = engine === "lms" || engine === "all";
      const fetchOllama = engine === "ollama" || engine === "all";
      const [lmsRes, ollamaRes] = await Promise.allSettled([
        fetchLms ? fetch("/api/ai/local-models") : Promise.resolve(null),
        fetchOllama ? fetch("/api/ai/ollama-models") : Promise.resolve(null),
      ]);

      if (isCancelled?.()) return;

      const lmsModels: string[] = [];
      const ollamaModels: string[] = [];
      const lmsLoaded: string[] = [];
      const ollamaLoaded: string[] = [];

      if (fetchLms && lmsRes.status === "fulfilled" && lmsRes.value && lmsRes.value.ok) {
        const d = await lmsRes.value.json();
        lmsModels.push(...(d.installedModels || []));
        lmsLoaded.push(...(d.loadedModels || []));
      } else if (
        fetchLms &&
        engine === "lms" &&
        lmsRes.status === "fulfilled" &&
        lmsRes.value &&
        !lmsRes.value.ok
      ) {
        const d = (await lmsRes.value.json().catch(() => ({}))) as { error?: string };
        if (d.error && !isCancelled?.()) setError(d.error);
      }
      if (fetchOllama && ollamaRes.status === "fulfilled" && ollamaRes.value && ollamaRes.value.ok) {
        const d = await ollamaRes.value.json();
        ollamaModels.push(...(d.installedModels || []));
        ollamaLoaded.push(...(d.runningModels || []));
      } else if (
        fetchOllama &&
        engine === "ollama" &&
        ollamaRes.status === "fulfilled" &&
        ollamaRes.value &&
        !ollamaRes.value.ok
      ) {
        const d = (await ollamaRes.value.json().catch(() => ({}))) as { error?: string };
        if (d.error && !isCancelled?.()) setError(d.error);
      }

      if (isCancelled?.()) return;

      const allModels: Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }> = [];
      const seen = new Set<string>();
      if (fetchLms) {
        for (const id of lmsModels) {
          if (!seen.has(id)) {
            seen.add(id);
            allModels.push({ id, loaded: lmsLoaded.includes(id), source: "lms" });
          }
        }
      }
      if (fetchOllama) {
        for (const id of ollamaModels) {
          if (!seen.has(id)) {
            seen.add(id);
            allModels.push({ id, loaded: ollamaLoaded.includes(id), source: "ollama" });
          }
        }
      }
      if (!isCancelled?.()) setModels(allModels);
    } catch (err: unknown) {
      if (engine !== "all" && !isCancelled?.()) {
        setError(err instanceof Error ? err.message : "Failed to list local models");
      }
    } finally {
      if (!isCancelled?.()) setLoading(false);
    }
  };

  useEffect(() => {
    const cancelGuard = { cancelled: false };
    void refresh(() => cancelGuard.cancelled);
    return () => {
      cancelGuard.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const handleLoad = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setBusy(modelTag);
    setError("");
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-load" : "/api/ai/local-load";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      await refresh();
      if (onActivate) await onActivate(modelTag, source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(null);
    }
  };

  const handleUnload = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setBusy(modelTag);
    setError("");
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-unload" : "/api/ai/local-unload";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unload failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {showTitle ? (
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold">
            Installed Models
          </p>
        ) : (
          <span className="text-[10px] text-slate-500">
            {loading ? "Checking installed models…" : `${models.length} installed`}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-[10px] text-slate-500 hover:text-electric-blue transition-colors cursor-pointer"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!loading && models.length === 0 ? (
        <p className="text-[11px] text-slate-500 leading-relaxed py-1">
          {emptyHint ?? "No models installed for this engine yet."}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {models.length > 3 && (
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search models…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  searchInputRef.current?.blur();
                }
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 pr-5 text-[10px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {groupedModels.map(([publisher, pubModels]) => {
            const isCollapsed = collapsedPublishers.has(publisher);
            return (
              <div key={publisher}>
                <button
                  type="button"
                  onClick={() => togglePublisher(publisher)}
                  aria-expanded={!isCollapsed}
                  className="w-full flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200 font-mono font-bold uppercase tracking-wider cursor-pointer py-0.5"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  <span>{publisher}</span>
                  <span className="text-slate-600 font-normal">({pubModels.length})</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1 mt-0.5">
                    {pubModels.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px]"
                      >
                        <span
                          className="font-mono text-slate-300 truncate flex-1 flex items-center gap-1.5"
                          title={m.id}
                        >
                          {activeModel &&
                            (m.id === activeModel ||
                              activeModel.endsWith(m.id) ||
                              m.id.endsWith(activeModel)) && (
                              <span
                                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                                title="Active model"
                              />
                            )}
                          {m.id.split("/").pop() || m.id}
                        </span>
                        {m.loaded ? (
                          <button
                            type="button"
                            onClick={() => void handleUnload(m.id, m.source)}
                            disabled={busy === m.id}
                            className="text-[10px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {busy === m.id ? "…" : "Unload"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleLoad(m.id, m.source)}
                            disabled={busy === m.id}
                            className="text-[10px] px-2 py-0.5 rounded border border-electric-blue/30 text-electric-blue hover:bg-electric-blue/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {busy === m.id ? "…" : "Load"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {searchQuery.trim() && filteredModels.length === 0 && (
          <p className="text-[10px] text-slate-500 italic text-center py-1">
            No models match &quot;{searchQuery}&quot;
          </p>
        )}
      </div>
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
    </div>
  );
}
