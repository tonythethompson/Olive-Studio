import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { X, ExternalLink, Copy, Check, ChevronDown, AlertTriangle, Repeat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/utils";
import { useDialogFocusTrap } from "@/lib/hooks/useDialogFocusTrap";
import { openExternal } from "@/lib/openExternal";
import type { UIState } from "@/types";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import type { ErrorFrequencyInfo } from "@/lib/errorFrequency";
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  REPORT_AREAS,
  TELEMETRY_OPTIONS,
  type ReportCategory,
  type ReportSeverity,
  type ReportArea,
  type TelemetryOptionId,
  type IssueReport,
  categoryHasSeverity,
  collectTelemetry,
  buildReport,
} from "@/lib/issueReport";

interface ReportIssueModalProps {
  open: boolean;
  onClose: () => void;
  state?: UIState;
  hardwareProbe?: HardwareProbeResult | null;
  executionLogs?: string[];
  chatLog?: string[];
  mcpDiagnostic?: unknown;
  /** Pre-fill the area dropdown (e.g., from execution context). */
  defaultArea?: ReportArea;
  /** Pre-fill the description (e.g., from error context). */
  defaultDescription?: string;
  /** Error frequency info from the tracker */
  frequencyInfo?: ErrorFrequencyInfo | null;
}

