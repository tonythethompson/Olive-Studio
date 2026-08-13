/**
 * Action execution logic for Finding actions.
 *
 * Provides pure, testable handlers for each action kind. ActionButton (task 3.2)
 * delegates to these functions. The key invariant: non-patch actions (navigate,
 * explain, documentation) NEVER modify PipelineStore state.
 *
 * @module actionExecutor
 */

import type {
  Action,
  ActionPayloadNavigate,
  ActionPayloadExplain,
  ActionPayloadDocumentation,
  ActionPayloadApplyPatch,
} from "@/lib/types/findingTypes";
import { usePipelineStore } from "@/lib/stores/pipelineStore";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";
import { sanitizeChatActionPatch, chatPatchToUiState } from "@/lib/chatActions";
import {
  isPipelineViewId,
  navigatePipeline,
} from "@/lib/pipelineNavigation";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface ActionExecutionResult {
  success: boolean;
  /** Describes what happened (e.g. "Navigated to panel X"). */
  summary: string;
  /** True only when the action modified pipeline state. */
  modifiedStore: boolean;
  /** The committed UIState after applying the patch (when modifiedStore is true). */
  committedState?: import("@/types").UIState;
}

// ─── Non-Patch Action Handlers ───────────────────────────────────────────────

/**
 * Execute a navigate action.
 * Scrolls/focuses a target panel element. Does NOT modify PipelineStore.
 */
export function executeNavigateAction(
  action: ActionPayloadNavigate,
): ActionExecutionResult {
  // In a real UI, this would call scrollIntoView or focus. Pure logic only.
  const { targetPanel } = action.payload;
  if (typeof window !== "undefined") {
    if (isPipelineViewId(targetPanel)) {
      navigatePipeline(targetPanel);
    } else {
      window.dispatchEvent(
        new CustomEvent("olive-studio:navigate-panel", { detail: { targetPanel } }),
      );
    }
  }
  return {
    success: true,
    summary: `Navigated to panel: ${targetPanel}`,
    modifiedStore: false,
  };
}

/**
 * Execute an explain action.
 * Injects explanation text into the chat display. Does NOT modify PipelineStore.
 */
export function executeExplainAction(
  action: ActionPayloadExplain,
): ActionExecutionResult {
  // In a real UI, this would append to a chat messages list (separate from PipelineStore).
  const { body } = action.payload;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("olive-studio:explain", { detail: { body } }));
  }
  return {
    success: true,
    summary: `Explanation injected (${body.length} chars)`,
    modifiedStore: false,
  };
}

/**
 * Execute a documentation action.
 * Opens a KB article or external URL. Does NOT modify PipelineStore.
 */
export function executeDocumentationAction(
  action: ActionPayloadDocumentation,
): ActionExecutionResult {
  const { url, topicKey } = action.payload;
  const target = url ?? topicKey ?? "unknown";
  if (typeof window !== "undefined" && typeof url === "string" && url.length > 0) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else if (typeof window !== "undefined" && topicKey) {
    window.dispatchEvent(
      new CustomEvent("olive-studio:documentation", { detail: { topicKey } }),
    );
  }
  return {
    success: true,
    summary: `Documentation opened: ${target}`,
    modifiedStore: false,
  };
}

/**
 * Execute an applyPatch action.
 * Applies the patch through commitUiStateUpdate. DOES modify PipelineStore.
 */
export function executeApplyPatchAction(
  action: ActionPayloadApplyPatch,
): ActionExecutionResult {
  const patch = sanitizeChatActionPatch(action.payload);
  if (!patch) {
    return {
      success: false,
      summary: "Patch failed sanitization",
      modifiedStore: false,
    };
  }
  const currentState = usePipelineStore.getState().state;
  const partial = chatPatchToUiState(currentState, patch);
  // Pass through commitUiStateUpdate to get the committed result, then
  // apply via replaceState so callers can detect coercion differences.
  const committed = commitUiStateUpdate(currentState, partial);
  usePipelineStore.getState().replaceState(committed);
  return {
    success: true,
    summary: "Patch applied to pipeline store",
    modifiedStore: true,
    committedState: usePipelineStore.getState().state,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Execute any Finding action by dispatching on `kind`.
 *
 * **Key invariant:** navigate, explain, and documentation actions return
 * `modifiedStore: false` and never call PipelineStore.setState.
 */
export function executeAction(action: Action): ActionExecutionResult {
  switch (action.kind) {
    case "applyPatch":
      return executeApplyPatchAction(action);
    case "navigate":
      return executeNavigateAction(action);
    case "explain":
      return executeExplainAction(action);
    case "documentation":
      return executeDocumentationAction(action);
  }
}
