import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { consumeInstallNdjson } from "@/lib/runtimeEnvNdjson";
import { RuntimeEnvMenu } from "@/components/features/runtime/RuntimeEnvMenu";
import {
  runtimeLabelFor,
  runtimeNeedsAttention,
  runtimeTitleFor,
} from "@/components/features/runtime/runtimeEnvLabels";
import type { RuntimeEnvStatus } from "@/components/features/runtime/runtimeEnvTypes";

export type { RuntimeEnvStatus };

interface RuntimeEnvControlsProps {
  compact?: boolean;
}

export const RuntimeEnvControls = memo(function RuntimeEnvControls({ compact = false }: RuntimeEnvControlsProps) {
  const [status, setStatus] = useState<RuntimeEnvStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pythonPath, setPythonPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/env/runtime");
      const data = (await res.json()) as RuntimeEnvStatus;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      if (data.configuredPython) setPythonPath(data.configuredPython);
      setError(null);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateMenuPos = useCallback(() => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const menuWidth = Math.min(window.innerWidth - 32, 22 * 16);
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - menuWidth - 16);
    setMenuPos({ top: rect.bottom + 8, left });
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        const menu = document.getElementById("runtime-env-menu");
        if (menu?.contains(event.target as Node)) return;
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, { capture: true, passive: true });
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updateMenuPos]);

  const runJsonAction = async (fn: () => Promise<void>, initialMessage: string | null = null) => {
    setBusy(true);
    setMessage(initialMessage);
    setError(null);
    try {
      await fn();
    } catch (err: unknown) {
      setMessage(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const savePython = () =>
    runJsonAction(async () => {
      const res = await fetch("/api/env/python-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pythonPath }),
      });
      const data = (await res.json()) as RuntimeEnvStatus & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setMessage("Python path saved for this project.");
    });

  const clearPython = () =>
    runJsonAction(async () => {
      const res = await fetch("/api/env/python-path", { method: "DELETE" });
      const data = (await res.json()) as RuntimeEnvStatus & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setPythonPath("");
      setMessage("Cleared saved Python path.");
    });

  const addVenvToPath = () =>
    runJsonAction(async () => {
      const res = await fetch("/api/env/venv-path", { method: "POST" });
      const data = (await res.json()) as RuntimeEnvStatus & { ok?: boolean; error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setMessage(data.message ?? "Updated user PATH.");
    });

  const runNdjsonInstall = async (
    url: string,
    initialMessage: string,
    fallbackError: string,
    success: string,
  ) =>
    runJsonAction(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/x-ndjson, application/json" },
      });
      const result = await consumeInstallNdjson(res, fallbackError, setMessage);
      if (!result.ok) throw new Error(result.error ?? fallbackError);
      if (!(await refresh())) return;
      setMessage(success);
    }, initialMessage);

  const copyInstallCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setMessage("Install command copied.");
      setError(null);
    } catch {
      setError("Could not copy the install command.");
    }
  };

  const needsAttention = runtimeNeedsAttention(status);
  const runtimeTitle = runtimeTitleFor(status, needsAttention);
  const runtimeLabel = runtimeLabelFor(status, needsAttention);
  const pathOk = status?.venvOnUserPath;

  return (
    <div ref={rootRef} className="relative text-[clamp(0.625rem,0.55rem+0.3vw,0.75rem)] font-mono overflow-visible">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors px-1.5 py-1 rounded border border-transparent hover:border-slate-700/80",
          compact ? "gap-0" : "gap-1.5",
        )}
        title={runtimeTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={runtimeTitle}
      >
        <Terminal className="h-3 w-3 text-slate-500" aria-hidden />
        {status?.oliveInstalled ? (
          <span className="text-emerald-600/90 flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            <span className={compact ? "hidden" : "inline"}>{runtimeLabel}</span>
          </span>
        ) : needsAttention ? (
          <span className="text-slate-400 flex items-center gap-0.5">
            <AlertTriangle className="h-3 w-3 text-amber-600/75" aria-hidden />
            <span className={compact ? "hidden" : "inline"}>{runtimeLabel}</span>
          </span>
        ) : (
          <span className={cn("text-slate-400", compact ? "hidden" : "inline")}>{runtimeLabel}</span>
        )}
        {status && !pathOk && status.venvExists && (
          <span
            className={cn("text-slate-500", compact ? "hidden" : "inline")}
            title="Project .venv Scripts/bin is not on your user PATH"
          >
            · add PATH
          </span>
        )}
      </button>

      {open && menuPos && (
        <RuntimeEnvMenu
          status={status}
          busy={busy}
          pythonPath={pythonPath}
          message={message}
          error={error}
          menuPos={menuPos}
          onRefresh={() => void refresh()}
          onPythonPathChange={setPythonPath}
          onSavePython={() => void savePython()}
          onClearPython={() => void clearPython()}
          onInstallPython={() =>
            void runNdjsonInstall(
              "/api/env/install-python",
              "Installing Python…",
              "Could not install Python.",
              "Python is ready.",
            )
          }
          onCopyCommand={(cmd) => void copyInstallCommand(cmd)}
          onEnsureVenv={() =>
            void runNdjsonInstall(
              "/api/env/venv-install",
              "Installing Olive venv…",
              "Could not install Olive venv.",
              "Olive venv ready.",
            )
          }
          onAddVenvToPath={() => void addVenvToPath()}
        />
      )}
    </div>
  );
});
