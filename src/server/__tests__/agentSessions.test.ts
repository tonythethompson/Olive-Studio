import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAgentSessionsForTests,
  createSession,
  getSession,
  recordAttempt,
  updateSession,
} from "../services/olive/agentSessions.ts";

describe("agent session store", () => {
  beforeEach(clearAgentSessionsForTests);

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
});
