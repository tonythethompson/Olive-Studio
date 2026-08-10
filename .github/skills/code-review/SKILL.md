---
name: code-review
description: >-
  Olive Studio pull request code review for Copilot code review and coding agents.
  Use when reviewing PRs, diffs, or changed files in this repository. Applies
  loopback-only security, recipe/pipeline validation, Express/Tauri/MCP boundaries,
  pnpm/testing conventions, and high-risk path checks from AGENTS.md and REVIEW.md.
license: MIT
---

# Olive Studio code review

Review pull request changes against Olive Studio conventions. Prefer concrete,
file-scoped findings with suggested fixes. Skip style nits that ESLint already
covers unless they change meaning or hide a bug.

## Project context

- Local-first GUI for Microsoft Olive ONNX optimization (React 19 + Vite + Express + Tauri 2 + Python FastMCP).
- Package manager is **pnpm** only (`npm install` is blocked).
- Threat model is single-user localhost / Tauri. Do not treat LAN or public exposure as safe unless the change adds bind + auth controls.
- Authoritative agent/dev constraints: `AGENTS.md`. Point-in-time risk snapshot: `REVIEW.md`.

## Priority order

1. **Security / trust boundaries** (block merge when concrete)
2. **Correctness** of recipe, pipeline, spawn, and AI/MCP paths
3. **Test coverage** for new behavior at the right tier
4. **Architecture drift** (logic in the wrong layer, mega-panel growth)
5. **Docs** when public behavior, setup, or security guarantees change

## High-risk paths (scrutinize first)

| Area | Paths |
| --- | --- |
| Olive spawn / jobs | `src/server/routes/olive.ts`, `src/server/services/venv/`, `src/server/services/olive/` |
| MCP proxy / Python bridge | `src/server/routes/mcp.ts`, `src/server/services/mcp/`, `olive-mcp-server/` |
| AI keys / SSRF | `src/server/routes/ai/` (entry `index.ts` + submodules), `src/server/services/ai/security.ts` |
| GitHub proxy / SSRF | `src/server/routes/github.ts` |
| Recipe correctness | `src/lib/pipelineValidation.ts`, `src/lib/oliveRecipeBuilder.ts`, `src/lib/schemaEngine.ts`, `src/lib/recipePipeline.ts` |
| Tauri sidecar | `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json` |
| Bind / auth / rate limits | `server.ts`, `src/server/middleware/` |

## Must-check rules

### Security and trust

- Flag secrets, tokens, or credentials in code, fixtures, logs, or examples.
- Treat external input as untrusted: paths, URLs, shell args, process spawn, recipe JSON, MCP responses, model/download artifacts, env vars.
- Recipe filesystem paths must not allow unconstrained `..` / out-of-root writes before Olive spawn.
- New heavy or secret-mutating endpoints need rate limits (or an explicit reason they do not).
- AI provider base URLs and GitHub proxying must keep SSRF / allowlist protections.
- Prefer loopback bind (`127.0.0.1`) over all-interfaces listen unless the change documents and hardens remote access.
- Do not weaken authn, allowlists, python guards, or path checks to make tests pass.

### Olive / MCP / CI gotchas

- **Never** require or introduce real Olive GPU/model downloads in CI or review validation. CPU-only flows are recipe build, JSON export, and validation.
- Python `mcp` must stay pinned `<2` (`mcp.server.fastmcp` breaks on 2.x).
- In-app MCP already invokes `call_tool` via `src/server/services/mcp/client.ts` (inline Python `-c` bridge); `olive_mcp_server/mcp_server.py` exports `call_tool`. Do not flag a missing `call_tool` import. Review tool allowlisting (`allowedTools.ts`), rate limits, admission/breaker behavior, and unsafe interpolation of untrusted args into the Python script instead.
- New AI providers must land on **both** sides: server `registerProvider` / `ALLOWED_AI_PROVIDERS` in `src/server/services/ai/`, and UI `aiProviderCatalog` (`src/components/features/gemini/aiProviderCatalog.ts`). There is no dedicated cross-catalog guard test, so verify both catalogs manually on provider PRs.
- Do not implement Assistant AI backburner providers unless the PR explicitly requests them (see `AGENTS.md`).

### Architecture and maintainability

- Keep validation and recipe rules in `src/lib/` (not duplicated ad hoc in feature panels).
- Prefer extending existing route/service modules over new one-off paths.
- Flag PRs that push already-large panels further past ~1k lines without extraction (`InputEnvironmentPanel`, `IHVIntegrationPanel`, `ExecutionWorkspace`, and similar).
- Prefer direct, typed boundaries over `any` / silent fallbacks that hide invariants.
- UI state updates should go through `pipelineStore` / `commitUiStateUpdate` patterns, not bypass validation.

### Testing

Match changes to the existing tiers:

| Change area | Prefer |
| --- | --- |
| `src/lib/` | `pnpm test` (vitest) |
| `src/server/` | `pnpm test:server` |
| Express + mocked externals | `pnpm test:integration` |
| React components | `pnpm test:component` |
| `olive-mcp-server/` | `cd olive-mcp-server && python -m pytest tests -q` (with `mcp<2`) |
| Recipe builder | `pnpm validate:recipe` |

- Require tests for new critical paths (spawn, path/allowlist, auth/token, rate limit, recipe validation, MCP tool allowlist).
- Integration tests mock `child_process`, AI providers, and fetch via `src/server/__tests__/setup.integration.ts`; do not suggest live Olive runs.
- ESLint warnings are expected (`--max-warnings 20`). Only treat lint **errors** or non-zero exit as review failures.

### Dependencies and tooling

- Reject `npm install` / package-lock additions; use pnpm and `pnpm-lock.yaml`.
- Avoid unrelated dependency upgrades in feature PRs.
- Docs must stay in sync when setup, CLI, config, security, or public API behavior changes.

## MCP context (when available)

When Copilot code review has MCP tools enabled:

- Use the **GitHub MCP** server only if it is available and configured for the review environment. Prefer it for PR-linked issues, prior review threads, or check status when the PR description references issue keys or related PRs.
- If GitHub MCP is unavailable, use another available GitHub integration (`gh`, REST), the PR description, or continue without that lookup. Do not fail the review solely because GitHub MCP is missing.
- Prefer MCP-backed facts over guessing about issue intent or CI status when those tools are accessible.
- Do not invent MCP tools or servers that are not configured for this repository. Repo `.mcp.json` registers Olive MCP for coding agents; that is optional and separate from GitHub MCP.

## Comment style

- Be specific: file, behavior, failure mode, and a concrete fix when possible.
- Separate blocking defects from optional improvements.
- Do not rubber-stamp "it works" if it worsens security boundaries or mega-panel sprawl.
- Acknowledge intentional loopback-only tradeoffs when documented; still call out regressions that expand network or filesystem blast radius.
- Avoid em dashes in review prose.

## Out of scope for this skill

- Approving or requesting changes as a required human reviewer substitute.
- Triggering live Olive optimization or CUDA/model downloads.
- Broad refactors unrelated to the diff under review.
