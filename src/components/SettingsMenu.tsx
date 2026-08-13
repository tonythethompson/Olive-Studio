import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Monitor, Sun, Moon, Zap, Search, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePreferencesStore,
  type ThemePreference,
  type McpRetrievalMode,
} from "@/lib/stores/preferencesStore";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Monitor }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const RETRIEVAL_MODE_OPTIONS: {
  value: McpRetrievalMode;
  label: string;
  Icon: typeof Search;
  hint: string;
}[] = [
  { value: "auto", label: "Auto", Icon: Zap, hint: "Semantic with keyword fallback" },
  { value: "semantic", label: "Semantic", Icon: Search, hint: "Embedding-based (requires model)" },
  { value: "keyword", label: "Keyword", Icon: Database, hint: "Fast, no model needed" },
];

async function updateMcpSettings(patch: {
  retrievalMode?: McpRetrievalMode;
  preloadEmbeddings?: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/mcp/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const themePreference = usePreferencesStore((s) => s.themePreference);
  const setThemePreference = usePreferencesStore((s) => s.setThemePreference);
  const mcpRetrievalMode = usePreferencesStore((s) => s.mcpRetrievalMode);
  const setMcpRetrievalMode = usePreferencesStore((s) => s.setMcpRetrievalMode);
  const mcpPreloadEmbeddings = usePreferencesStore((s) => s.mcpPreloadEmbeddings);
  const setMcpPreloadEmbeddings = usePreferencesStore((s) => s.setMcpPreloadEmbeddings);

  const handleThemeSelect = useCallback(
    (value: ThemePreference) => {
      setThemePreference(value);
    },
    [setThemePreference],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mcp/settings");
        if (!res.ok) return;
        const data = (await res.json()) as {
          mcpSettings?: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean };
        };
        if (cancelled) return;
        const server = data.mcpSettings;
        if (server?.retrievalMode) setMcpRetrievalMode(server.retrievalMode);
        if (typeof server?.preloadEmbeddings === "boolean") {
          setMcpPreloadEmbeddings(server.preloadEmbeddings);
        }
      } catch {
        // Keep persisted local defaults if the server is unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, setMcpRetrievalMode, setMcpPreloadEmbeddings]);

  const handleRetrievalModeSelect = useCallback(
    async (value: McpRetrievalMode) => {
      setRestarting(true);
      setSettingsError(null);
      const ok = await updateMcpSettings({ retrievalMode: value });
      if (ok) setMcpRetrievalMode(value);
      else setSettingsError("Could not apply retrieval mode.");
      setRestarting(false);
    },
    [setMcpRetrievalMode],
  );

  const handlePreloadToggle = useCallback(
    async (enabled: boolean) => {
      setRestarting(true);
      setSettingsError(null);
      const ok = await updateMcpSettings({ preloadEmbeddings: enabled });
      if (ok) setMcpPreloadEmbeddings(enabled);
      else setSettingsError("Could not apply embedding preload.");
      setRestarting(false);
    },
    [setMcpPreloadEmbeddings],
  );

  // Focus first menu item when menu opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        itemRefs.current[0]?.focus();
      });
    }
  }, [open]);

  // Keyboard navigation within menu
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

      switch (e.key) {
        case "Escape":
          setOpen(false);
          triggerRef.current?.focus();
          e.preventDefault();
          break;
        case "ArrowDown": {
          e.preventDefault();
          const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
          items[next]?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
          items[prev]?.focus();
          break;
        }
        case "Home":
          e.preventDefault();
          items[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
      }
    },
    [],
  );

  // Close on outside pointer
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            triggerRef.current?.focus();
          }
        });
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  let itemIndex = 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "p-1.5 rounded text-slate-500 hover:text-slate-200 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Settings"
          className={cn(
            "absolute right-0 top-full mt-1 z-50 min-w-[200px]",
            "rounded border border-slate-700 bg-slate-900 shadow-lg py-1",
          )}
          onKeyDown={handleMenuKeyDown}
        >
          {/* Theme section */}
          <div className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
            Theme
          </div>
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const idx = itemIndex++;
            return (
              <button
                key={value}
                ref={(el) => { itemRefs.current[idx] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={value === themePreference}
                tabIndex={-1}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                  "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                  value === themePreference
                    ? "text-electric-blue"
                    : "text-slate-300",
                )}
                onClick={() => handleThemeSelect(value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleThemeSelect(value);
                  }
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                {value === themePreference && (
                  <span className="ml-auto text-[10px]">✓</span>
                )}
              </button>
            );
          })}

          {/* Divider */}
          <div className="my-1 border-t border-slate-700" />

          {/* MCP Server section */}
          <div className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
            MCP Retrieval
          </div>
          {RETRIEVAL_MODE_OPTIONS.map(({ value, label, Icon, hint }) => {
            const idx = itemIndex++;
            return (
              <button
                key={value}
                ref={(el) => { itemRefs.current[idx] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={value === mcpRetrievalMode}
                tabIndex={-1}
                title={hint}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                  "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                  value === mcpRetrievalMode
                    ? "text-electric-blue"
                    : "text-slate-300",
                )}
                onClick={() => handleRetrievalModeSelect(value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRetrievalModeSelect(value);
                  }
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                {value === mcpRetrievalMode && (
                  <span className="ml-auto text-[10px]">✓</span>
                )}
              </button>
            );
          })}

          {/* Preload embeddings toggle */}
          <div className="my-1 border-t border-slate-700" />
          <button
            ref={(el) => { itemRefs.current[itemIndex++] = el; }}
            type="button"
            role="menuitemcheckbox"
            aria-checked={mcpPreloadEmbeddings}
            tabIndex={-1}
            title="Warm the embedding model at server startup for zero-latency first query"
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
              mcpPreloadEmbeddings ? "text-electric-blue" : "text-slate-300",
            )}
            onClick={() => handlePreloadToggle(!mcpPreloadEmbeddings)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handlePreloadToggle(!mcpPreloadEmbeddings);
              }
            }}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Preload Embeddings</span>
            {mcpPreloadEmbeddings && (
              <span className="ml-auto text-[10px]">✓</span>
            )}
          </button>

          {/* Restart indicator */}
          {restarting && (
            <div className="px-3 py-1.5 text-[11px] text-slate-500 italic">
              Restarting MCP server...
            </div>
          )}
          {settingsError && !restarting && (
            <div className="px-3 py-1.5 text-[11px] text-rose-500" role="alert">
              {settingsError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
