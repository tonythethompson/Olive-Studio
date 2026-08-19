import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  AlertTriangle,
  Repeat,
  ImageIcon,
  UploadCloud,
  Trash2,
} from "lucide-react";
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  /** Pre-fill the title input (e.g., from error context). */
  defaultTitle?: string;
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
  defaultTitle,
  defaultDescription,
  frequencyInfo,
}: ReportIssueModalProps) {
  const [category, setCategory] = useState<ReportCategory>("bug");
  const [severity, setSeverity] = useState<ReportSeverity>("annoying");
  const [area, setArea] = useState<ReportArea>(defaultArea ?? "other");
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTelemetry, setSelectedTelemetry] = useState<Set<TelemetryOptionId>>(
    new Set<TelemetryOptionId>(["platform", "hardware"]),
  );
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [screenshotCopied, setScreenshotCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URL when screenshot changes or unmounts
  useEffect(() => {
    return () => {
      if (screenshotPreview) {
        URL.revokeObjectURL(screenshotPreview);
      }
    };
  }, [screenshotPreview]);

  const handleSetScreenshot = useCallback((file: File | null) => {
    setScreenshotPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setScreenshotFile(file);
  }, []);

  // Reset state only when the modal transitions from closed → open.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      setCategory("bug");
      setSeverity("annoying");
      setArea(defaultArea ?? "other");
      setTitle(defaultTitle ?? "");
      setDescription(defaultDescription ?? "");
      handleSetScreenshot(null);
      setSelectedTelemetry(new Set<TelemetryOptionId>(["platform", "hardware"]));
      setShowPreview(false);
      setCopied(false);
      setScreenshotCopied(false);
      setOpenError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only depend on open
  }, [open]);

  // Lock severity to N/A whenever the category isn't "bug"
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
      title: title.trim() || undefined,
      description,
      screenshotName: screenshotFile?.name ?? null,
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
    [
      category,
      severity,
      area,
      title,
      description,
      screenshotFile,
      selectedTelemetry,
      state,
      hardwareProbe,
      executionLogs,
      chatLog,
      frequencyInfo,
    ],
  );

  const { url, fullText, urlExceededBudget, chatLogOffloaded, logsOffloaded, offloadedClipboardText } = useMemo(
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

  const handleCopyScreenshot = useCallback(async () => {
    if (!screenshotFile) return;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ [screenshotFile.type]: screenshotFile }),
        ]);
        setScreenshotCopied(true);
        setTimeout(() => setScreenshotCopied(false), 2000);
      }
    } catch {
      // Fallback
    }
  }, [screenshotFile]);

  const handleOpenGithub = useCallback(async () => {
    setOpenError(null);
    try {
      // If chat log, execution logs, or other text was offloaded to clipboard, copy it to clipboard first
      if (offloadedClipboardText) {
        try {
          await navigator.clipboard.writeText(offloadedClipboardText);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = offloadedClipboardText;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
      } else if (urlExceededBudget) {
        await copyFullText();
      } else if (screenshotFile && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        // Attempt to copy screenshot image to clipboard so user can immediately Ctrl+V into GitHub
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [screenshotFile.type]: screenshotFile }),
          ]);
        } catch {
          /* ignore */
        }
      }

      await openExternal(url);
      onClose();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Could not open browser");
    }
  }, [url, offloadedClipboardText, urlExceededBudget, copyFullText, screenshotFile, onClose]);

  const handleCopy = useCallback(() => {
    void copyFullText();
  }, [copyFullText]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        handleSetScreenshot(file);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        handleSetScreenshot(file);
      }
    }
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleSetScreenshot(file);
            break;
          }
        }
      }
    },
    [handleSetScreenshot],
  );

  const isSubmitDisabled = !title.trim() && !description.trim();

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
      onPaste={handlePaste}
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
        <CardContent className="flex-1 overflow-y-auto space-y-4">
          {/* Category & Area grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {/* Title input */}
          <div className="space-y-1.5">
            <Label htmlFor="report-title-input" className="text-sm font-semibold text-slate-300">
              Title <span className="text-rose-400">*</span>
            </Label>
            <input
              id="report-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the issue or feature request..."
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-electric-blue"
            />
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

          {/* Screenshot upload area */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-300 flex items-center justify-between">
              <span>Screenshot</span>
              <span className="text-xs text-slate-500 font-normal">Optional</span>
            </Label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {screenshotFile && screenshotPreview ? (
              <div className="flex items-center gap-3 p-2.5 rounded-md border border-slate-800 bg-slate-950">
                <img
                  src={screenshotPreview}
                  alt="Screenshot preview"
                  className="h-12 w-16 object-cover rounded border border-slate-700 bg-slate-900 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200 truncate">{screenshotFile.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(screenshotFile.size)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleCopyScreenshot}
                    title="Copy image to clipboard"
                    className="h-8 px-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                  >
                    {screenshotCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400 mr-1" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSetScreenshot(null)}
                    title="Remove screenshot"
                    className="h-8 w-8 p-0 text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "border border-dashed rounded-md p-3 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-1",
                  isDragging
                    ? "border-electric-blue bg-electric-blue/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950",
                )}
              >
                <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium">
                  {isDragging ? (
                    <UploadCloud className="h-4 w-4 text-electric-blue animate-bounce" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-slate-500" />
                  )}
                  <span>Click to attach screenshot, drag & drop, or paste (Ctrl+V)</span>
                </div>
                <p className="text-[10px] text-slate-600">PNG, JPG, WebP up to 10MB</p>
              </div>
            )}
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
          {chatLogOffloaded && !logsOffloaded && !urlExceededBudget && (
            <p className="text-[11px] text-electric-blue/90 leading-relaxed">
              <span className="font-semibold">Note:</span> The assistant chat log will be copied to your clipboard when opening GitHub so you can paste (Ctrl+V) it into the issue.
            </p>
          )}
          {logsOffloaded && !chatLogOffloaded && !urlExceededBudget && (
            <p className="text-[11px] text-electric-blue/90 leading-relaxed">
              <span className="font-semibold">Note:</span> Execution logs will be copied to your clipboard when opening GitHub so you can paste (Ctrl+V) them into the issue.
            </p>
          )}
          {chatLogOffloaded && logsOffloaded && !urlExceededBudget && (
            <p className="text-[11px] text-electric-blue/90 leading-relaxed">
              <span className="font-semibold">Note:</span> Execution and chat logs will be copied to your clipboard when opening GitHub so you can paste (Ctrl+V) them into the issue.
            </p>
          )}
          {urlExceededBudget && (
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              Report is too large for a prefilled GitHub URL. Opening GitHub will copy the full report
              to your clipboard so you can paste it into the issue body.
            </p>
          )}
          {screenshotFile && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="font-semibold text-slate-300">Screenshot attached:</span> Drag & drop or paste your image into GitHub&apos;s issue editor.
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
                disabled={isSubmitDisabled}
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
                disabled={isSubmitDisabled}
                className="text-sm h-9 bg-electric-blue hover:bg-electric-blue/90 text-slate-950 font-medium"
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
