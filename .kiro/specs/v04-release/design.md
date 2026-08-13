# Design Document: v0.4.0 Release

## Overview

This design covers three workstreams for Olive Studio v0.4.0:

1. **Validation & test hardening** — Unit and integration tests for CROSS_PASS_RULES, removed-pass advisories, trust_remote_code advisory, pass migration, and recipe validation.
2. **Agent loop state** — Express-side in-memory session store for agent retry workflows, exposed via REST API and consumed by MCP tools.
3. **GraphCanvas SVG dedup** — Extract shared SVG definitions into a `<defs>` block, replace inline duplicates with `<use>` references.

## Architecture

### Workstream 1: Test Hardening

No new production code. New test files exercise existing modules:

```
src/lib/__tests__/crossPassRules.test.ts          — CROSS_PASS_RULES unit tests
src/lib/__tests__/pipelineValidation.test.ts      — Extended with kquant, removed-pass, trust_remote_code tests
src/lib/__tests__/passMigrationIntegration.test.ts — Extended with fixture assertions
```

Tests use the existing `baseState()` helper pattern from `pipelineValidation.test.ts` to construct minimal UIState objects with targeted overrides.

### Workstream 2: Agent Loop State

```
src/server/services/olive/agentSessions.ts   — In-memory store (Map<string, AgentSession>)
src/server/routes/olive.ts                   — Two new routes mounted under /api/olive/agent/sessions
olive-mcp-server/.../tools/studio_loopback.py — Session read/write helpers (httpx GET/PUT)
```

Data flow:

```
MCP Tool (Python)  ──httpx GET/PUT──▶  Express /api/olive/agent/sessions/:id
                                              │
                                              ▼
                                     agentSessions Map (in-process memory)
```

### Workstream 3: GraphCanvas SVG Dedup

```
src/components/features/execute/recipe-graph/GraphCanvas.tsx  — Refactored SVG output
src/components/features/execute/recipe-graph/svgDefs.ts       — Shared <defs> constants
```

## Components and Interfaces

### 2.1 AgentSession Interface

```typescript
export interface AgentSession {
  sessionId: string;
  attemptCount: number;
  lastRecipe: Record<string, unknown> | null;
  lastFailure: string | null;
  success: boolean;
  diagnosticNotes: string[];
  createdAt: number;   // Date.now() epoch ms
  updatedAt: number;
}
```

### 2.2 Agent Session Store

```typescript
// src/server/services/olive/agentSessions.ts
import { randomUUID } from "node:crypto";

const sessions = new Map<string, AgentSession>();

export function createSession(): AgentSession {
  const session: AgentSession = {
    sessionId: randomUUID(),
    attemptCount: 0,
    lastRecipe: null,
    lastFailure: null,
    success: false,
    diagnosticNotes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function updateSession(
  sessionId: string,
  patch: Partial<Omit<AgentSession, "sessionId" | "createdAt">>,
): AgentSession | undefined {
  const existing = sessions.get(sessionId);
  if (!existing) return undefined;
  const updated: AgentSession = {
    ...existing,
    ...patch,
    sessionId: existing.sessionId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  sessions.set(sessionId, updated);
  return updated;
}

const MAX_DIAGNOSTIC_NOTES = 50;

export function recordAttempt(
  sessionId: string,
  data: { recipe?: Record<string, unknown>; failure?: string; success?: boolean; note?: string },
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
```

### 2.3 Express Routes

Two routes added to `src/server/routes/olive.ts` under the agent prefix:

