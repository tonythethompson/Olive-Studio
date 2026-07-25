import React, { useEffect, useState } from "react";
import {
  JobHistoryRecord,
  getJobHistory,
  deleteJobHistoryRecord,
  clearAllJobHistory,
} from "@/lib/jobHistoryStore";
import {
  History,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Cpu,
  Clock,
  HardDrive,
  RefreshCw,
} from "lucide-react";

interface JobHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRecipe?: (recipeJson: string) => void;
}

export function JobHistoryModal({ isOpen, onClose, onSelectRecipe }: JobHistoryModalProps) {
  const [history, setHistory] = useState<JobHistoryRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let isSubscribed = true;
    getJobHistory().then((records) => {
      if (isSubscribed) {
        setHistory(records);
        setIsLoading(false);
      }
    });
    return () => {
      isSubscribed = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const refreshHistory = async () => {
    const records = await getJobHistory();
    setHistory(records);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteJobHistoryRecord(id);
    setSelectedIds((prev) => prev.filter((item) => item !== id));
    await refreshHistory();
  };

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to clear all execution history?")) {
      await clearAllJobHistory();
      setSelectedIds([]);
      await refreshHistory();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : prev.length < 3 ? [...prev, id] : prev,
    );
  };

  const filteredHistory = history.filter((rec) => {
    if (filterStatus === "all") return true;
    return rec.status === filterStatus;
  });

  const selectedRecords = history.filter((rec) => selectedIds.includes(rec.id));

  const formatDuration = (ms: number) => {
    if (!ms || ms <= 0) return "< 1s";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-electric-blue/10 border border-electric-blue/20 text-electric-blue">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Run History & Side-by-Side Comparison
              </h2>
              <p className="text-xs text-slate-400">
                Persisted in local IndexedDB. Select up to 3 runs to compare side-by-side.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Comparison View if items selected */}
          {selectedRecords.length > 0 && (
            <div className="bg-slate-950/60 border border-electric-blue/30 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="text-sm font-semibold text-electric-blue flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Comparing {selectedRecords.length} Run{selectedRecords.length > 1 ? "s" : ""}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Clear Comparison
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {selectedRecords.map((rec) => (
                  <div key={rec.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-400">
                        {new Date(rec.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                          rec.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : rec.status === "cancelled"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {rec.status === "completed" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : rec.status === "cancelled" ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {rec.status}
                      </span>
                    </div>

                    <div className="font-semibold text-slate-100 text-sm truncate" title={rec.modelId}>
                      {rec.modelId}
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Cpu className="h-3.5 w-3.5" /> Provider
                        </span>
                        <span className="font-mono text-slate-200">{rec.ihvProvider}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" /> Duration
                        </span>
                        <span className="font-mono text-slate-200">{formatDuration(rec.durationMs)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500 flex items-center gap-1">
                          <HardDrive className="h-3.5 w-3.5" /> VRAM Est.
                        </span>
                        <span className="font-mono text-slate-200">
                          {rec.vramEstimateGb ? `~${rec.vramEstimateGb.toFixed(1)} GB` : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Pass Count</span>
                        <span className="font-mono text-slate-200">{rec.passCount}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-500 font-medium">Passes Configured:</span>
                      <div className="flex flex-wrap gap-1">
                        {rec.passNames.map((p, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>

                    {onSelectRecipe && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectRecipe(rec.recipeJson);
                          onClose();
                        }}
                        className="w-full mt-2 py-1.5 bg-electric-blue/10 hover:bg-electric-blue/20 text-electric-blue text-xs rounded font-medium transition-colors"
                      >
                        Load Recipe in Editor
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Filter:</span>
              {(["all", "completed", "failed", "cancelled"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilterStatus(st)}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                    filterStatus === st
                      ? "bg-electric-blue text-white"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear History
              </button>
            )}
          </div>

          {/* History Records Table/List */}
          {isLoading ? (
            <div className="py-12 flex items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-electric-blue" />
              <span>Loading run history...</span>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl">
              No historical execution runs recorded yet. Run a recipe to populate history.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((rec) => {
                const isSelected = selectedIds.includes(rec.id);
                return (
                  <div
                    key={rec.id}
                    onClick={() => toggleSelect(rec.id)}
                    className={`p-3.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                      isSelected
                        ? "bg-electric-blue/10 border-electric-blue/40 shadow-sm"
                        : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(rec.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200 text-sm truncate">{rec.modelId}</span>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                              rec.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : rec.status === "cancelled"
                                  ? "bg-amber-500/10 text-amber-400"
                                  : "bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {rec.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-3 mt-1 font-mono">
                          <span>{new Date(rec.timestamp).toLocaleString()}</span>
                          <span>•</span>
                          <span>{rec.ihvProvider}</span>
                          <span>•</span>
                          <span>{rec.passCount} pass(es)</span>
                          <span>•</span>
                          <span>{formatDuration(rec.durationMs)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {onSelectRecipe && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRecipe(rec.recipeJson);
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded font-medium transition-colors"
                        >
                          Load
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(rec.id, e)}
                        className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete run record"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing {filteredHistory.length} of {history.length} runs. Select up to 3 runs to compare.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
