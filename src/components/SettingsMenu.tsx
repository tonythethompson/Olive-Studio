import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Monitor, Sun, Moon, Zap, Search, Database, GraduationCap, Scale } from "lucide-react";
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
}): Promise<{
  ok: boolean;
  mcpSettings?: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean };
}> {
  try {
    const res = await fetch("/api/mcp/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      mcpSettings?: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean };
    };
    return { ok: true, mcpSettings: data.mcpSettings };
  } catch {
    return { ok: false };
  }
}

interface SettingsMenuProps {
  /** Replays the guided tour. The tour marks itself seen, so this is the anytime entry point. */
  onTakeTour?: () => void;
  onOpenLicense?: () => void;
}

/**
 * Settings menu for theme, MCP retrieval, and optionally starting the product tour.
 *
 * @param onTakeTour - Callback invoked when the user selects "Take the tour"
 * @param onOpenLicense - Callback invoked when the user opens the license view
 */
export function SettingsMenu({ onTakeTour, onOpenLicense }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [isRemoteMcp, setIsRemoteMcp] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Monotonically increasing write sequence counter for tracking setting requests. */
  const writeSeqRef = useRef(0);
  /** Last request sequence whose response was applied to state. */
  const lastAppliedSeqRef = useRef(0);
  /** Count of in-flight write requests. */
  const inFlightCountRef = useRef(0);

  const themePreference = usePreferencesStore((s) => s.themePreference);
  const setThemePreference = usePreferencesStore((s) => s.setThemePreference);
  const mcpRetrievalMode = usePreferencesStore((s) => s.mcpRetrievalMode);
  const setMcpRetrievalMode = usePreferencesStore((s) => s.setMcpRetrievalMode);
  const mcpPreloadEmbeddings = usePreferencesStore((s) => s.mcpPreloadEmbeddings);
  const setMcpPreloadEmbeddings = usePreferencesStore((s) => s.setMcpPreloadEmbeddings);

  const applyServerMcpSettings = useCallback(
    (serverSettings?: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean }) => {
      if (!serverSettings) return;
      if (serverSettings.retrievalMode) {
        setMcpRetrievalMode(serverSettings.retrievalMode);
      }
      if (typeof serverSettings.preloadEmbeddings === "boolean") {
        setMcpPreloadEmbeddings(serverSettings.preloadEmbeddings);
      }
    },
    [setMcpRetrievalMode, setMcpPreloadEmbeddings],
  );

  const handleThemeSelect = useCallback(
    (value: ThemePreference) => {
      setThemePreference(value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [setThemePreference],
  );

  const handleTakeTour = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
    onTakeTour?.();
  }, [onTakeTour]);

  const handleOpenLicense = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
    onOpenLicense?.();
  }, [onOpenLicense]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const currentSeq = writeSeqRef.current;
    void (async () => {
      try {
        const res = await fetch("/api/mcp/settings");
        if (!res.ok) return;
        const data = (await res.json()) as {
          mcpSettings?: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean };
          isRemote?: boolean;
        };
        if (cancelled || writeSeqRef.current !== currentSeq) return;
        setIsRemoteMcp(Boolean(data.isRemote));
        applyServerMcpSettings(data.mcpSettings);
      } catch {
        // Keep persisted local defaults if the server is unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, applyServerMcpSettings]);

  const performMcpSettingsUpdate = useCallback(
    async (
      patch: { retrievalMode?: McpRetrievalMode; preloadEmbeddings?: boolean },
      successUpdate: () => void,
      errorMessage: string,
    ) => {
      const seq = ++writeSeqRef.current;
      inFlightCountRef.current++;
      setRestarting(true);
      setSettingsError(null);

      const res = await updateMcpSettings(patch);

      inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
      if (inFlightCountRef.current === 0) {
        setRestarting(false);
      }

      if (seq >= lastAppliedSeqRef.current) {
        lastAppliedSeqRef.current = seq;
        if (res.ok) {
          if (res.mcpSettings) {
            applyServerMcpSettings(res.mcpSettings);
          } else {
            successUpdate();
          }
        } else {
          setSettingsError(errorMessage);
        }
      }
    },
    [applyServerMcpSettings],
  );

  const handleRetrievalModeSelect = useCallback(
    (value: McpRetrievalMode) => {
      void performMcpSettingsUpdate(
        { retrievalMode: value },
        () => setMcpRetrievalMode(value),
        "Could not apply retrieval mode.",
      );
    },
    [performMcpSettingsUpdate, setMcpRetrievalMode],
  );

  const handlePreloadToggle = useCallback(
    (enabled: boolean) => {
      void performMcpSettingsUpdate(
        { preloadEmbeddings: enabled },
        () => setMcpPreloadEmbeddings(enabled),
        "Could not apply embedding preload.",
      );
    },
    [performMcpSettingsUpdate, setMcpPreloadEmbeddings],
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
        data-tour="settings"
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
          {onOpenLicense && (
            <>
              <button
                ref={(el) => { itemRefs.current[itemIndex++] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-slate-300",
                  "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                )}
                onClick={handleOpenLicense}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenLicense();
                  }
                }}
              >
                <Scale className="h-3.5 w-3.5" />
                <span>MIT License</span>
              </button>
              <div className="my-1 border-t border-slate-700" role="separator" />
            </>
          )}

          {/* Theme section */}
          <div role="group" aria-labelledby="settings-theme-header">
            <div id="settings-theme-header" className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
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
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-slate-700" />

          {/* MCP Server section */}
          <div role="group" aria-labelledby="settings-mcp-header">
            <div id="settings-mcp-header" className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
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
                  disabled={restarting || isRemoteMcp}
                  aria-busy={restarting}
                  tabIndex={-1}
                  title={isRemoteMcp ? "Retrieval settings are managed by the remote MCP server" : hint}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                    "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                    value === mcpRetrievalMode
                      ? "text-electric-blue"
                      : "text-slate-300",
                    (restarting || isRemoteMcp) && "opacity-50 cursor-not-allowed",
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
          </div>

          {/* Preload embeddings toggle */}
          <div className="my-1 border-t border-slate-700" />
          <button
            ref={(el) => { itemRefs.current[itemIndex++] = el; }}
            type="button"
            role="menuitemcheckbox"
            aria-checked={mcpPreloadEmbeddings}
            disabled={restarting || isRemoteMcp}
            aria-busy={restarting}
            tabIndex={-1}
            title={isRemoteMcp ? "Retrieval settings are managed by the remote MCP server" : "Warm the embedding model at server startup for zero-latency first query"}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
              mcpPreloadEmbeddings ? "text-electric-blue" : "text-slate-300",
              (restarting || isRemoteMcp) && "opacity-50 cursor-not-allowed",
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

          {onTakeTour && (
            <>
              <div className="my-1 border-t border-slate-700" role="separator" />
              <button
                ref={(el) => { itemRefs.current[itemIndex++] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-slate-300",
                  "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                )}
                onClick={handleTakeTour}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTakeTour();
                  }
                }}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                <span>Take the tour</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
