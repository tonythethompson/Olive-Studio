import { useCallback, useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders custom Tauri window controls for Olive Studio.
 *
 * @returns The title bar in Tauri, or `null` in other environments.
 */
export function TitleBar() {
  const [isTauri, setIsTauri] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const tauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      fn: (win: Awaited<ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>>) => void | Promise<void>,
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
      className="h-8 shrink-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 select-none"
      data-tauri-drag-region
    >
      <div className="flex-1 h-full" data-tauri-drag-region />

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
