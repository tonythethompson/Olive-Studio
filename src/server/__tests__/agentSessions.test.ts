import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_SESSION_TTL_MS,
  clearAgentSessionsForTests,
  createSession,
  getSession,
  MAX_AGENT_SESSIONS,
  recordAttempt,
  updateSession,
} from "../services/olive/agentSessions.ts";

describe("agent session store", () => {
  beforeEach(clearAgentSessionsForTests);
  afterEach(() => vi.restoreAllMocks());

  it("creates unique UUID sessions with empty retry context", () => {
    const sessions = Array.from({ length: 20 }, () => createSession());

    expect(new Set(sessions.map((session) => session.sessionId))).toHaveLength(20);
    expect(sessions[0]).toMatchObject({
      attemptCount: 0,
      lastRecipe: null,
      lastFailure: null,
      success: false,
      diagnosticNotes: [],
    });
    expect(sessions[0].sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns undefined for an unknown session", () => {
    expect(getSession("missing")).toBeUndefined();
  });

  it("merges metadata without incrementing attemptCount", () => {
    const created = createSession();
    const updated = updateSession(created.sessionId, {
      lastFailure: "diagnostic only",
      diagnosticNotes: ["note"],
    });

    expect(updated).toMatchObject({
      sessionId: created.sessionId,
      attemptCount: 0,
      lastFailure: "diagnostic only",
      diagnosticNotes: ["note"],
    });
  });

  it("records attempts and keeps only the latest 50 notes", () => {
    const created = createSession();
    for (let index = 0; index < 55; index += 1) {
      recordAttempt(created.sessionId, {
        recipe: { index },
        failure: `failure-${index}`,
        success: false,
        note: `note-${index}`,
      });
    }

    const session = getSession(created.sessionId);
    expect(session).toMatchObject({
      attemptCount: 55,
      lastRecipe: { index: 54 },
      lastFailure: "failure-54",
      success: false,
    });
    expect(session?.diagnosticNotes).toHaveLength(50);
    expect(session?.diagnosticNotes[0]).toBe("note-5");
    expect(session?.diagnosticNotes.at(-1)).toBe("note-54");
  });

  it("expires sessions that have been idle past the TTL", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const created = createSession();

    vi.spyOn(Date, "now").mockReturnValue(now + AGENT_SESSION_TTL_MS + 1);

    expect(getSession(created.sessionId)).toBeUndefined();
  });

  it("evicts the oldest sessions when the store exceeds the size cap", () => {
    const created = Array.from({ length: MAX_AGENT_SESSIONS + 5 }, (_, index) => {
      vi.spyOn(Date, "now").mockReturnValue(index);
      return createSession();
    });

    expect(getSession(created[0]!.sessionId)).toBeUndefined();
    expect(getSession(created[4]!.sessionId)).toBeUndefined();
    expect(getSession(created[5]!.sessionId)).toBeDefined();
    expect(getSession(created.at(-1)!.sessionId)).toBeDefined();
  });
});
