Tech Debt & Issues
🟢 Quick Wins
1. ai.ts route file is a 1,400+ line monolith
All AI provider logic, LM Studio/Ollama lifecycle, model catalog fetching, Codex, Devin, and Cloudflare are in one file. Split into routes/ai/ sub-modules mirroring the existing services/ai/ pattern already in place.

2. sanitizePipelineState runs up to 16 validation loops on every state commit
Every setState call in the Zustand store triggers commitUiStateUpdate → sanitizePipelineState which calls getPipelineValidation (which calls buildOliveRecipe) in a loop. buildOliveRecipe is called again immediately after in buildRecipeFromState. This means a single UI interaction can trigger 17+ recipe builds. Memoize with a shallow-equality check on UIState or break the loop early once no critical issues remain (it already does, but the recipe build inside each iteration is wasteful).

3. Record<string, any> in types.ts
PassConfig.config and OliveRecipe.systems use any. These should be typed or at minimum Record<string, unknown> (already done in some places but inconsistently).

4. queryClient instantiated at module level in App.tsx

const queryClient = new QueryClient(); // module-level singleton

Copy
ts
This leaks between test runs and prevents per-render configuration. Move inside the component or use a useRef.

5. shouldServeProductionStatic() uses process.argv string matching
Fragile heuristic. A OLIVE_SERVE_STATIC=true env var (already partially done with OLIVE_DIST_DIR) would be cleaner and testable.

6. Duplicate RecipeGraphView.tsx
There are two files: src/components/features/RecipeGraphView.tsx and src/components/features/recipe-graph/RecipeGraphView.tsx. One is almost certainly a stale copy.

7. storybook-static/ committed to the repo
Build artifacts (~30+ files) are committed. Add to .gitignore.

8. models/optimized/ committed to the repo
Actual ONNX model artifacts (model.onnx, footprint.json) are committed. These should be gitignored.

9. Module-level mutable state in ai.ts
cachedLmsCli, lmsCliMissAt, ollamaEnsureInFlight, lmsPullBusyTag, ollamaPullBusyTag, lastOllamaStartAt are all module-level mutable variables. This works for a single-process server but makes testing impossible without module resets and creates subtle bugs if the module is ever hot-reloaded.

10. inferHfTask / inferModelType use fragile substring matching
id.includes("bert") matches roberta, albert, distilbert — some correctly, but the logic is order-dependent and undocumented. A lookup table or regex map would be more maintainable.

🔴 Longer-Term Refactors
11. UIState.passes is a flat bag of 30+ fields
All pass parameters live in one flat object. Adding a new pass requires touching types.ts, defaultPasses.ts, pipelineValidation.ts, oliveRecipeBuilder.ts, and coercePassFields. A discriminated union per pass type (e.g. QuantizationConfig, PruningConfig) would make the type system enforce valid combinations and eliminate the if quantMethod === "awq" chains in oliveRecipeBuilder.ts.

12. oliveRecipeBuilder.ts is a 300-line if/else chain
The quantization section alone has 10+ branches. Each pass type should be a self-contained builder function or class, registered in a map keyed by pass type. This would also make it trivial to add new passes without touching the core builder.

13. No request body validation on server routes
Routes destructure req.body directly with no schema validation (e.g. const { recipeJson, cudaVersion = "auto" } = req.body). A lightweight schema library (zod, or even manual guards) at the route boundary would catch malformed payloads before they reach business logic and improve error messages.

14. getPipelineValidation rebuilds the recipe on every call
getPipelineValidation calls buildOliveRecipe internally, and callers like buildRecipeFromState also call buildOliveRecipe separately. The result is passed as a parameter to sub-validators but the top-level call still rebuilds. The recipe is returned in PipelineValidationResult specifically to avoid this, but sanitizePipelineState doesn't use it — it calls getPipelineValidation again in the next loop iteration.

15. SSE job streaming has no backpressure or log size cap
job.logs is an unbounded array. A long-running Olive job could accumulate thousands of log lines in memory. The SSE stream replays all historical logs on reconnect. Cap logs at ~1000 lines with a ring buffer, or stream-only (no replay beyond last N lines).

16. ensureOllamaReadyImpl / ensureLmsReadyImpl have 40-iteration polling loops
Both functions poll with sleepMs(1000) in a loop (up to 40s for Ollama, 30s for LMS). These block the async event loop slot for the duration and have no way to be cancelled mid-poll. Use exponential backoff and honour an AbortSignal.

17. No persistent job history
jobRegistry is an in-memory Map. Server restart loses all job history. The JobHistoryModal component exists but reads from a separate client-side store. Consider persisting to a local SQLite or JSON file for the batch queue.

18. coercePassFields and getCrossPassIssues encode the same rules twice
Coercion silently fixes state; validation surfaces issues. They must stay in sync manually. A single rule table that drives both would eliminate drift (e.g. the peft + lora + quantization → qlora rule appears in both coercePassFields and getCrossPassIssues).

19. vite listed in both dependencies and devDependencies
vite appears in both sections of package.json. It should only be in devDependencies (it's a build tool, not a runtime dep — though it is used in server.ts for dev middleware, which is the root cause of this ambiguity). The dev/prod server split should be cleaner.

20. Python MCP server has no health check or restart logic
/api/mcp/tool proxies to the Python MCP server but there's no circuit breaker or restart if the Python process dies. A failed MCP call silently degrades the assistant without surfacing the root cause to the user.

Performance & Efficiency Improvements
Memoize buildOliveRecipe: It's a pure function of UIState. A shallow-equality memo (e.g. useMemo on the frontend, or a cached last-result on the server) would eliminate redundant builds during rapid UI interactions.

Debounce validation: commitUiStateUpdate runs synchronously on every keystroke (e.g. typing in the model ID field). Debounce the validation pass by 150–300ms for text inputs.

@huggingface/transformers in dependencies: This is a ~50MB package used only for in-browser ONNX inference in the Playground. It should be dynamically imported and excluded from the main bundle. The vite manualChunks config doesn't currently split it.

onnxruntime-web bundle size: Similarly, onnxruntime-web is a large dependency. It's already used lazily in the Playground but ensure it's not imported anywhere in the critical path.

@mendable/firecrawl-js is a server-only dep in dependencies: It's used for optional web search fallback in the MCP assistant. It should be in devDependencies or dynamically required server-side to avoid it being bundled into the client.

React Query cache: The queryClient has default stale times. Hardware probe results (/api/system/probe) are expensive (spawns processes) but are re-fetched on every window focus by default. Set staleTime: Infinity or a long TTL for probe results.

execSync in findLmsCli: Uses synchronous execSync("where lms") which blocks the Node.js event loop. Replace with execFileAsync + cache.


