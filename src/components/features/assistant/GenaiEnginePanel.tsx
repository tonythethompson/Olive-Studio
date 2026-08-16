import { Download, HardDriveDownload, PackageCheck, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface GenaiModelStatus {
  ready: boolean;
  filesPresent: number;
  filesRequired: number;
  localSizeBytes: number;
}

interface GenaiStatus {
  venvReady: boolean;
  model: GenaiModelStatus;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold border",
        ok
          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
          : "bg-amber-500/10 border-amber-500/20 text-amber-300",
      )}
    >
      {label}
    </span>
  );
}

/**
 * Engine setup controls for the built-in GenAI provider: installs the Python
 * runtime and downloads the model the provider needs before first use.
 */
export function GenaiEnginePanel() {
  const [status, setStatus] = useState<GenaiStatus | null>(null);
  const [busy, setBusy] = useState<"setup" | "download" | null>(null);
  const [error, setError] = useState("");

  // Fetch resolves asynchronously, so the state update happens in the fetch
  // callback (external system sync), not in the effect body itself.
  const refresh = (signal?: AbortSignal) => {
    void fetch("/api/ai/genai/status", { signal })
      .then(async (r) => {
        if (!r.ok || signal?.aborted) return;
        setStatus((await r.json()) as GenaiStatus);
      })
      .catch(() => {
        // Server unreachable; the panel keeps its last known state.
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, []);

  const run = async (action: "setup" | "download", url: string) => {
    setBusy(action);
    setError("");
    try {
      const r = await fetch(url, { method: "POST" });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const venvReady = status?.venvReady ?? false;
  const model = status?.model;
  const modelReady = model?.ready ?? false;

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-300">Local engine setup</p>
        <button
          type="button"
          title="Re-check engine status"
          onClick={() => void refresh()}
          disabled={busy !== null}
          className="text-[11px] text-slate-400 hover:text-electric-blue disabled:opacity-40 flex items-center gap-0.5"
        >
          <RefreshCw className={cn("h-2.5 w-2.5", busy !== null && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <PackageCheck className="h-3 w-3" />
          Runtime engine
          <StatusBadge ok={venvReady} label={venvReady ? "Ready" : "Not installed"} />
        </div>
        <button
          type="button"
          disabled={busy !== null || venvReady}
          onClick={() => void run("setup", "/api/ai/genai/setup")}
          className="h-7 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] font-semibold text-slate-200 flex items-center gap-1.5"
        >
          {busy === "setup" ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {busy === "setup" ? "Installing…" : "Install engine"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <HardDriveDownload className="h-3 w-3" />
          Model files
          <StatusBadge
            ok={modelReady}
            label={
              modelReady
                ? "Ready"
                : model && model.filesRequired > 0
                  ? `${model.filesPresent}/${model.filesRequired} files`
                  : "Not downloaded"
            }
          />
        </div>
        <button
          type="button"
          disabled={busy !== null || modelReady}
          onClick={() => void run("download", "/api/ai/genai/download")}
          className="h-7 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] font-semibold text-slate-200 flex items-center gap-1.5"
        >
          {busy === "download" ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {busy === "download" ? "Downloading…" : "Download model"}
        </button>
      </div>

      <p className="text-[11px] text-slate-600 leading-snug">
        Install the engine and download the model before activating this provider. Both run once and are
        cached locally.
      </p>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}