```typescript
// GET /api/olive/agent/sessions/:sessionId
router.get(
  "/agent/sessions/:sessionId",
  studioLocalOnly,
  (req: Request, res: Response) => {
    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  },
);

// PUT /api/olive/agent/sessions/:sessionId
// When body includes { attempt: true }, calls recordAttempt() (increments attemptCount).
// Otherwise calls updateSession() for metadata-only patches (e.g. diagnosticNotes).
router.put(
  "/agent/sessions/:sessionId",
  studioLocalOnly,
  async (req: Request, res: Response) => {
    const body = await parseBody(req);
    if (isParseBodyError(body)) return res.status(400).json({ error: body.message });
    const { attempt, ...data } = body;
    const session = attempt
      ? recordAttempt(req.params.sessionId, data)
      : updateSession(req.params.sessionId, data);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  },
);

// POST /api/olive/agent/sessions (create new session)
// Called by MCP _ensure_session() when no session_id is provided (auto-creation path).
router.post(
  "/agent/sessions",
  studioLocalOnly,
  async (req: Request, res: Response) => {
    await parseBody(req); // Required by project convention for all POST routes
    const session = createSession();
    res.status(201).json(session);
  },
);
```

### 2.4 MCP Tool Integration (Python)

MCP tools use the existing `studio_loopback.py` HTTP helpers:

```python
# In each agent tool (plan_optimization, execute_and_observe, diagnose_and_fix):
async def _ensure_session(session_id: str | None) -> tuple[str, dict]:
    """Get or create agent session via Studio loopback.

    This is the auto-creation path referenced in Requirement 7.1: when an MCP
    tool is invoked without a session_id, _ensure_session() calls POST to
    create a new session transparently. The returned session_id is then passed
    to all subsequent tool calls in the same agent loop.
    """
    if session_id:
        resp = await loopback_get(f"/api/olive/agent/sessions/{session_id}")
        if resp.status_code == 200:
            return session_id, resp.json()
    # Auto-create: first tool call without a session_id triggers this path
    resp = await loopback_post("/api/olive/agent/sessions", json={})
    data = resp.json()
    return data["sessionId"], data

async def _record_attempt(session_id: str, **kwargs) -> None:
    """Record attempt result to session store.

    Sends { attempt: true, ...kwargs } so the Express PUT route dispatches
    to recordAttempt() which increments attemptCount and trims notes.
    """
    await loopback_put(
        f"/api/olive/agent/sessions/{session_id}",
        json={"attempt": True, **kwargs},
    )
```

### 3.1 SVG Defs Module

```typescript
// src/components/features/execute/recipe-graph/svgDefs.ts
export const WIRE_GRADIENT_ID = "wireGradient";
export const ARROW_MARKER_ID = "graphArrowMarker";

/** Shared SVG <defs> content for the graph canvas. */
export function GraphSvgDefs() {
  return (
    <>
      <linearGradient id={WIRE_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#8DA840" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
      <marker
        id={ARROW_MARKER_ID}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8DA840" opacity="0.7" />
      </marker>
    </>
  );
}
```

### 3.2 GraphCanvas Refactored SVG

The `renderSVGConnections` function is updated to:

