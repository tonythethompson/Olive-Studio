import { memo, useCallback, useEffect, useState } from "react";
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

  const savePython = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/env/python-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pythonPath }),
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
      const res = await fetch("/api/env/add-venv-to-path", { method: "POST" });
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
    try {
      const res = await fetch("/api/env/ensure-venv", { method: "POST" });
      const data = (await res.json()) as RuntimeEnvStatus & {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setMessage(data.message ?? "Olive venv ready.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const needsAttention = status && (!status.systemPython || !status.oliveInstalled || !status.venvExists);
  const pathOk = status?.venvOnUserPath;

  return (
    <div className="relative text-[11px] font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors"
        title="Python / Olive runtime and PATH"
      >
        <Terminal className="h-3 w-3 text-slate-500" />
        {status?.oliveInstalled ? (
          <span className="text-emerald-500 flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" />
            Olive {status.oliveVersion ?? "ok"}
          </span>
        ) : needsAttention ? (
          <span className="text-amber-500 flex items-center gap-0.5">
            <AlertTriangle className="h-3 w-3" />
            Runtime
          </span>
        ) : (
          <span className="text-slate-500">Runtime</span>
        )}
        {status && !pathOk && status.venvExists && (
          <span className="text-amber-600/90" title="Project .venv not on user PATH">
            · PATH
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-[min(100vw-2rem,22rem)] rounded border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-3 text-left">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-200 font-sans">Runtime &amp; PATH</div>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed font-sans">
                {status?.hint ?? "Checking…"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-slate-500 hover:text-electric-blue p-0.5"
              title="Refresh"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
            <dt className="text-slate-600">System Python</dt>
            <dd className="text-slate-300 truncate" title={status?.systemPython ?? undefined}>
              {status?.systemPython ?? "not found"}
            </dd>
            <dt className="text-slate-600">Project .venv</dt>
            <dd className="text-slate-300">{status?.venvExists ? "present" : "missing"}</dd>
            <dt className="text-slate-600">olive-ai</dt>
            <dd className="text-slate-300">
              {status?.oliveInstalled ? (status.oliveVersion ?? "installed") : "not installed"}
            </dd>
            <dt className="text-slate-600">User PATH</dt>
            <dd className="text-slate-300">{status?.venvOnUserPath ? "includes .venv" : "no .venv"}</dd>
          </dl>

          <div className="space-y-1.5">
            <label className="block text-[10px] text-slate-500 font-sans" htmlFor="studio-python-path">
              Python interpreter (if not on PATH)
            </label>
            <div className="flex gap-1">
              <input
                id="studio-python-path"
                type="text"
                value={pythonPath}
                onChange={(e) => setPythonPath(e.target.value)}
                placeholder={
                  status?.platform === "win32" ? "C:\\Users\\…\\Python313\\python.exe" : "/usr/bin/python3"
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

          <p className="text-[10px] text-slate-600 leading-relaxed font-sans">
            Install the Olive venv while you build the recipe — no need to wait for Execute Live. The app
            always uses the project <code className="text-slate-500">.venv</code> for runs.
          </p>

          {message && <p className="text-[10px] text-emerald-500 font-sans">{message}</p>}
          {error && <p className="text-[10px] text-red-400 font-sans">{error}</p>}
        </div>
      )}
    </div>
  );
});