export function ReportIssueModal({
  open,
  onClose,
  state,
  hardwareProbe,
  executionLogs,
  chatLog,
  mcpDiagnostic: _mcpDiagnostic,
  defaultArea,
  defaultDescription,
  frequencyInfo,
}: ReportIssueModalProps) {
  const [category, setCategory] = useState<ReportCategory>("bug");
  const [severity, setSeverity] = useState<ReportSeverity>("annoying");
  const [area, setArea] = useState<ReportArea>(defaultArea ?? "other");
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [selectedTelemetry, setSelectedTelemetry] = useState<Set<TelemetryOptionId>>(
    new Set<TelemetryOptionId>(["platform", "hardware"]),
  );
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Reset state only when the modal transitions from closed → open.
  // Keeping defaultArea/defaultDescription out of the dep array prevents a
  // second error (fired while the modal is already open) from wiping the text
  // the user has already typed.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      setCategory("bug");
      setSeverity("annoying");
      setArea(defaultArea ?? "other");
      setDescription(defaultDescription ?? "");
      setSelectedTelemetry(new Set<TelemetryOptionId>(["platform", "hardware"]));
      setShowPreview(false);
      setCopied(false);
      setOpenError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only depend on open
  }, [open]);

  // Lock severity to N/A whenever the category isn't "bug" — severity only
  // describes bug impact and has no meaning for feature requests etc.
  // Adjust during render (not an effect) so the next paint already has the
  // matching severity.
  if (!categoryHasSeverity(category) && severity !== "n-a") {
    setSeverity("n-a");
  } else if (categoryHasSeverity(category) && severity === "n-a") {
    setSeverity("annoying");
  }

  const toggleTelemetry = useCallback((id: TelemetryOptionId) => {
    setSelectedTelemetry((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const report: IssueReport = useMemo(
    () => ({
      category,
      severity,
      area,
      description,
      telemetry: collectTelemetry(Array.from(selectedTelemetry), {
        state,
        hardwareProbe,
        executionLogs,
        chatLog,
      }),
      frequencyInfo: frequencyInfo
        ? {
          count: frequencyInfo.count,
          firstOccurrenceAgo: frequencyInfo.firstOccurrenceAgo,
          lastOccurrenceAgo: frequencyInfo.lastOccurrenceAgo,
          frequencyLabel: frequencyInfo.frequencyLabel,
        }
        : null,
    }),
    [category, severity, area, description, selectedTelemetry, state, hardwareProbe, executionLogs, chatLog, frequencyInfo],
  );

  const { url, fullText, urlExceededBudget } = useMemo(
    () => buildReport(report, { state, hardwareProbe, executionLogs, chatLog }),
    [report, state, hardwareProbe, executionLogs, chatLog],
  );

  const { dialogRef, closeButtonRef } = useDialogFocusTrap(open, onClose);

  const copyFullText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = fullText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [fullText]);

  const handleOpenGithub = useCallback(async () => {
    setOpenError(null);
    try {
      if (urlExceededBudget) {
        // Full prefilled URL was too long: start opening URL before clipboard copy to preserve user activation
        const openPromise = openExternal(url);
        const copyPromise = copyFullText();
        await Promise.all([openPromise, copyPromise]);
      } else {
        await openExternal(url);
      }
      onClose();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Could not open browser");
    }
  }, [url, urlExceededBudget, copyFullText, onClose]);

  const handleCopy = useCallback(() => {
    void copyFullText();
  }, [copyFullText]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-title"
      tabIndex={-1}
      onClick={handleBackdropClick}
    >
      <Card className="w-full max-w-lg border-slate-800 bg-slate-900 shadow-2xl max-h-[90vh] flex flex-col">
        <CardHeader
          titleId="report-issue-title"
          title="Send feedback"
          description="Bugs, ideas, or anything else about Olive Studio."
          badge={
            <Button
              ref={closeButtonRef}
              variant="ghost"
              className="h-8 w-8 p-0 hover:bg-slate-800"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
        <CardContent className="flex-1 overflow-y-auto space-y-5">
          {/* Category dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="report-category" className="text-sm font-semibold text-slate-300">
              Category
            </Label>
            <div className="relative">
              <select
                id="report-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-electric-blue cursor-pointer"
              >
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Severity dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="report-severity" className="text-sm font-semibold text-slate-300">
              Severity
            </Label>
            <div className="relative">
              <select
                id="report-severity"
                value={severity}
                disabled={!categoryHasSeverity(category)}
                onChange={(e) => setSeverity(e.target.value as ReportSeverity)}
                className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-electric-blue cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {REPORT_SEVERITIES.filter((s) =>
                  categoryHasSeverity(category) ? s.id !== "n-a" : s.id === "n-a",
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Area dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="report-area" className="text-sm font-semibold text-slate-300">
              Area
            </Label>
            <div className="relative">
              <select
                id="report-area"
                value={area}
                onChange={(e) => setArea(e.target.value as ReportArea)}
                className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-electric-blue cursor-pointer"
              >
                {REPORT_AREAS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Description textarea */}
          <div className="space-y-1.5">
            <Label htmlFor="report-description" className="text-sm font-semibold text-slate-300">
              Description <span className="text-rose-400">*</span>
            </Label>
            <textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? What did you expect to happen? Steps to reproduce..."
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-electric-blue resize-none"
            />
          </div>

          {/* Telemetry checkboxes */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-300">
              Include Telemetry <span className="text-slate-500 font-normal">(optional, helps debug)</span>
            </Label>
            <div className="space-y-2">
              {TELEMETRY_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={cn(
                    "flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors",
                    selectedTelemetry.has(opt.id)
                      ? "border-electric-blue/40 bg-electric-blue/5"
                      : "border-slate-800 bg-slate-950 hover:border-slate-700",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedTelemetry.has(opt.id)}
                    onChange={() => toggleTelemetry(opt.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue focus:ring-offset-0 cursor-pointer"
                  />
                  <div className="min-w-0">
                    <span className="text-sm text-slate-200 font-medium">{opt.label}</span>
                    <p className="text-xs text-slate-500 leading-relaxed">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Preview toggle */}
          {selectedTelemetry.size > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1.5 text-sm text-electric-blue hover:text-electric-blue/80 transition-colors cursor-pointer"
              >
                <AlertTriangle className="h-3 w-3" />
                {showPreview ? "Hide" : "Preview"} telemetry data
              </button>
              {showPreview && (
                <div className="bg-slate-950 border border-slate-800 rounded-md p-3 text-sm font-mono text-slate-400 max-h-40 overflow-y-auto">
                  {Array.from(selectedTelemetry).map((key) => {
                    const telemetry = collectTelemetry([key], { state, hardwareProbe, executionLogs, chatLog });
                    const value = telemetry[key] ?? "N/A";
                    const label = TELEMETRY_OPTIONS.find((o) => o.id === key)?.label ?? key;
                    return (
                      <div key={key} className="mb-2 last:mb-0">
                        <span className="text-slate-500">[{label}]</span>{" "}
                        <span className="text-slate-300">{value}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Frequency info */}
          {frequencyInfo && frequencyInfo.count > 1 && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
              <Repeat className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  This error has occurred {frequencyInfo.count} times
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {frequencyInfo.frequencyLabel}
                </p>
              </div>
            </div>
          )}

          {/* Privacy notice */}
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Sensitive data (tokens, API keys, file paths) is automatically redacted before inclusion.
            Telemetry is only sent if you choose to include it.
          </p>
        </CardContent>

        {/* Footer with actions */}
        <div className="p-4 border-t border-slate-800 space-y-2">
          {urlExceededBudget && (
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              Report is too large for a prefilled GitHub URL. Opening GitHub will copy the full report
              to your clipboard so you can paste it into the issue body.
            </p>
          )}
          {openError && (
            <p className="text-xs text-red-400 mt-1" role="alert">
              {openError}. You can copy the report and open GitHub manually.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={onClose} className="text-sm h-9">
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleCopy}
                disabled={!description.trim()}
                className="text-sm h-9 border-slate-700 text-slate-300 hover:border-slate-500"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Report
                  </>
                )}
              </Button>
              <Button
                onClick={handleOpenGithub}
                disabled={!description.trim()}
                className="text-sm h-9 bg-electric-blue hover:bg-electric-blue/90 text-slate-950"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open GitHub Issue
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
