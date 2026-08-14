import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { openExternal } from "@/lib/openExternal";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import { Button } from "@/components/ui/Button";

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Displays an introductory dialog for Olive Studio and handles its dismissal.
 *
 * @param open - Whether the dialog is visible
 * @param onClose - Callback invoked when the dialog is dismissed
 */
export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dismissWelcome = usePreferencesStore((s) => s.dismissWelcome);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reset the checkbox whenever the modal is (re)opened so a reused instance
  // never shows a stale value.
  useEffect(() => {
    if (open) setDontShowAgain(false);
  }, [open]);

  // Only explicit confirmations (Get started / X) persist "Don't show again";
  // backdrop clicks and Escape dismiss without persisting.
  const handleClose = (persistDismissal: boolean) => {
    if (persistDismissal && dontShowAgain) dismissWelcome();
    onClose();
  };
  // The keyboard effect must not re-run when the checkbox toggles (that would
  // steal focus via the cleanup's focus restore), so it goes through a ref.
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  });

  // Focus management: move focus in on open, trap Tab, Escape to close,
  // restore focus on close — same pattern as ReportIssueModal.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Defer so the dialog exists in the DOM after open transitions
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
      if (document.activeElement !== closeButtonRef.current) {
        dialogRef.current?.focus();
      }
    }, 0);

    const getFocusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseRef.current(false);
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
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
      tabIndex={-1}
      onClick={() => handleClose(false)}
    >
      <div
        className="w-full max-w-lg rounded border border-slate-800 bg-slate-900 p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 id="welcome-modal-title" className="text-base font-semibold text-slate-100">
            Welcome to Olive Studio
          </h1>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={() => handleClose(true)}
            className="text-slate-500 hover:text-slate-300 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 text-sm text-slate-400 leading-relaxed">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">What is Microsoft Olive?</h2>
            <p>
              Olive is Microsoft&apos;s open-source toolkit for optimizing machine learning models.
              It converts models to ONNX and applies optimizations like quantization, pruning, and
              graph tuning so they run faster and smaller on your hardware — CPU, GPU, or NPU.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">What you can do here</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pick a model source and target your hardware (CPU, GPU, NPU).</li>
              <li>Build an optimization recipe step by step and validate it before running.</li>
              <li>Export the recipe as JSON or run Olive locally on your machine.</li>
              <li>Try the optimized model in the Playground.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">The Assistant</h2>
            <p>
              The built-in Assistant (open it from the sidebar) can answer questions about Olive,
              explain optimization passes, and help you build and validate recipes as you go.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Source code and issues:{" "}
            <button
              type="button"
              onClick={() => void openExternal(REPO_URL)}
              className="text-electric-blue hover:underline cursor-pointer bg-transparent border-none p-0 inline text-xs"
            >
              GitHub
            </button>
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 accent-electric-blue cursor-pointer"
            />
            Don&apos;t show again
          </label>
          <Button onClick={() => handleClose(true)}>Get started</Button>
        </div>
      </div>
    </div>
  );
}
