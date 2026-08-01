import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Route, RefreshCw, CheckCircle2, AlertTriangle, Terminal } from "lucide-react";

export interface RuntimeEnvStatus {
  venvExists: boolean;
  venvPython: string | null;
  venvScripts: string;
  oliveInstalled: boolean;
  oliveVersion: string | null;
  systemPython: string | null;
  configuredPython: string | null;
  venvOnUserPath: boolean;
  platform: string;
  hint: string;
  error?: string;
}

/**
 * Header control: show Python/Olive readiness and fix PATH / interpreter from the UI.
 */
export const RuntimeEnvControls = memo(function RuntimeEnvControls() {
  const [status, setStatus] = useState<RuntimeEnvStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pythonPath, setPythonPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/env/runtime");
      const data = (await res.json()) as RuntimeEnvStatus;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      if (data.configuredPython) setPythonPath(data.configuredPython);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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

  const savePython = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/env/python-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pythonPath }),
      });
      const data = (await res.json()) as RuntimeEnvStatus & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setMessage("Python path saved for this project.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearPython = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/env/python-path", { method: "DELETE" });
      const data = (await res.json()) as RuntimeEnvStatus & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setPythonPath("");
      setMessage("Cleared saved Python path.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addVenvToPath = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/env/venv-path", { method: "POST" });
      const data = (await res.json()) as RuntimeEnvStatus & {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setMessage(data.message ?? "Updated user PATH.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ensureVenvNow = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    setMessage("Installing Olive venv…");
    try {
      // Canonical route is NDJSON `/api/env/venv-install` (ensure-venv is a JSON alias).
      const res = await fetch("/api/env/venv-install", {
        method: "POST",
        headers: { Accept: "application/x-ndjson, application/json" },
      });
      if (!res.ok && !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (!res.body) {
        throw new Error(res.status === 404 ? "API route not found." : `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalOk: boolean | null = null;
      let finalError: string | undefined;
      let lastLog = "Installing Olive venv…";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type?: string; message?: string; ok?: boolean; error?: string };
          try {
            evt = JSON.parse(line) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === "log" && evt.message) {
            lastLog = evt.message;
            setMessage(evt.message);
          }
          if (evt.type === "done") {
            finalOk = evt.ok !== false;
            finalError = evt.error;
            if (evt.message) lastLog = evt.message;
          }
        }
      }

      if (finalOk === false) {
        throw new Error(finalError || lastLog || "Venv install failed");
      }
      if (finalOk === null) {
        throw new Error(finalError || lastLog || "Install stream ended without a done event");
      }
      if (!res.ok) {
        throw new Error(finalError || `HTTP ${res.status}`);
      }

      await refresh();
      setMessage("Olive venv ready.");
      setError(null);
    } catch (err: unknown) {
      setMessage(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const needsAttention = status && (!status.systemPython || !status.oliveInstalled || !status.venvExists);
  const pathOk = status?.venvOnUserPath;

  const runtimeTitle = status?.oliveInstalled
    ? `Olive ${status.oliveVersion ?? "ready"} in project .venv`
    : needsAttention
      ? "Python / Olive runtime needs setup. Click to install the project venv or set a Python path"
      : "Python / Olive runtime and PATH";

  const runtimeLabel = status?.oliveInstalled
    ? `Olive ${status.oliveVersion ?? "ok"}`
    : needsAttention
      ? "Setup runtime"
      : "Runtime";

  return (
    <div ref={rootRef} className="relative text-[11px] font-mono overflow-visible">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors px-1.5 py-1 rounded border border-transparent hover:border-slate-700/80"
        title={runtimeTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={runtimeTitle}
      >
        <Terminal className="h-3 w-3 text-slate-500" aria-hidden />
        {status?.oliveInstalled ? (
          <span className="text-emerald-600/90 flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {runtimeLabel}
          </span>
        ) : needsAttention ? (
          <span className="text-slate-400 flex items-center gap-0.5">
            <AlertTriangle className="h-3 w-3 text-amber-600/75" aria-hidden />
            {runtimeLabel}
          </span>
        ) : (
          <span className="text-slate-400">{runtimeLabel}</span>
        )}
        {status && !pathOk && status.venvExists && (
          <span className="text-slate-500" title="Project .venv Scripts/bin is not on your user PATH">
            · add PATH
          </span>
        )}
      </button>

      {open && menuPos && (
        <div
          id="runtime-env-menu"
          role="dialog"
          aria-label="Runtime and PATH setup"
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed z-50 w-[min(100vw-2rem,22rem)] rounded border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-3 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-200 font-sans">Runtime &amp; PATH</div>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed font-sans">
                {status?.hint ?? "Checking…"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-slate-500 hover:text-electric-blue p-0.5"
              title="Refresh"
              aria-label="Refresh runtime status"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
            <dt className="text-slate-500">System Python</dt>
            <dd className="text-slate-300 truncate" title={status?.systemPython ?? undefined}>
              {status?.systemPython ?? "not found"}
            </dd>
            <dt className="text-slate-500">Project .venv</dt>
            <dd className="text-slate-300">{status?.venvExists ? "present" : "missing"}</dd>
            <dt className="text-slate-500">olive-ai</dt>
            <dd className="text-slate-300">
              {status?.oliveInstalled ? (status.oliveVersion ?? "installed") : "not installed"}
            </dd>
            <dt className="text-slate-500">User PATH</dt>
            <dd className="text-slate-300">{status?.venvOnUserPath ? "includes .venv" : "no .venv"}</dd>
          </dl>

          <div className="space-y-1.5">
            <label className="block text-[10px] text-slate-400 font-sans" htmlFor="studio-python-path">
              Python 3.10–3.13 (3.12 recommended)
            </label>
            <div className="flex gap-1">
              <input
                id="studio-python-path"
                type="text"
                value={pythonPath}
                onChange={(e) => setPythonPath(e.target.value)}
                placeholder={
                  status?.platform === "win32" ? "C:\\Users\\…\\Python312\\python.exe" : "/usr/bin/python3.12"
                }
                className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-electric-blue outline-none"
              />
              <button
                type="button"
                disabled={busy || !pythonPath.trim()}
                onClick={() => void savePython()}
                className="shrink-0 px-2 py-1 rounded border border-slate-600 text-slate-200 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40 flex items-center gap-1 font-sans text-[10px]"
              >
                <FolderOpen className="h-3 w-3" />
                Save
              </button>
            </div>
            {status?.configuredPython && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearPython()}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-sans"
              >
                Clear saved path
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={busy || Boolean(status?.oliveInstalled && status?.venvExists)}
            onClick={() => void ensureVenvNow()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10 disabled:opacity-40 font-sans text-[11px]"
            title="Create project .venv and install olive-ai now (while you configure the pipeline)"
          >
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            {status?.oliveInstalled && status?.venvExists ? "Olive venv ready" : "Install Olive venv now"}
          </button>

          <button
            type="button"
            disabled={busy || !status?.venvExists || status.venvOnUserPath}
            onClick={() => void addVenvToPath()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-slate-600 text-slate-300 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40 font-sans text-[11px]"
            title={
              status?.venvOnUserPath
                ? "Already on user PATH"
                : "Prepend project .venv Scripts/bin to your user PATH"
            }
          >
            <Route className="h-3.5 w-3.5" />
            {status?.venvOnUserPath ? "Already on user PATH" : "Add project .venv to user PATH"}
          </button>

          <p className="text-[10px] text-slate-500 leading-relaxed font-sans">
            Install the Olive venv while you build the recipe. No need to wait for Execute Live. The app
            always uses the project <code className="text-slate-400">.venv</code> for runs.
          </p>

          {message && <p className="text-[10px] text-emerald-500 font-sans">{message}</p>}
          {error && <p className="text-[10px] text-red-400 font-sans">{error}</p>}
        </div>
      )}
    </div>
  );
});
