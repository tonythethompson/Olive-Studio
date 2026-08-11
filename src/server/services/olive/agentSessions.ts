import { randomUUID } from "node:crypto";

export interface AgentSession {
  sessionId: string;
  attemptCount: number;
  lastRecipe: Record<string, unknown> | null;
  lastFailure: string | null;
  success: boolean;
  diagnosticNotes: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentSessionPatch = Partial<
  Pick<AgentSession, "lastRecipe" | "lastFailure" | "success" | "diagnosticNotes">
>;

export interface AgentAttempt {
  recipe?: Record<string, unknown>;
  failure?: string;
  success?: boolean;
  note?: string;
}

const MAX_DIAGNOSTIC_NOTES = 50;
const sessions = new Map<string, AgentSession>();

export function createSession(): AgentSession {
  const now = Date.now();
  const session: AgentSession = {
    sessionId: randomUUID(),
    attemptCount: 0,
    lastRecipe: null,
    lastFailure: null,
    success: false,
    diagnosticNotes: [],
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function updateSession(
  sessionId: string,
  patch: AgentSessionPatch,
): AgentSession | undefined {
  const existing = sessions.get(sessionId);
  if (!existing) return undefined;

  const updated: AgentSession = {
    ...existing,
    ...patch,
    ...(patch.diagnosticNotes
      ? { diagnosticNotes: patch.diagnosticNotes.slice(-MAX_DIAGNOSTIC_NOTES) }
      : {}),
    sessionId: existing.sessionId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  sessions.set(sessionId, updated);
  return updated;
}

export function recordAttempt(
  sessionId: string,
  data: AgentAttempt,
): AgentSession | undefined {
  const existing = sessions.get(sessionId);
  if (!existing) return undefined;

  const updated: AgentSession = {
    ...existing,
    attemptCount: existing.attemptCount + 1,
    lastRecipe: data.recipe ?? existing.lastRecipe,
    lastFailure: data.failure ?? null,
    success: data.success ?? existing.success,
    diagnosticNotes: data.note
      ? [...existing.diagnosticNotes, data.note].slice(-MAX_DIAGNOSTIC_NOTES)
      : existing.diagnosticNotes,
    updatedAt: Date.now(),
  };
  sessions.set(sessionId, updated);
  return updated;
}

/** Test-only reset; the production store intentionally lives for the process lifetime. */
export function clearAgentSessionsForTests(): void {
  sessions.clear();
}
