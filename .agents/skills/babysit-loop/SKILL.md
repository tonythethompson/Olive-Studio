---
name: babysit-loop
description: >
  Use when asked to babysit a PR, watch a PR until merge-ready, keep CI and review
  green over time, loop on failing checks and open review threads, or resume an
  interrupted PR watch across wakeups (/babysit-loop, /loop babysit).
---

# Babysit Loop

Owns an open PR across repeated ticks until it is merge-ready or blocked on a human
decision. Expands one-shot babysit with a durable loop: state file, round budget,
multi-stream triage (CI / review / conflicts), paced waits, and resume prompts.

**Never merges the PR.**

## When to use

- User says babysit / watch / keep the PR green / loop until clean
- After opening a PR and wanting hands-off CI + review iteration
- Resuming after a prior babysit-loop tick (`Resume:` line in chat)

**Not for:** one-shot comment summary only (`get-pr-comments`), one CI fix with no
watch (`fix-ci` / `loop-on-ci` alone), or design debates that need the user first.

## Inputs

1. PR number or URL, else open PR for the current branch (`gh pr view`).
2. Optional: max rounds (default **8**), base branch (default PR base), bots to re-trigger.

If there is no PR, stop and tell the user to open one first (do not invent shipping
scope unless they ask).

## Loop contract

```text
tick → snapshot → triage streams → act once → push if needed → wait → resume
```

Persist state after every tick (schema: [references/state-schema.md](references/state-schema.md)):

`.cursor/babysit-loop/<pr-number>.json` (create directories as needed).

Each tick must:

1. Load state (or initialize).
2. Refresh a fresh snapshot (never trust memory alone).
3. Act on **at most one primary stream** this tick (priority below).
4. Write state + end with either **DONE**, **BLOCKED**, or **RESUME** (exact resume line).

Triage playbooks: [references/triage.md](references/triage.md). Protocol notes: [references/loop-protocol.md](references/loop-protocol.md).

## Stream priority (one primary per tick)

| Priority | Stream | Act when |
| -------- | ------ | -------- |
| 1 | Merge conflicts | `mergeable == CONFLICTING` or `mergeStateStatus == DIRTY` |
| 2 | CI failures | any required/relevant check in fail bucket |
| 3 | Open review threads | GraphQL `reviewThreads` with `isResolved: false` (page all) |
| 4 | Pending CI / pending bot review | checks pending or bots still running |
| 5 | Idle / clean | all green, no open threads, mergeable |

Skip streams that are already clean. Dedup by signature so the same CI failure or
thread is not "fixed" twice without new evidence (store signatures in state).

## Tick procedure

### 1. Snapshot

```bash
gh pr view <n> --json number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,commits
gh pr checks <n> --json name,bucket,state,workflow,link
```

Page all review threads (do not stop at the first 50):

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

### 2. Conflicts (priority 1)

Merge or rebase onto the PR base (repo convention; prefer merge unless the branch
already rebases). Resolve, run the repo's quick verify (`pnpm lint` / targeted tests
as appropriate), commit, push. Record signature `conflict:<baseSha>`. Next tick
re-checks CI.

### 3. CI (priority 2)

Prefer `gh pr checks` over Actions-only lists. Classify failures per
[references/triage.md](references/triage.md) (actionable / flaky / infra / secrets).

- Pull logs (`gh run view <id> --log-failed` when GHA).
- Fix the root cause; run the local equivalent before push.
- Flake: retry the check **once**; if it fails again with the same signature, treat as real or **BLOCKED** with evidence.
- Unrelated breakages already fixed on the base: merge/rebase base instead of bloating the PR.

Delegate deep CI hunting to `loop-on-ci` / `fix-ci` patterns when helpful, but keep
loop ownership and the state file here.

### 4. Review threads (priority 3)

For each unresolved thread, triage on the merits:

| Kind | Action |
| ---- | ------ |
| Real bug / clear improvement | Fix in code matching existing patterns |
| False positive | No code change; reply with why (cite code/docs) |
| Needs product/design choice | Leave open; add to **BLOCKED** list |
| Already fixed earlier this loop | Reply pointing at the commit; resolve |

**Reply before resolve.** Never resolve silently.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies -f body="<what changed and why>"
gh api graphql -f query='mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){thread{isResolved}}
}' -f id=<threadId>
```

Batch obvious mechanical fixes into one commit per tick when safe; do not mix
unrelated refactors.

### 5. Push + re-trigger

After a fix push:

1. `git push` (never `--force` unless the user already established a rebase workflow
   and force-with-lease is required; default is no force).
2. Re-trigger review bots as **separate** comments when this repo uses them:

```bash
gh pr comment <n> --body "@cursor review"
# only if Greptile is used on the repo:
# gh pr comment <n> --body "@greptile"
```

3. Increment `round` in state. Do not re-trigger bots if the tick only waited.

### 6. Wait / resume (the loop)

Do **not** busy-sleep in a tight poll loop.

Prefer, in order:

1. **Harness wakeup** (`ScheduleWakeup` / cron / cloud follow-up) with fallback
   **180–300s** when waiting on CI or bot review.
2. **`gh pr checks <n> --watch --fail-fast`** for in-tick CI wait (bounded).
3. **Checkpoint mode:** end the turn with a copy-pasteable resume line (required if
   no wakeup tool exists).

Resume line format (always when not DONE/BLOCKED):

```text
Resume: /babysit-loop PR <n> round <r>/<max> state=.cursor/babysit-loop/<n>.json
```

On resume, read the state file first, then snapshot again.

## Stop conditions

| Result | When |
| ------ | ---- |
| **DONE** | PR open, mergeable, checks green (or only ignored/skippable failing), zero unresolved review threads |
| **BLOCKED** | Design decision needed, same signature failed **2** consecutive rounds with no new info, permissions missing, or max rounds hit |
| **RESUME** | Work remains; wait for CI/review or next wakeup |

When DONE or BLOCKED, delete or mark `"status":"stopped"` in the state file and
summarize rounds, fixes, false positives, and PR URL. **Do not merge.**

## Guardrails

- One primary stream per tick; keep commits focused.
- Never `--no-verify` to bypass hooks.
- Never "fix" tests by weakening assertions unless the behavior change is intentional and stated.
- Never resolve a thread without a reply.
- Never combine `@cursor` and `@greptile` into one comment.
- Dedup signatures across ticks (CI name+failure fingerprint; thread id).
- Cap rounds (default 8). Escalate rather than loop forever.
- Prefer repo package manager and test commands from project agent docs (`pnpm` here).

## Related skills

- `loop-on-ci` — CI-only watch/fix slice
- `get-pr-comments` — one-shot comment summary
- `fix-merge-conflicts` — conflict resolution detail
- `review-bugbot` / Bugbot subagent — explicit Bugbot pass when requested

## Details

- [references/state-schema.md](references/state-schema.md) — persisted JSON
- [references/loop-protocol.md](references/loop-protocol.md) — signatures, wakeups, anti-patterns
- [references/triage.md](references/triage.md) — CI / review / conflict playbooks
