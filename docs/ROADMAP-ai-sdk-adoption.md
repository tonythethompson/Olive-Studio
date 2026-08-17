# Roadmap: Vercel AI SDK Adoption

Incremental adoption plan for integrating the [Vercel AI SDK](https://sdk.vercel.ai/) into Olive Studio's assistant infrastructure. Each phase builds on the previous one and can be shipped independently.

---

## Phase 1: AI SDK Provider Packages (Low effort, ~1 day)

**Goal:** Replace hand-rolled HTTP calls in each provider plugin with official AI SDK provider packages.

**What changes:**
- Install `ai` + `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/mistral`, etc.
- Inside each provider's `call()` method, use `generateText()` instead of raw `fetch`
- Keep the existing `registerProvider()` registry, env detection, and `callAI()` dispatch intact

**Example (Gemini):**
```ts
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

// Inside the gemini plugin's call() handler:
const result = await generateText({
  model: google('gemini-2.5-flash', { apiKey: cfg.apiKey }),
  system,
  messages: messages.map(m => ({ role: m.role, content: m.content })),
});
return result.text;
```

**Benefits:**
- Better error handling and automatic retries from the SDK
- Consistent behavior across all providers
- Less HTTP boilerplate to maintain
- Unblocks streaming (Phase 2) since provider instances are already available

**Risk:** Low. Internal refactor only, no user-facing change.

---

## Phase 2: Streaming Chat Responses (Medium effort, ~2-3 days)

**Goal:** Replace the "Thinking..." → full response pattern with token-by-token streaming.

**What changes:**

### Server (`src/server/routes/ai/chatRoutes.ts`)
- Replace `callAI(system, messages, true)` + `parseChatStructuredReply(rawReply)` with `streamText()`
- Stream the reply text progressively to the client
- Send `actions[]` and MCP metadata as a final structured chunk after streaming completes
- Use `pipeTextStreamToResponse()` or a custom NDJSON envelope

### Client (`src/components/features/assistant/useAiChat.ts`)
- Replace `fetch` + `await r.json()` with a `ReadableStream` consumer
- Append text tokens to the current assistant message as they arrive
- Parse the final chunk for `actions[]` and MCP metadata
- Add abort/cancel support (AbortController)

**Protocol sketch:**
```
// Server streams NDJSON lines:
{"type":"text","content":"Here's how to optimize..."}\n
{"type":"text","content":" your model with AWQ"}\n
{"type":"done","actions":[...],"mcp":{...}}\n
```

**Benefits:**
- Users see text appearing token-by-token (3-15s wait → immediate feedback)
- Cancel button becomes possible
- Biggest UX improvement for the assistant

**Risk:** Medium. Requires coordinated changes to the chat route and the `useAiChat` hook. The `parseChatStructuredReply` pipeline needs adaptation since text arrives incrementally but actions arrive at the end.

**Open question:** Whether to stream the `reply` portion as plain text and send structured `actions` separately, or use `Output.object()` streaming (partial JSON). Plain text streaming is simpler and handles the 90% case (user reads the reply; actions are secondary).

---

## Phase 3: Structured Output with Schema Validation (Low effort per route, ~1-2 days)

**Goal:** Replace hand-rolled JSON parsing (`parseJsonFromAiResponse`, `softRepairJson`, fenced code block stripping) with schema-validated structured output.

**What changes:**
- Define Zod schemas for each AI response contract:
  - `ChatStructuredReply` — `{ reply: string, actions: ChatAction[] }`
  - `ReviewFindings` — `{ score: number, findings: Finding[], suggestions: string[] }`
  - `RecipeValidation` — `{ valid: boolean, warnings: string[], suggestions: string[] }`
- Use `generateText({ output: Output.object({ schema }) })` for non-streaming routes (`/ai/validate`, `/ai/analyze-state`)
- Use `streamText({ output: Output.object({ schema }) })` for chat if Phase 2 adopted the structured streaming path

**Example (recipe validation route):**
```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const validationSchema = z.object({
  valid: z.boolean(),
  warnings: z.array(z.string()),
  suggestions: z.array(z.string()),
});

const { output } = await generateText({
  model: providerModel,
  system: "You are an Olive model optimization validator...",
  messages: [{ role: "user", content: `Validate: ${summary}` }],
  output: Output.object({ schema: validationSchema }),
});
// output is typed and validated — no parseJsonFromAiResponse needed
```

**Benefits:**
- Eliminates `softRepairJson`, `scanJsonStringEnd`, fenced-JSON stripping, regex-based extraction
- Type-safe output guaranteed by Zod schema validation
- Better error messages when models produce invalid JSON
- Fewer silent failures from malformed responses

**Risk:** Low. Can be adopted per-route without touching others. The `parseJsonFromAiResponse` utility remains available for any routes not yet migrated.

---

## Future: Full `useChat` Hook Adoption (Reference only)

**Goal:** Replace the entire `useAiChat` hook with the AI SDK's `useChat` for full-featured chat UX.

**What it provides beyond Phase 2:**
- Message regeneration (`regenerate()`)
- Message branching/versioning
- Throttled UI renders during streaming
- File attachments
- Built-in error recovery and retry
- Message deletion and editing
- Metadata per message (token usage, model info, timestamps)

**Integration sketch:**
- Server: `streamText()` + `createUIMessageStreamResponse()` (or `pipeUIMessageStreamToResponse()` for Express)
- Client: `useChat({ transport: new DefaultChatTransport({ api: '/api/ai/chat' }) })`
- `ChatAction` patches → encode as AI SDK tool-call results or custom message metadata
- Workspace context → pass via `body` options on `sendMessage()`

**Why deferred:**
- The assistant is secondary to the pipeline UI — not the primary product surface
- `ChatAction` patches (which modify Zustand pipeline state) require custom message-part handling
- MCP knowledge injection and workspace context are domain-specific concerns that don't map cleanly to the SDK's transport model
- The sidebar layout (tabs, pipeline review, workspace badges, quick queries) would fight the SDK's UI assumptions

**When to revisit:** If the assistant becomes a primary interaction mode (e.g., conversational pipeline configuration), or if cancel/regenerate/branching become user-requested features.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `ai` | Core SDK: `generateText`, `streamText`, `Output` |
| `@ai-sdk/google` | Gemini provider |
| `@ai-sdk/openai` | OpenAI + OpenAI-compatible providers |
| `@ai-sdk/anthropic` | Anthropic/Claude |
| `@ai-sdk/mistral` | Mistral |
| `@ai-sdk/amazon-bedrock` | AWS Bedrock |
| `zod` | Schema definitions for structured output |

Note: `zod` is not currently in `package.json` — it would be a new dependency (small, zero-dep, widely used).

---

## Decision log

- **2025-08-17:** Initial roadmap created. Phased approach chosen over big-bang migration. Phase 1 unblocks everything else with minimal risk.
- **AI Elements UI skipped:** The pre-built chat components assume a standalone chat layout. Our sidebar has custom tabs, pipeline review, action buttons, and workspace badges that wouldn't benefit from the Elements library.
- **Turborepo skipped:** Single-package repo with one Vite build — no monorepo orchestration needed at current scale.
