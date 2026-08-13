/**
 * AgentConfirmDialog — Confirmation dialog when switching away from active agent.
 *
 * Displayed when the user attempts to leave Agent_Mode while the agent loop
 * is running. "Confirm" cancels the agent and switches to Manual_Mode;
 * "Cancel" dismisses the dialog and keeps the agent running.
 *
 * The parent component manages open/close state and wires onConfirm/onCancel
 * to useAgentMode.stopAgent() + setMode().
 *
 * Requirements: 6.5
 */

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AgentConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the user confirms — cancels agent + switches mode. */
  onConfirm: () => void;
  /** Called when the user cancels — dismisses dialog, agent stays running. */
  onCancel: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function AgentConfirmDialog({ open, onConfirm, onCancel }: AgentConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button when the dialog opens (basic focus trap)
  useEffect(() => {
    if (open) {
      // Use requestAnimationFrame to ensure the DOM is ready
      requestAnimationFrame(() => {
        cancelButtonRef.current?.focus();
      });
    }
  }, [open]);

  // Handle Escape key to dismiss
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      data-testid="agent-confirm-dialog"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        "bg-slate-950/70",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-confirm-title"
      aria-describedby="agent-confirm-description"
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-lg border border-slate-700",
          "bg-slate-900 p-6 shadow-2xl",
        )}
      >
        {/* Title */}
        <h2
          id="agent-confirm-title"
          className="text-lg font-semibold text-slate-100"
        >
          Stop Agent?
        </h2>

        {/* Description */}
        <p
          id="agent-confirm-description"
          className="mt-2 text-sm text-slate-400"
        >
          The agent is currently running. Switching to Manual mode will cancel the
          active agent loop and discard any in-progress operations. This action
          cannot be undone.
        </p>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
