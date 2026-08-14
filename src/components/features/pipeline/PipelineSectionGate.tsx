import { useEffect, useId, useRef, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigatePipeline } from "@/lib/pipelineNavigation";

interface PipelineSectionGateProps {
  locked: boolean;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PipelineSectionGate({ locked, children, className }: PipelineSectionGateProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!locked) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = () =>
      Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === overlay,
      );

    const initial = getFocusable()[0] ?? overlay;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        overlay.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener("keydown", onKeyDown);
    return () => {
      overlay.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [locked]);

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn("transition-opacity", locked && "opacity-40")}
        aria-hidden={locked}
        {...(locked ? { inert: true } : {})}
      >
        {children}
      </div>
      {locked && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 flex items-start justify-center bg-slate-950/70 p-4 pt-24 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 text-center shadow-xl">
            <Lock className="mx-auto mb-3 h-8 w-8 text-slate-400" aria-hidden="true" />
            <h3 id={titleId} className="text-sm font-semibold text-slate-200">
              Locked until you choose a model
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-slate-500">
              Select a model in Model source to configure hardware and run a recipe.
            </p>
            <button
              type="button"
              onClick={() => navigatePipeline("input")}
              className="mt-4 inline-flex items-center justify-center rounded-md bg-electric-blue px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-electric-blue/90 transition-colors cursor-pointer"
            >
              Select a model
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
