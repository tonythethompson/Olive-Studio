/**
 * Polymorphic action button that renders differently based on `Action.kind`.
 *
 * - `applyPatch`: Applies a ChatActionPatch through commitUiStateUpdate, detects
 *   coercion, and triggers a debounced post-patch review refresh.
 * - `navigate`: Scrolls/focuses the target panel into view.
 * - `explain`: Injects the explanation body into chat.
 * - `documentation`: Opens a KB article or external URL.
 *
 * @see Requirements 2.6, 2.7, 2.8
 * @module ActionButton
 */

import { useState, useCallback, useEffect } from "react";
import { Wrench, Navigation, BookOpen, ExternalLink, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePipelineStore, usePipelineState } from "@/lib/stores/pipelineStore";
import { chatPatchToUiState, sanitizeChatActionPatch } from "@/lib/chatActions";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";
import { executeNavigateAction } from "@/lib/actionExecutor";
import type { Action } from "@/lib/types/findingTypes";
import type { UIState } from "@/types";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ActionButtonProps {
  /** The action to execute. */
  action: Action;
  /**
   * Callback invoked after a successful applyPatch commit.
   * Typically wired to `usePipelineReview().schedulePostPatchRefresh`.
   */
  onPatchApplied?: () => void;
  /** Callback to inject an explanation body into the chat panel. */
  onExplain?: (body: string) => void;
  /** Optional additional className. */
  className?: string;
  /** Controlled pipeline snapshot used when applying patches. */
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
}

// ─── Coercion Notice ─────────────────────────────────────────────────────────

interface CoercionNotice {
  fields: string[];
}

// ─── Value Equality ──────────────────────────────────────────────────────────

/**
 * Deep value equality for detecting coercion differences.
 * Uses reference equality for primitives, JSON comparison for objects/arrays.
 * This avoids false-positive coercion notices when chatPatchToUiState produces
 * equivalent but non-identical (by reference) object values.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ─── Style Map ───────────────────────────────────────────────────────────────

const KIND_STYLES: Record<Action["kind"], string> = {
  applyPatch:
    "border-electric-blue/40 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20",
  navigate:
    "border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60",
  explain:
    "border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20",
  documentation:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
};

const KIND_ICONS: Record<Action["kind"], typeof Wrench> = {
  applyPatch: Wrench,
  navigate: Navigation,
  explain: BookOpen,
  documentation: ExternalLink,
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders an action button with kind-specific styling, icon, and behavior.
 *
 * Requirements:
 * - 2.6: applyPatch schedules re-run via onPatchApplied (300–1000ms debounce
 *   is handled by usePipelineReview.schedulePostPatchRefresh).
 * - 2.7: Displays coercion notice when committed state differs from patch.
 * - 2.8: navigate/explain/documentation execute without modifying the store.
 */
export function ActionButton({
  action,
  onPatchApplied,
  onExplain,
  className,
  state: stateProp,
  setState: setStateProp,
}: ActionButtonProps) {
  const [coercion, setCoercion] = useState<CoercionNotice | null>(null);
  useEffect(() => {
    setCoercion(null);
  }, [action.kind, action.label, action.payload]);
  const store = usePipelineState();
  const state = stateProp ?? store.state;
  const setState = setStateProp ?? store.setState;

  const Icon = KIND_ICONS[action.kind] ?? Wrench;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleApplyPatch = useCallback(() => {
    if (action.kind !== "applyPatch") return;

    const patch = sanitizeChatActionPatch(action.payload);
    if (!patch) return;
    const partial = chatPatchToUiState(state, patch);

    // Apply the patch through the store (runs commitUiStateUpdate internally).
    setState(partial);

    // Read committed state to detect coercion (Req 2.7).
    // The store's setState uses commitUiStateUpdate which may auto-coerce values.
    const committed = commitUiStateUpdate(state, partial);
    const coercedFields: string[] = [];

    for (const key of Object.keys(partial) as (keyof typeof partial)[]) {
      if (key === "passes" && partial.passes) {
        for (const passKey of Object.keys(partial.passes)) {
          const requested = (partial.passes as Record<string, unknown>)[passKey];
          const actual = (committed.passes as Record<string, unknown>)[passKey];
          // Use value equality for objects/arrays, reference equality for primitives.
          if (!valuesEqual(requested, actual)) {
            coercedFields.push(`passes.${passKey}`);
          }
        }
      } else {
        const requested = partial[key];
        const actual = committed[key as keyof typeof committed];
        if (!valuesEqual(requested, actual)) {
          coercedFields.push(key);
        }
      }
    }

    if (coercedFields.length > 0) {
      setCoercion({ fields: coercedFields });
    } else {
      setCoercion(null);
    }

    // Trigger debounced re-run (Req 2.6).
    onPatchApplied?.();
  }, [action, state, setState, setStateProp, onPatchApplied]);

  const handleNavigate = useCallback(() => {
    if (action.kind !== "navigate") return;
    executeNavigateAction(action);
  }, [action]);

  const handleExplain = useCallback(() => {
    if (action.kind !== "explain") return;
    onExplain?.(action.payload.body);
  }, [action, onExplain]);

  const handleDocumentation = useCallback(() => {
    if (action.kind !== "documentation") return;
    const { url, topicKey } = action.payload;
    if (topicKey && !url) {
      window.dispatchEvent(
        new CustomEvent("olive-studio:documentation", { detail: { topicKey } }),
      );
      return;
    }
    if (url) {
      // Only allow http: and https: URLs to prevent javascript:/data: injection.
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      } catch {
        // Invalid URL — reject
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [action]);

  const handleClick = useCallback(() => {
    switch (action.kind) {
      case "applyPatch":
        handleApplyPatch();
        break;
      case "navigate":
        handleNavigate();
        break;
      case "explain":
        handleExplain();
        break;
      case "documentation":
        handleDocumentation();
        break;
    }
  }, [action.kind, handleApplyPatch, handleNavigate, handleExplain, handleDocumentation]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950",
          KIND_STYLES[action.kind],
          className,
        )}
        title={action.label}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate max-w-[200px]">{action.label}</span>
      </button>

      {/* Coercion notice (Req 2.7) */}
      {coercion && (
        <div
          className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300"
          role="alert"
        >
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Auto-corrected: {coercion.fields.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
