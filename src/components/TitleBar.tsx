import { useCallback, useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Custom window chrome for Tauri (decorations: false).
 * Matches Olive Studio slate/olive palette; drag region for moving the window.
 * No-ops gracefully in plain browser / non-Tauri environments.
 */
export function TitleBar() {
  const [isTauri, setIsTauri] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const tauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    setIsTauri(Boolean(tauri));
    if (!tauri) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        const listener = await win.onResized(async () => {
          setMaximized(await win.isMaximized());
        });
        if (cancelled) {
          listener();
        } else {
          unlisten = listener;
        }
      } catch {
        /* not running under Tauri runtime */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const withWindow = useCallback(
    async (
      fn: (win: Awaited<ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>>) => void,
    ) => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await fn(getCurrentWindow());
      } catch {
        /* ignore */
      }
    },
    [],
  );

  if (!isTauri) return null;

  return (
    <div
      className="h-9 shrink-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 select-none"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2 pl-3 min-w-0" data-tauri-drag-region>
        <img src="/assets/logo.png" alt="" className="h-4 w-4 rounded object-contain pointer-events-none" />
        <span className="text-[11px] font-semibold text-slate-200 truncate pointer-events-none">
          Olive Studio
        </span>
        <span className="text-[10px] text-slate-600 hidden sm:inline pointer-events-none">
          Recipe builder
        </span>
      </div>

      <div className="flex items-stretch h-full" data-tauri-drag-region="false">
        <button
          type="button"
          aria-label="Minimize"
          className="w-11 h-full flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          onClick={() => void withWindow((w) => w.minimize())}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          className="w-11 h-full flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          onClick={() =>
            void withWindow(async (w) => {
              if (await w.isMaximized()) await w.unmaximize();
              else await w.maximize();
              setMaximized(await w.isMaximized());
            })
          }
        >
          {maximized ? <Copy className="h-3 w-3 rotate-180" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          aria-label="Close"
          className={cn(
            "w-11 h-full flex items-center justify-center text-slate-500",
            "hover:text-white hover:bg-rose-600 transition-colors",
          )}
          onClick={() => void withWindow((w) => w.close())}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
