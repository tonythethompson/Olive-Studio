import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { X, ExternalLink, Copy, Check, ChevronDown, AlertTriangle, Repeat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/utils";
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

const DRAFT_STORAGE_KEY = "olive-studio:report-issue-draft";

interface ReportIssueDraft {
  category: ReportCategory;
  severity: ReportSeverity;
  area: ReportArea;
  description: string;
  telemetry: TelemetryOptionId[];
}

function loadDraft(): ReportIssueDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportIssueDraft>;
    if (typeof parsed.description !== "string" || !parsed.description.trim()) return null;
    return {
      category: REPORT_CATEGORIES.some((c) => c.id === parsed.category) ? (parsed.category as ReportCategory) : "bug",
      severity: REPORT_SEVERITIES.some((s) => s.id === parsed.severity) ? (parsed.severity as ReportSeverity) : "annoying",
      area: REPORT_AREAS.some((a) => a.id === parsed.area) ? (parsed.area as ReportArea) : "other",
      description: parsed.description,
      telemetry: Array.isArray(parsed.telemetry)
        ? parsed.telemetry.filter((t): t is TelemetryOptionId => TELEMETRY_OPTIONS.some((o) => o.id === t))
        : ["platform", "hardware"],
    };
  } catch {
    return null;
  }
}

function saveDraft(draft: ReportIssueDraft): void {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private browsing, quota) — draft persistence is best-effort.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Best-effort; nothing to clean up if storage was never written.
  }
}

interface ReportIssueModalProps {
  open: boolean;
  onClose: () => void;
  state?: UIState;
  hardwareProbe?: HardwareProbeResult | null;
  executionLogs?: string[];
  /** Recent assistant chat transcript, formatted as one "sender: text" line per turn. */
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
  const [submitted, setSubmitted] = useState(false);

  // Reset state only when the modal transitions from closed → open.
  // Keeping defaultArea/defaultDescription out of the dep array prevents a
  // second error (fired while the modal is already open) from wiping the text
  // the user has already typed.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      // An error-triggered open (defaultDescription set) always wins over a saved
      // draft — that context is more relevant than whatever was typed earlier.
      const draft = defaultDescription ? null : loadDraft();
      setCategory(draft?.category ?? "bug");
      setSeverity(draft?.severity ?? "annoying");
      setArea(draft?.area ?? defaultArea ?? "other");
      setDescription(draft?.description ?? defaultDescription ?? "");
      setSelectedTelemetry(new Set<TelemetryOptionId>(draft?.telemetry ?? ["platform", "hardware"]));
      setShowPreview(false);
      setCopied(false);
      setSubmitted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only depend on open
  }, [open]);

  // Persist in-progress reports so they survive an accidental window close.
  useEffect(() => {
    if (!open || submitted) return;
    if (!description.trim()) {
      clearDraft();
      return;
    }
    saveDraft({ category, severity, area, description, telemetry: Array.from(selectedTelemetry) });
  }, [open, submitted, category, severity, area, description, selectedTelemetry]);

  const severityApplies = categoryHasSeverity(category);
  // Severity only means something for bug reports; report N/A for the rest
  // without touching the underlying state, so a feature request can't
  // accidentally ship as "Crash" or "Blocking", and switching back to Bug
  // report restores whatever severity the user last picked.
  const effectiveSeverity: ReportSeverity = severityApplies ? severity : "n-a";

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
      severity: effectiveSeverity,
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
    [category, effectiveSeverity, area, description, selectedTelemetry, state, hardwareProbe, executionLogs, chatLog, frequencyInfo],
  );

  const { url, fullText, urlExceededBudget } = useMemo(
    () => buildReport(report, { state, hardwareProbe, executionLogs, chatLog }),
    [report, state, hardwareProbe, executionLogs, chatLog],
  );

  const telemetryOptions = useMemo(
    () => (chatLog?.length ? TELEMETRY_OPTIONS : TELEMETRY_OPTIONS.filter((o) => o.id !== "chat-logs")),
    [chatLog],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: move focus in on open, trap Tab, Escape to close, restore on close.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusInitial = () => {
      closeButtonRef.current?.focus();
      if (document.activeElement !== closeButtonRef.current) {
        dialogRef.current?.focus();
      }
    };
    // Defer so the dialog exists in the DOM after open transitions
    const focusTimer = window.setTimeout(focusInitial, 0);

    const getFocusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

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

  const handleOpenGithub = useCallback(() => {
    if (urlExceededBudget) {
      // Full prefilled URL was too long: keep complete report on clipboard, open blank form
      void copyFullText().then(() => {
        void openExternal(url);
      });
    } else {
      void openExternal(url);
    }
    clearDraft();
    setSubmitted(true);
  }, [url, urlExceededBudget, copyFullText]);

  // Show a brief confirmation, then close and let the next open start blank.
  useEffect(() => {
    if (!submitted) return;
    const timer = window.setTimeout(onClose, 1800);
    return () => window.clearTimeout(timer);
  }, [submitted, onClose]);

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
          title="Report an Issue"
          description="Help us improve Olive Studio by reporting bugs or suggesting features."
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
        {submitted ? (
          <CardContent className="flex-1 flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-slate-200">GitHub issue opened</p>
            <p className="text-xs text-slate-500">This form will close in a moment.</p>
          </CardContent>
        ) : (
        <>
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
              {!severityApplies && (
                <span className="text-slate-500 font-normal"> (bug reports only)</span>
              )}
            </Label>
            <div className="relative">
              <select
                id="report-severity"
                value={effectiveSeverity}
                onChange={(e) => setSeverity(e.target.value as ReportSeverity)}
                disabled={!severityApplies}
                className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-electric-blue cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {REPORT_SEVERITIES.filter((s) => severityApplies || s.id === "n-a").map((s) => (
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
              {telemetryOptions.map((opt) => (
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
        </>
        )}
      </Card>
    </div>
  );
}
