# Triage: CI, review, conflicts

## CI failures

1. Prefer `gh run view <id> --log-failed` over full logs.
2. Classify each failing job:
   - **Actionable**: code/test/lint failure you can fix in this PR.
   - **Flaky**: same test failed once, green on re-run history, no code change. Re-run once; if it fails again, treat as actionable.
   - **Infra**: runner OOM, network, registry 5xx. Re-run once; if persistent, document and continue other streams.
   - **Permissions / secrets**: missing token or protected env. Document; do not invent credentials.
3. Fix actionable items with minimal diffs. Prefer existing project patterns.
4. After push, wait for new runs. Do not declare green until the latest commit on the PR head is green.

## Review comments

1. Pull threads via `gh api` GraphQL or `gh api repos/{owner}/{repo}/pulls/{n}/comments`.
2. Skip resolved threads unless they reopen a real bug.
3. For each open thread:
   - **Fix**: clear bug, missing test, security, correctness.
   - **Nit**: style-only; fix if cheap, else reply once with rationale and leave.
   - **Out of scope**: reply with why; do not expand PR scope unless user asked.
   - **Wrong**: reply with evidence; do not "fix" correct code to silence bots.
4. After pushing a fix for a thread, reply with commit SHA (short) when useful.
5. Never resolve threads unless the user explicitly asked, or project policy says bots auto-resolve.

## Merge conflicts

1. `git fetch origin <base> <head>`.
2. Merge or rebase per repo convention (prefer merge if history is shared; rebase only if the branch is agent-owned and policy allows).
3. Resolve conflicts conservatively: keep both intents when unclear; prefer base behavior for unrelated files.
4. Run targeted tests for touched areas.
5. Force-with-lease only if the branch was previously force-pushed by this agent and history rewrite is required; otherwise avoid force push.

## Push / PR hygiene

- `git push -u origin HEAD` (or current branch).
- Update PR body only when the change set materially changes; do not churn description every loop.
- Do not add review labels or request reviewers unless asked.
