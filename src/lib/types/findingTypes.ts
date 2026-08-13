/**
 * Unified Assistant Finding/Action contract types.
 *
 * These types define the shared contract between the AI review engine,
 * deterministic pipeline validation, and the AssistantPanel UI. They supersede
 * the legacy `Suggestion` interface.
 *
 * @module findingTypes
 */

import type { UIState } from "@/types";
import type { ChatActionPatch } from "@/lib/chatActions";

// ─── Severity & Kind ─────────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "warning" | "info";

export type ActionKind = "applyPatch" | "navigate" | "explain" | "documentation";

// ─── Action Discriminated Union ──────────────────────────────────────────────

export interface ActionPayloadApplyPatch {
  kind: "applyPatch";
  /** Button label (max 80 chars). */
  label: string;
  /** Validated by `sanitizeChatActionPatch`. */
  payload: ChatActionPatch;
}

export interface ActionPayloadNavigate {
  kind: "navigate";
  /** Button label (max 80 chars). */
  label: string;
  payload: { targetPanel: string };
}

export interface ActionPayloadExplain {
  kind: "explain";
  /** Button label (max 80 chars). */
  label: string;
  /** Markdown body injected into the chat. */
  payload: { body: string };
}

export interface ActionPayloadDocumentation {
  kind: "documentation";
  /** Button label (max 80 chars). */
  label: string;
  payload: { url?: string; topicKey?: string };
}

/** Discriminated union on `kind`. */
export type Action =
  | ActionPayloadApplyPatch
  | ActionPayloadNavigate
  | ActionPayloadExplain
  | ActionPayloadDocumentation;

// ─── Finding ─────────────────────────────────────────────────────────────────

export interface Finding {
  /** Unique within a review run. */
  id: string;
  /** Max 120 chars. */
  title: string;
  /** Max 2000 chars. */
  description: string;
  severity: FindingSeverity;
  /** Supporting evidence text shown beneath the description. */
  evidence: string;
  /** 1–10 actions attached to this finding. */
  actions: Action[];
}

// ─── Review Result ───────────────────────────────────────────────────────────

export interface ReviewResult {
  findings: Finding[];
  /** Pipeline health score (0–100). */
  score: number;
  /** Human-readable level label. */
  level: "Optimized" | "Suboptimal" | "Inefficient";
  /** Short narrative summary of the review. */
  summary: string;
  /** SHA-256 hex of UIState at the time of review. */
  fingerprint: string;
  /** ISO 8601 timestamp of review completion. */
  timestamp: string;
}

// ─── Workspace Fingerprint ───────────────────────────────────────────────────

export interface WorkspaceFingerprintState {
  /** SHA-256 hex string (64 chars). */
  fingerprint: string;
  /** `Date.now()` timestamp when fingerprint was computed. */
  computedAt: number;
}

/**
 * UIState keys excluded from workspace fingerprint computation.
 * These are transient fields whose changes should not invalidate review results.
 */
export const FINGERPRINT_EXCLUDED_KEYS: (keyof UIState)[] = [
  "activeJobId",
  "localFiles",
];
