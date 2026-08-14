/**
 * ExportReportMenu — Dropdown menu for exporting optimization reports.
 *
 * Provides "Download Markdown" and "Print as PDF" actions.
 * Disabled when there are no completed job records.
 * Hidden when the `reportExport` feature flag is disabled.
 *
 * Requirements: 9.1, 9.4, 9.8
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadMarkdownReport, printReportAsPdf, type ReportOptions } from "@/lib/reportGenerator";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import { isFeatureEnabled } from "@/lib/featureFlags";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ExportReportMenuProps {
  /** Job history records to include in the report. */
  records: JobHistoryRecord[];
  /** Report detail level. */
  reportDetail?: "summary" | "full";
  /** Force-disable the menu (in addition to the zero-records check). */
  disabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function ExportReportMenu({
  records,
  reportDetail = "summary",
  disabled = false,
}: ExportReportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const flagEnabled = isFeatureEnabled("reportExport");

  const completedRecords = useMemo(
    () => records.filter((record) => record.status === "completed"),
    [records],
  );
  const isDisabled = disabled || completedRecords.length === 0;

  const handleDownloadMarkdown = useCallback(() => {
    const options: ReportOptions = { includeRecipeJson: reportDetail === "full", includeLogSummary: reportDetail === "full" };
    downloadMarkdownReport(completedRecords, options);
    setOpen(false);
  }, [completedRecords, reportDetail]);

  const handlePrintPdf = useCallback(() => {
    const options: ReportOptions = { includeRecipeJson: reportDetail === "full", includeLogSummary: reportDetail === "full" };
    printReportAsPdf(completedRecords, options);
    setOpen(false);
  }, [completedRecords, reportDetail]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (isDisabled && open) setOpen(false);
  }, [isDisabled, open]);

  // Hide entirely when the feature flag is disabled
  if (!flagEnabled) {
    return null;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        data-testid="export-report-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={isDisabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
          "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-slate-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          isDisabled && "pointer-events-none opacity-50 cursor-not-allowed",
        )}
      >
        <Download className="h-3.5 w-3.5" />
        Export Report
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-slate-800 bg-slate-950 p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="export-markdown"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
            onClick={handleDownloadMarkdown}
          >
            <FileText className="h-3 w-3" />
            Download Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-pdf"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
            onClick={handlePrintPdf}
          >
            <Printer className="h-3 w-3" />
            Print as PDF
          </button>
        </div>
      )}
    </div>
  );
}
