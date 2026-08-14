/**
 * Runtime & PATH dialog. Split into small views so no one method trips
 * CodeFactor's complexity budget.
 */
import { FolderOpen, RefreshCw, Route, Terminal } from "lucide-react";
import type { RuntimeEnvStatus } from "@/components/features/runtime/runtimeEnvTypes";
import { PythonMissingInstall } from "@/components/features/runtime/PythonMissingInstall";

export type RuntimeEnvMenuProps = {
  status: RuntimeEnvStatus | null;
  busy: boolean;
  pythonPath: string;
  message: string | null;
  error: string | null;
  menuPos: { top: number; left: number };
  onRefresh: () => void;
  onPythonPathChange: (value: string) => void;
  onSavePython: () => void;
  onClearPython: () => void;
  onInstallPython: () => void;
  onCopyCommand: (command: string) => void;
  onEnsureVenv: () => void;
  onAddVenvToPath: () => void;
};

function RuntimeEnvMenuHeader({
  hint,
  busy,
  onRefresh,
}: {
  hint: string;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-sm font-semibold text-slate-200 font-sans">Runtime &amp; PATH</div>
        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed font-sans">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="text-slate-500 hover:text-electric-blue p-0.5"
        title="Refresh"
        aria-label="Refresh runtime status"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function RuntimeEnvStatusList({ status }: { status: RuntimeEnvStatus | null }) {
  const oliveLabel = status?.oliveInstalled ? (status.oliveVersion ?? "installed") : "not installed";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
      <dt className="text-slate-500">System Python</dt>
      <dd className="text-slate-300 truncate" title={status?.systemPython ?? undefined}>
        {status?.systemPython ?? "not found"}
      </dd>
      <dt className="text-slate-500">Project .venv</dt>
      <dd className="text-slate-300">{status?.venvExists ? "present" : "missing"}</dd>
      <dt className="text-slate-500">olive-ai</dt>
      <dd className="text-slate-300">{oliveLabel}</dd>
      <dt className="text-slate-500">User PATH</dt>
      <dd className="text-slate-300">{status?.venvOnUserPath ? "includes .venv" : "no .venv"}</dd>
    </dl>
  );
}

function RuntimePythonPathField({
  status,
  busy,
  pythonPath,
  onPythonPathChange,
  onSavePython,
  onClearPython,
}: {
  status: RuntimeEnvStatus | null;
  busy: boolean;
  pythonPath: string;
  onPythonPathChange: (value: string) => void;
  onSavePython: () => void;
  onClearPython: () => void;
}) {
  const placeholder =
    status?.platform === "win32" ? "C:\\Users\\…\\Python312\\python.exe" : "/usr/bin/python3.12";
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-slate-400 font-sans" htmlFor="studio-python-path">
        Python 3.10–3.13 (3.12 recommended)
      </label>
      <div className="flex gap-1">
        <input
          id="studio-python-path"
          type="text"
          value={pythonPath}
          onChange={(e) => onPythonPathChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-electric-blue outline-none"
        />
        <button
          type="button"
          disabled={busy || !pythonPath.trim()}
          onClick={onSavePython}
          className="shrink-0 px-2 py-1 rounded border border-slate-600 text-slate-200 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40 flex items-center gap-1 font-sans text-[11px]"
        >
          <FolderOpen className="h-3 w-3" />
          Save
        </button>
      </div>
      {status?.configuredPython && (
        <button
          type="button"
          disabled={busy}
          onClick={onClearPython}
          className="text-[11px] text-slate-500 hover:text-slate-300 font-sans"
        >
          Clear saved path
        </button>
      )}
    </div>
  );
}

function RuntimeVenvActions({
  status,
  busy,
  onEnsureVenv,
  onAddVenvToPath,
}: {
  status: RuntimeEnvStatus | null;
  busy: boolean;
  onEnsureVenv: () => void;
  onAddVenvToPath: () => void;
}) {
  const venvReady = Boolean(status?.oliveInstalled && status?.venvExists);
  const onPath = Boolean(status?.venvOnUserPath);
  return (
    <>
      <button
        type="button"
        disabled={busy || venvReady}
        onClick={onEnsureVenv}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10 disabled:opacity-40 font-sans text-xs"
        title="Create project .venv and install olive-ai now (while you configure the pipeline)"
      >
        {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
        {venvReady ? "Olive venv ready" : "Install Olive venv now"}
      </button>
      <button
        type="button"
        disabled={busy || !status?.venvExists || onPath}
        onClick={onAddVenvToPath}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-slate-600 text-slate-300 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40 font-sans text-xs"
        title={onPath ? "Already on user PATH" : "Prepend project .venv Scripts/bin to your user PATH"}
      >
        <Route className="h-3.5 w-3.5" />
        {onPath ? "Already on user PATH" : "Add project .venv to user PATH"}
      </button>
    </>
  );
}

export function RuntimeEnvMenu({
  status,
  busy,
  pythonPath,
  message,
  error,
  menuPos,
  onRefresh,
  onPythonPathChange,
  onSavePython,
  onClearPython,
  onInstallPython,
  onCopyCommand,
  onEnsureVenv,
  onAddVenvToPath,
}: RuntimeEnvMenuProps) {
  return (
    <div
      id="runtime-env-menu"
      role="dialog"
      aria-label="Runtime and PATH setup"
      style={{ top: menuPos.top, left: menuPos.left }}
      className="fixed z-50 w-[min(100vw-2rem,22rem)] rounded border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-3 text-left"
    >
      <RuntimeEnvMenuHeader hint={status?.hint ?? "Checking…"} busy={busy} onRefresh={onRefresh} />
      <RuntimeEnvStatusList status={status} />
      {!status?.systemPython && (
        <PythonMissingInstall
          prereq={status?.pythonPrerequisite}
          busy={busy}
          onInstall={onInstallPython}
          onCopyCommand={onCopyCommand}
        />
      )}
      <RuntimePythonPathField
        status={status}
        busy={busy}
        pythonPath={pythonPath}
        onPythonPathChange={onPythonPathChange}
        onSavePython={onSavePython}
        onClearPython={onClearPython}
      />
      <RuntimeVenvActions
        status={status}
        busy={busy}
        onEnsureVenv={onEnsureVenv}
        onAddVenvToPath={onAddVenvToPath}
      />
      <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
        Install the Olive venv while you build the recipe. No need to wait for Execute Live. The app always uses
        the project <code className="text-slate-400">.venv</code> for runs.
      </p>
      {message && <p className="text-[11px] text-emerald-500 font-sans">{message}</p>}
      {error && <p className="text-[11px] text-red-400 font-sans">{error}</p>}
    </div>
  );
}
