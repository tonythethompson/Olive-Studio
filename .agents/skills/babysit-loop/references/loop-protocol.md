# Babysit Loop Protocol

Canonical state schema: [state-schema.md](state-schema.md).  
Triage details: [triage.md](triage.md).

## Loop shape

```text
intake (PRs + wait) →
  batch:
    for each PR:
      reviews → conflicts → CI green
  → wait <interval> → next batch
```

Wait once per batch, after every listed PR has been handled. Do not wait between
PRs inside the same batch.

## Signature guidance

- CI: `ci:<checkName>:<first-error-token>`
- Thread: `thread:<graphqlThreadId>`
- Conflict: `conflict:<baseOid>`

Same signature twice with no new log/thread body → escalate toward BLOCKED for
that PR (other PRs still continue).

## Batch transcript (minimal)

```text
Babysit-loop batch 2 — PRs 111, 113 — wait 5m

PR #111
- Reviews: replied skip on style nit (thread PRRT_…); resolved
- Conflicts: none
- CI: green

PR #113
- Reviews: fixed OpenVINO gate (thread PRRT_…); pushed 0e54e10
- Conflicts: none
- CI: lint fixed; watching checks

Batch complete. Waiting 5 minutes.
Resume: /babysit-loop PRs 111,113 batch 3 wait 5m state=.cursor/babysit-loop/session.json
```

## Clean checklist (per PR)

- [ ] All `reviewThreads` pages — every thread resolved **or** has an intentional-skip reply and is resolved when appropriate
- [ ] `mergeable` is `MERGEABLE` (not CONFLICTING)
- [ ] `gh pr checks` — no fail bucket on latest head (or only explicitly ignored)
- [ ] No unanswered human design questions left without a thread reply

## Session DONE checklist

- [ ] Every PR in `session.prs` meets the per-PR clean checklist
- [ ] `blocked` is empty (or only items the user accepted as out of scope)

## Wait strategies

| Harness | After a batch |
| ------- | ------------- |
| ScheduleWakeup / cron / follow-up | Schedule `wait.seconds`; pass resume line |
| Long block allowed | `sleep <wait.seconds>` then continue same turn |
| No background wake | Checkpoint with resume line including wait duration |

## Anti-patterns

- Guessing PRs or wait interval when the user did not provide them
- Waiting between PRs inside one batch instead of after the full list
- Busy-polling with short `sleep` loops instead of one full-interval wait
- Skipping a review thread without a reply
- Resolving threads without replies
- Declaring clean from a single page of threads when `hasNextPage` is true
- Force-pushing shared branches by default
- Merging any PR from this skill
