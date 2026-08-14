import { useEffect, useRef } from "react";

/**
 * Moves focus into a dialog on open, traps Tab navigation within it, closes on
 * Escape, and restores focus to the previously focused element on close.
 *
 * Shared by ReportIssueModal and OwrExportOverlay (and any future overlay).
 *
 * @param open - Whether the dialog is currently open
 * @param onClose - Called when Escape is pressed while the dialog is open
 * @returns Refs to attach to the dialog container and its close button
 */
export function useDialogFocusTrap(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

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

  return { dialogRef, closeButtonRef };
}
