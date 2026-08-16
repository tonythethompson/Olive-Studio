/**
 * QnnAbiCoercionNotice — Transient inline notification displayed when selecting
 * QnnAbiExecutionProvider coerces incompatible passes off.
 *
 * Appears within ≤200ms of coercion and auto-dismisses after a short delay.
 * Lists which passes were disabled and explains that QairtPipeline replaces
 * them with a single-pass workflow.
 *
 * @see Requirement 9.7
 */
import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QnnAbiCoercionNoticeProps {
  /** List of pass names that were coerced off by QNN ABI selection. */
  coercedPasses: string[];
  /** Called when the notification is dismissed (manually or after timeout). */
  onDismiss: () => void;
  /** Optional className for positioning. */
  className?: string;
}

/** Human-readable names for coerced pass keys. */
const PASS_DISPLAY_NAMES: Record<string, string> = {
  conversion: "OnnxConversion",
  quantization: "Quantization",
  onnxDiscrepancyCheck: "OnnxDiscrepancyCheck",
};

/**
 * Formats a list of pass names into a sentence fragment.
 * E.g. ["OnnxConversion", "Quantization", "OnnxDiscrepancyCheck"] →
 *      "OnnxConversion, Quantization, and OnnxDiscrepancyCheck"
 */
function formatPassList(passes: string[]): string {
  const names = passes.map((p) => PASS_DISPLAY_NAMES[p] ?? p);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Auto-dismiss duration in ms. */
const AUTO_DISMISS_MS = 5000;

export function QnnAbiCoercionNotice({
  coercedPasses,
  onDismiss,
  className,
}: QnnAbiCoercionNoticeProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible || coercedPasses.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/8 px-3.5 py-2.5",
        "animate-in fade-in slide-in-from-top-1 duration-200",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Info className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-sky-300 leading-relaxed">
          <span className="font-semibold">{formatPassList(coercedPasses)}</span>
          {coercedPasses.length === 1 ? " was" : " were"} disabled.
        </p>
        <p className="text-[11px] text-sky-400/70 leading-relaxed mt-0.5">
          QairtPipeline replaces these with a single-pass compilation workflow.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        className="shrink-0 p-0.5 rounded text-sky-400/60 hover:text-sky-300 transition-colors cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
