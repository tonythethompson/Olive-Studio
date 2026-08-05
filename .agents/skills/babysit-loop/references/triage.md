# Triage: CI, review, conflicts

## CI failures

1. Prefer `gh run view <id> --log-failed` over full logs.
2. Classify each failing job:
   - **Actionable**: code/test/lint failure you can fix in this PR.
   - **Flaky**: same test failed once, green on re-run history, no code change. Re-run once; if it fails again, treat as actionable.
   - **Infra**: runner OOM, network, registry 5xx. Re-run once; if persistent, document and continue other PRs in the batch.
   - **Permissions / secrets**: missing token or protected env. Document; do not invent credentials.
3. Fix actionable items with minimal diffs. Prefer existing project patterns.
4. After push, do not declare green until the latest commit on the PR head is green.

## Review comments

1. Pull threads via GraphQL; page until `hasNextPage` is false.
2. Skip already-resolved threads unless they reopen a real bug.
3. For each open thread:
   - **Fix**: clear bug, missing test, security, correctness → code change + reply + resolve.
   - **Nit**: fix if cheap; otherwise reply why skipped + resolve when the skip is intentional.
   - **Out of scope / wrong**: reply with why (cite code/docs); resolve only when the thread is answered and no code change is warranted.
   - **Needs human**: reply with the decision needed; leave unresolved; add to session `blocked`.
4. **Never leave an unresolved thread untouched.** Either fix it or comment why it was intentionally skipped / needs the user.
5. After pushing a fix, reply with the short commit SHA when useful.
6. Reply before resolve. Never resolve silently.

## Merge conflicts

1. `git fetch origin <base> <head>`.
2. Merge or rebase per repo convention (prefer merge if history is shared; rebase only if the branch is agent-owned and policy allows).
3. Resolve conflicts conservatively: keep both intents when unclear; prefer base behavior for unrelated files.
4. Run targeted tests for touched areas.
5. Force-with-lease only if the branch was previously force-pushed by this agent and history rewrite is required; otherwise avoid force push.

## Push / PR hygiene

- Check out / work on each PR's head branch when acting on that PR; return to batch order.
- `git push -u origin HEAD` (or current branch).
- Update PR body only when the change set materially changes; do not churn description every loop.
- Do not add review labels or request reviewers unless asked.
