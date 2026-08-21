/**
 * Arena slot convenience sources (Req 18): Olive outputs picker + Assistant snapshot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FolderOpen, Sparkles, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { OliveOutputEntry } from "@/lib/arenaOliveOutputs";
import {
  toCloudSlotPatch,
  type AssistantCloudSnapshotResponse,
} from "@/lib/arenaAssistantSnapshot";
import type { ArenaSlotConfig } from "@/lib/stores/playgroundStore";

type OliveListResponse = {
  roots: Array<{ label: "cache" | "output" }>;
  recent: OliveOutputEntry[];
  entries: OliveOutputEntry[];
};

function entryBasename(displayPath: string): string {
  const parts = displayPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || displayPath;
}

export interface FromOliveOutputsProps {
  slotLabel: string;
  onFile?: (file: File) => void;
  onSelect?: (entry: OliveOutputEntry) => void;
}

/**
 * Renders a local-mode panel for selecting Olive-generated model files.
 *
 * @param slotLabel - Label used to associate the panel with its model slot
 * @param onFile - Callback invoked with the selected model file (download mode)
 * @param onSelect - Callback invoked with the selected output entry (no download)
 */
export function FromOliveOutputs({ slotLabel, onFile, onSelect }: FromOliveOutputsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OliveListResponse | null>(null);
  // Ref guard: state updates are async, so concurrent clicks can both see fetchingId=null.
  const fetchingRef = useRef(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/arena/olive-outputs", { signal: controller.signal });
      if (!res.ok) {
        setError(res.status === 403 ? "Olive outputs are only available from this machine." : "Failed to list Olive outputs.");
        setPayload(null);
        return;
      }
      const data = (await res.json()) as OliveListResponse;
      setPayload(data);
    } catch {
      setError("Failed to list Olive outputs.");
      setPayload(null);
    } finally {
      globalThis.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Do not auto-retry after a failed list: error + null payload would re-fire
    // forever. Refresh list (or re-open after clearing) is the recovery path.
    if (open && !payload && !loading && !error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadList();
    }
  }, [open, payload, loading, error, loadList]);

  const selectEntry = useCallback(
    async (entry: OliveOutputEntry) => {
      if (onSelect) {
        onSelect(entry);
        setOpen(false);
        return;
      }
      if (!onFile) return;
      // Serialize downloads: concurrent clicks would race onFile (last response wins).
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setFetchingId(entry.id);
      setError(null);
      try {
        const res = await fetch(`/api/arena/olive-outputs/file?id=${encodeURIComponent(entry.id)}`);
        if (!res.ok) {
          setError("Could not download that model. The drop-zone is still available.");
          return;
        }
        const blob = await res.blob();
        if (blob.size <= 0) {
          setError("Downloaded model was empty. The drop-zone is still available.");
          return;
        }
        const name = entryBasename(entry.displayPath);
        const file = new File([blob], name, { type: "application/octet-stream" });
        onFile(file);
        setOpen(false);
      } catch {
        setError("Could not download that model. The drop-zone is still available.");
      } finally {
        fetchingRef.current = false;
        setFetchingId(null);
      }
    },
    [onFile, onSelect],
  );

  const recent = payload?.recent ?? [];
  const entries = payload?.entries ?? [];
  const isEmpty = payload && recent.length === 0 && entries.length === 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-900/60 cursor-pointer"
        onClick={() => {
          setOpen((v) => {
            if (v) setPayload(null);
            return !v;
          });
        }}
        aria-expanded={open}
        aria-controls={`olive-outputs-${slotLabel.replace(" ", "-").toLowerCase()}`}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FolderOpen className="h-3 w-3 text-electric-blue" />
        From Olive outputs
      </button>

      {open && (
        <div
          id={`olive-outputs-${slotLabel.replace(" ", "-").toLowerCase()}`}
          className="border-t border-slate-800 px-3 py-2 space-y-2"
        >
          {loading && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Scanning cache / output…
            </p>
          )}

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          {isEmpty && !loading && (
            <p className="text-xs text-slate-500">
              No <code className="text-slate-400">.onnx</code>/<code className="text-slate-400">.ort</code> files
              found under the Olive cache or output directories. Use the drop-zone above to pick a file manually.
            </p>
          )}

          {!loading && recent.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold">Recent</p>
              <ul className="space-y-0.5">
                {recent.map((entry) => (
                  <li key={`recent-${entry.id}`}>
                    <button
                      type="button"
                      disabled={fetchingId !== null}
                      onClick={() => void selectEntry(entry)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer disabled:opacity-50"
                    >
                      <span className="truncate font-mono">{entry.displayPath}</span>
                      <span className="shrink-0 text-slate-600">{formatBytes(entry.sizeBytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              <p className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold">Browse</p>
              <ul className="space-y-0.5">
                {entries.map((entry) => (
                  <li key={`browse-${entry.id}`}>
                    <button
                      type="button"
                      disabled={fetchingId !== null}
                      onClick={() => void selectEntry(entry)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer disabled:opacity-50"
                    >
                      <span className="truncate font-mono">
                        <span className="text-slate-600">{entry.rootLabel}/</span>
                        {entry.displayPath}
                      </span>
                      <span className="shrink-0 text-slate-600">{formatBytes(entry.sizeBytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="text-[11px] text-electric-blue hover:underline cursor-pointer disabled:opacity-50"
            disabled={loading}
            onClick={() => void loadList()}
          >
            {loading ? "Scanning…" : "Refresh list"}
          </button>
        </div>
      )}
    </div>
  );
}

export interface UseAssistantProviderProps {
  slotLabel: "Slot A" | "Slot B";
  onApply: (patch: Pick<ArenaSlotConfig, "type" | "endpointUrl" | "apiKey" | "modelId">) => void;
}

/**
 * Provides a button for filling a cloud-mode slot with the active Assistant provider settings.
 *
 * @param slotLabel - Label of the slot receiving the provider settings
 * @param onApply - Callback invoked with the provider settings to apply
 */
export function UseAssistantProviderButton({ slotLabel, onApply }: UseAssistantProviderProps) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [okLabel, setOkLabel] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setBusy(true);
    setReason(null);
    setOkLabel(null);
    try {
      const res = await fetch("/api/arena/assistant-cloud-snapshot", {
        method: "GET",
        cache: "no-store",
      });
      if (res.status === 403) {
        setReason("Arena snapshot is only available from this machine.");
        return;
      }
      if (!res.ok) {
        setReason("Failed to read Assistant provider snapshot.");
        return;
      }
      const data = (await res.json()) as AssistantCloudSnapshotResponse;
      if (!data.eligible) {
        setReason(data.reason);
        return;
      }
      onApply(toCloudSlotPatch(data));
      setOkLabel(`Filled from ${data.providerLabel}`);
    } catch {
      setReason("Failed to read Assistant provider snapshot.");
    } finally {
      setBusy(false);
    }
  }, [onApply]);

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        className="h-8 w-full text-xs border-slate-700 text-slate-300 hover:border-electric-blue/40"
        onClick={() => void handleClick()}
        disabled={busy}
        aria-label={`Use active Assistant provider for ${slotLabel}`}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3 mr-1.5 text-electric-blue" />
        )}
        Use active Assistant provider
      </Button>
      {reason && (
        <p className="text-xs text-amber-400/90" role="status">
          {reason}
        </p>
      )}
      {okLabel && !reason && (
        <p className="text-xs text-emerald-400/90" role="status">
          {okLabel}. Fields stay editable.
        </p>
      )}
    </div>
  );
}
