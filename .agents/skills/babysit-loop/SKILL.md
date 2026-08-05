---
name: babysit-loop
description: >
  Use when asked to babysit PRs, /babysit-loop, watch PRs until merge-ready, keep
  CI and review green over time, or loop on failing checks and open review threads
  across one or more PRs with a configured wait between batches.
---

# Babysit Loop

Owns one or more open PRs across uncapped batches until each is merge-ready or
blocked on a human decision. Interactive intake when arguments are missing.
Never merges.

## Intake (required before the first batch)

When the user runs `/babysit-loop` with **no PR list** (empty `$ARGUMENTS`), do
**not** invent targets. Ask these two questions **in order**, wait for answers,
then start:

1. **Which PRs?**  
   Accept numbers, URLs, or branch names (resolve branches with `gh pr view`).  
   Example prompt: `Which PR(s) should I babysit? (numbers, URLs, or branches)`

2. **Wait between batches?**  
   Example prompt: `How long should I wait between each full pass over those PRs? (e.g. 5 minutes)`  
   Parse durations like `5 minutes`, `5m`, `300s`. Default only if the user says
   "default" / "whatever": **5 minutes**.

If `$ARGUMENTS` already includes PRs (and optional wait), skip the matching
questions. Examples:

- `/babysit-loop 111 113` → ask only for wait
- `/babysit-loop 111 113 every 5m` → start immediately
- `/babysit-loop` → ask PRs, then wait

Persist the session after intake (see [references/state-schema.md](references/state-schema.md)):

`.cursor/babysit-loop/session.json`

## Loop contract

```text
intake (once) →
  for each PR in order:
    snapshot → reviews → conflicts → CI to green → next PR
  → wait <interval> → batch again (uncapped)
```

Rules:

- Process PRs **consecutively** (finish PR A work for this batch before PR B).
- Within a PR, clear **all** actionable streams this batch: unresolved review
  threads, merge conflicts, then CI failures until green (or blocked).
- After **every PR in the list** has been handled for the batch, **wait the
  configured interval**, then start the next batch from the first PR again.
- No batch/round cap. Stop only on **DONE** (all PRs clean), **BLOCKED** (human
  needed and nothing else to do), or the user stops the run.
- **Never merge.**

## Per-PR work (each PR, each batch)

Order inside one PR:

| Step | Stream | Goal |
| ---- | ------ | ---- |
| 1 | Review threads | Every unresolved thread: fix + reply, or reply why intentionally skipped |
| 2 | Merge conflicts | Resolve onto base; commit; push |
| 3 | CI / tests | Failures fixed until checks green (or blocked) |

Skip a stream only when already clean. Dedup with signatures so the same thread
or CI fingerprint is not "fixed" twice without new evidence.

Triage playbooks: [references/triage.md](references/triage.md).  
Protocol notes: [references/loop-protocol.md](references/loop-protocol.md).

### Snapshot

```bash
gh pr view <n> --json number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,commits
gh pr checks <n> --json name,bucket,state,workflow,link
```

Page **all** review threads (`hasNextPage` until done):

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$n:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$n){
      reviewThreads(first:50, after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{id isResolved path line
          comments(first:10){nodes{databaseId author{login} body createdAt}}
        }
      }
    }
  }
}' -f owner=<owner> -f repo=<repo> -F n=<n>
```

### Review threads

For each unresolved thread:

| Kind | Action |
| ---- | ------ |
| Real bug / clear improvement | Fix in code; reply with what changed (+ short SHA); resolve |
| Nit (cheap) | Fix or reply why skipped; resolve only after a reply |
| Out of scope / wrong / intentional skip | **Leave a thread reply** explaining why; do not silently ignore |
| Needs product/design choice | Reply with the question; keep open; add to session `blocked` |
| Already fixed earlier | Reply pointing at the commit; resolve |

**Reply before resolve. Never resolve silently. Never skip a thread without a reply.**

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies -f body="<what changed or why skipped>"
gh api graphql -f query='mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){thread{isResolved}}
}' -f id=<threadId>
```

### Merge conflicts

Merge or rebase onto the PR base (prefer merge unless the branch already
rebases). Resolve, quick-verify (`pnpm lint` / targeted tests), commit, push.
Record signature `conflict:<baseSha>`.

### CI / tests

Prefer `gh pr checks` over Actions-only lists. Classify per
[references/triage.md](references/triage.md).

- Pull failed logs (`gh run view <id> --log-failed` when GHA).
- Fix root cause; run the local equivalent before push.
- Flake: retry **once**; same signature again → treat as real or **BLOCKED**.
- Unrelated base breakage: merge/rebase base instead of bloating the PR.
- Do not call the PR green until the **latest head SHA** is green.

After a fix push: normal `git push` (no force unless the user already set a
rebase + force-with-lease workflow). Re-trigger review bots as **separate**
comments only when this repo uses them (`@cursor review`, etc.).

## Batch wait

After the last PR in the list is handled for this batch:

1. Write session state (`batch`, `lastBatchAt`, per-PR summaries).
2. Wait the configured interval (e.g. 5 minutes). Prefer, in order:
   - Harness wakeup / scheduled follow-up with the same resume prompt
   - `sleep <seconds>` (or equivalent) for the full interval when the harness allows a long block
   - Checkpoint: end the turn with a resume line that includes the wait (user or harness continues)
3. Start the next batch from the first PR.

Do **not** busy-poll with short sleeps. One wait for the full interval between batches.

## Stop conditions

| Result | When |
| ------ | ---- |
| **DONE** | Every listed PR is open, mergeable, checks green (or only ignored failures), and has zero unresolved review threads |
| **BLOCKED** | At least one PR needs a human decision or is stuck on the same signature with no new evidence, and no other listed PR still has actionable work |
| **RESUME** | Batch finished or mid-wait; continue after the interval |

When DONE or BLOCKED, mark session `"status":"stopped"` (or delete it) and
summarize each PR. **Do not merge.**

## Resume line

```text
Resume: /babysit-loop PRs <n1,n2,…> batch <b> wait <duration> state=.cursor/babysit-loop/session.json
```

On resume: load session, re-snapshot live data (state is a cache), continue the
current batch position or start the next batch if the wait elapsed.

## Guardrails

- Ask for PRs and wait interval when missing; do not guess.
- Consecutive multi-PR order; wait only after the full batch.
- Never `--no-verify` to bypass hooks.
- Never weaken tests to silence CI unless the behavior change is intentional and stated.
- Never resolve a thread without a reply; never skip a thread without a comment.
- Never combine `@cursor` and `@greptile` into one comment.
- Prefer repo package manager / test commands from project agent docs (`pnpm` here).

## Related skills

- `loop-on-ci` — CI-only watch/fix slice
- `get-pr-comments` — one-shot comment summary
- `fix-merge-conflicts` — conflict resolution detail
- `review-bugbot` / Bugbot subagent — explicit Bugbot pass when requested

## Details

- [references/state-schema.md](references/state-schema.md) — session + per-PR JSON
- [references/loop-protocol.md](references/loop-protocol.md) — batch transcript, wait, anti-patterns
- [references/triage.md](references/triage.md) — CI / review / conflict playbooks