1. Import `GraphSvgDefs` and `ARROW_MARKER_ID` from `svgDefs.ts`
2. Place `<GraphSvgDefs />` inside the single `<defs>` element
3. Add `markerEnd={`url(#${ARROW_MARKER_ID})`}` to terminal connection paths
4. Remove the inline `<linearGradient>` that currently lives inside `renderSVGConnections`

Node shapes that are repeated (e.g. the icon container rounded-rect pattern) are extracted as `<symbol>` definitions in the defs block and referenced via `<use>`.

## Data Models

### AgentSession (TypeScript)

| Field           | Type                            | Description                                |
| --------------- | ------------------------------- | ------------------------------------------ |
| sessionId       | string                          | UUID v4, immutable after creation          |
| attemptCount    | number                          | Incremented on each recorded attempt       |
| lastRecipe      | Record<string, unknown> \| null | Most recent submitted recipe JSON          |
| lastFailure     | string \| null                  | Error text from most recent failed attempt |
| success         | boolean                         | Whether the last attempt succeeded         |
| diagnosticNotes | string[]                        | Accumulated diagnostic observations        |
| createdAt       | number                          | Epoch ms of session creation               |
| updatedAt       | number                          | Epoch ms of last mutation                  |

### Session Store Constraints

- Sessions are keyed by `sessionId` (UUID)
- No TTL eviction in v0.4 (bounded by process lifetime)
- Maximum diagnostic notes array length: 50 entries (oldest trimmed)
- No persistence to disk — data lost on Express restart (acceptable for local-only app)

## Error Handling

| Scenario                               | Response                                      |
| -------------------------------------- | --------------------------------------------- |
| GET/PUT non-existent session           | 404 `{ error: "Session not found" }`          |
| PUT with malformed body                | 400 `{ error: "<parseBody message>" }`        |
| Non-loopback request to session routes | 403 (studioLocalOnly rejects)                 |
| MCP httpx call to unreachable Express  | Tool returns structured error, does not crash |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Prework

Acceptance Criteria Testing Prework:

1.1 WHEN the `qairt-pipeline-requires-qnn` rule is evaluated with a non-QNN provider and `qairtPipeline` enabled, THE Pipeline_Validator SHALL return a critical issue.
  Thoughts: This is about all non-QNN providers. We can generate any arbitrary non-QNN provider and check the rule fires. The provider set is finite and small, so this is more suited to exhaustive example testing across the known provider enum.
  Classification: EXAMPLE
  Test Strategy: Test each non-QNN provider individually.

1.2 WHEN the `qairt-pipeline-requires-qnn` rule is evaluated with QNNExecutionProvider and `qairtPipeline` enabled, THE Pipeline_Validator SHALL return no issue for that rule.
  Thoughts: Specific example test for the two QNN providers.
  Classification: EXAMPLE
  Test Strategy: Test with QNNExecutionProvider and QnnAbiExecutionProvider.

1.3-1.4 simplified-layernorm-requires-qnn rule with non-QNN / QNN providers.
  Thoughts: Same pattern as 1.1-1.2 — finite provider set, exhaustive example tests.
  Classification: EXAMPLE
  Test Strategy: Test each provider against the rule.

1.5-1.6 isQuantMethodAllowed("kquant", provider) returns false/true based on provider.
  Thoughts: This is a pure function with a finite domain (IHVProvider enum). For any provider in the set {all providers minus CPU/CUDA}, the function returns false. For CPU/CUDA it returns true. The domain is small enough for exhaustive examples, but the universal property "for any non-CPU/CUDA provider, kquant is disallowed" is well-stated.
  Classification: PROPERTY
  Test Strategy: For any provider from the full IHVProvider set, isQuantMethodAllowed("kquant", p) should equal (p === "CPUExecutionProvider" || p === "CUDAExecutionProvider").

2.1-2.3 Removed-pass advisory warnings for specific pass names.
  Thoughts: These test specific named passes. However, the REMOVED_PASSES lookup table pattern generalizes: for any key in the REMOVED_PASSES record present in passRecipeOverrides, an advisory should fire. This is a property.
  Classification: PROPERTY
  Test Strategy: For any deprecated pass name from the known removed-passes set, if present in passRecipeOverrides, a matching advisory issue is emitted.

2.4 No deprecated pass key → no removed-pass advisory.
  Thoughts: This is the complement of 2.1-2.3. For any passRecipeOverrides that does NOT contain a removed pass name, no removed-pass advisory fires.
  Classification: PROPERTY
  Test Strategy: For any passRecipeOverrides with keys drawn from non-deprecated pass names, zero removed-pass advisories are returned.

3.1-3.3 trust_remote_code advisory conditions.
  Thoughts: This is a small combinatorial space (trustRemoteCode: true/false × modelSource: huggingface/local/azure). Only one combination fires the advisory. Can be exhaustively tested as examples.
  Classification: EXAMPLE
  Test Strategy: Three specific examples covering the combinations.

4.1 applyMigrations renames MobiusModelBuilder → MobiusBuilder.
  Thoughts: This is a deterministic migration with fixed input/output. Example test.
  Classification: EXAMPLE
  Test Strategy: Construct state with MobiusModelBuilder override, assert renamed.

4.2 applyMigrations removes QairtPreparation and QairtGenAIBuilder.
  Thoughts: Same as above — fixed removals. Example test.
  Classification: EXAMPLE
  Test Strategy: Construct state with both keys, assert removed.

4.3-4.4 buildOliveRecipe emits/omits trust_remote_code.
  Thoughts: These already exist as integration tests. Example-based.
  Classification: EXAMPLE
  Test Strategy: Specific state configurations, check recipe output.

5.1 pnpm validate:recipe passes.
  Thoughts: This is a smoke test — single execution.
  Classification: SMOKE
  Test Strategy: Run the script, assert exit code 0.

6.1 Zero 0.12.1 references in production source.
  Thoughts: This is a one-time codebase sweep. Smoke/example test.
  Classification: SMOKE
  Test Strategy: grep for "0.12.1" in src/, assert zero hits excluding allowed paths.

7.1 Agent session creation with UUID and defaults.
  Thoughts: createSession() is deterministic structure-wise. But the property "for any number of createSession calls, each returns a unique sessionId" is testable.
  Classification: PROPERTY
  Test Strategy: For any N calls to createSession(), all returned sessionIds are unique.

7.2 GET returns full session object.
  Thoughts: Example-based — create a session, GET it, check fields.
  Classification: EXAMPLE
  Test Strategy: Create session, HTTP GET, assert all fields present.

7.3 PUT merges fields and increments attemptCount.
  Thoughts: This is a property: for any valid session and any valid patch, the merged result contains the patch fields and attemptCount increments when recording an attempt. This generalizes across arbitrary patch shapes.
  Classification: PROPERTY
  Test Strategy: For any existing session and any valid partial update body, the returned session contains merged values and an incremented attemptCount when `recordAttempt` is used.

7.4 GET/PUT non-existent session → 404.
  Thoughts: Edge case for any random UUID not in the store.
  Classification: EDGE_CASE
  Test Strategy: Generate random UUID, GET it, assert 404.

7.5 studioLocalOnly middleware rejects non-loopback.
  Thoughts: This is infrastructure wiring — tested once as example.
  Classification: INTEGRATION
  Test Strategy: One integration test asserting 403 from non-loopback.

7.6 parseBody() on PUT routes.
  Thoughts: Infrastructure wiring test.
  Classification: INTEGRATION
  Test Strategy: Send malformed body, assert 400.

7.7 MCP tools read/write session context.
  Thoughts: Integration between Python and Express. Not property-testable locally.
  Classification: INTEGRATION
  Test Strategy: Mock HTTP calls in Python tests, verify request shape.

7.8 Sessions survive MCP restart.
  Thoughts: Architecture constraint — not directly testable as a property. Integration test.
  Classification: INTEGRATION
  Test Strategy: Document in integration test that Express in-memory Map outlives stdio child.

8.1 Single `<defs>` block.
  Thoughts: For any rendered GraphCanvas, there should be exactly one `<defs>` element. This is a DOM invariant.
  Classification: PROPERTY
  Test Strategy: For any UIState configuration that renders a graph, the DOM contains exactly one `<defs>` element within the SVG.

8.2 Shared geometry uses `<use>` references.
  Thoughts: For any node rendered, if its shape ID matches a defined symbol, it uses `<use>`. Component-level example test.
  Classification: EXAMPLE
  Test Strategy: Render graph, assert `<use>` elements reference defs IDs.

8.3 Arrow marker defined and referenced.
  Thoughts: DOM invariant assertion — single example.
  Classification: EXAMPLE
  Test Strategy: Render graph, assert marker element exists and paths reference it.

8.4 Visual equivalence before/after refactor.
  Thoughts: This is a visual regression concern — cannot be property tested. Manual/screenshot comparison.
  Classification: INTEGRATION
  Test Strategy: Visual regression test or manual verification.

8.5 Interactive behaviour preserved.
  Thoughts: Functional test — click/keyboard events still work. Example-based component test.
  Classification: EXAMPLE
  Test Strategy: Component test with user-event simulating clicks and keyboard.

8.6 No duplicate gradient/marker IDs in DOM.
  Thoughts: For any rendered graph state, count occurrences of each ID in the defs — each must appear exactly once. This is a property over all possible UIState configurations.
  Classification: PROPERTY
  Test Strategy: For any UIState that produces active graph nodes, the rendered SVG contains zero duplicate `id` attributes among gradient and marker elements.

#### Property Reflection

Reviewing all identified properties:

- Property from 1.5-1.6 (kquant allowed iff CPU/CUDA): Standalone, tests isQuantMethodAllowed logic.
- Property from 2.1-2.4 (removed-pass advisory for any deprecated key): Combines 2.1-2.4 into one property.
- Property from 7.1 (unique session IDs): Tests store creation uniqueness.
- Property from 7.3 (PUT merges + increments): Tests store mutation semantics.
- Property from 8.1 (single defs block): DOM structure invariant.
- Property from 8.6 (no duplicate IDs): DOM dedup invariant.

Properties 8.1 and 8.6 are related but not redundant — 8.1 asserts structural uniqueness of the `<defs>` container, 8.6 asserts uniqueness of individual definition IDs within it. Both provide distinct validation value.

No redundancies found. All 6 properties are retained.

### Property 1: kquant provider constraint

*For any* execution provider in the IHVProvider enum, `isQuantMethodAllowed("kquant", provider)` SHALL return `true` if and only if `provider` is `"CPUExecutionProvider"` or `"CUDAExecutionProvider"`.

**Validates: Requirements 1.5, 1.6**

### Property 2: Removed-pass advisory emission

*For any* pass name present in the `REMOVED_PASSES` lookup table, if that pass name appears as a key in `passRecipeOverrides`, the Pipeline_Validator SHALL emit an advisory warning issue with id `removed-pass-{passName}`. Conversely, for any `passRecipeOverrides` whose keys are all absent from the REMOVED_PASSES table, zero removed-pass advisory issues SHALL be emitted.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Session ID uniqueness

*For any* sequence of N calls to `createSession()`, all N returned `sessionId` values SHALL be distinct.

**Validates: Requirements 7.1**

### Property 4: Session update merge semantics

*For any* existing session and any valid partial update containing `lastRecipe`, `lastFailure`, `success`, or `diagnosticNotes`, calling `recordAttempt` SHALL produce a session where `attemptCount` equals the previous value plus one, and all provided fields are reflected in the result.

**Validates: Requirements 7.3**

### Property 5: Single SVG defs container

*For any* UIState that produces at least one active pipeline node, the rendered GraphCanvas SVG SHALL contain exactly one `<defs>` element.

**Validates: Requirements 8.1**

### Property 6: No duplicate SVG definition IDs

*For any* UIState that produces a rendered GraphCanvas, no `id` attribute value among `<linearGradient>`, `<marker>`, and `<symbol>` elements SHALL appear more than once in the rendered DOM.

**Validates: Requirements 8.6**

## Testing Strategy

| Test Tier     | Files                                                                             | Command                 |
| ------------- | --------------------------------------------------------------------------------- | ----------------------- |
| Unit (lib)    | `src/lib/__tests__/crossPassRules.test.ts`, extended `pipelineValidation.test.ts` | `pnpm test`             |
| Unit (server) | `src/server/__tests__/agentSessions.test.ts`                                      | `pnpm test:server`      |
| Integration   | Extended `passMigrationIntegration.test.ts`                                       | `pnpm test:integration` |
| Component     | `src/components/features/execute/recipe-graph/__tests__/GraphCanvas.test.tsx`     | `pnpm test:component`   |
| Smoke         | `pnpm validate:recipe`                                                            | CI pipeline             |
