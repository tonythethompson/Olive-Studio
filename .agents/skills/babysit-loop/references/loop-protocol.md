# Babysit Loop Protocol

Canonical state schema: [state-schema.md](state-schema.md).  
Triage details: [triage.md](triage.md).

## Loop shape

```text
tick → snapshot → pick one primary stream → act → push if needed → wait → RESUME|DONE|BLOCKED
```

Never busy-poll with short `sleep` loops. Prefer harness wakeup, `gh pr checks --watch --fail-fast`, or a checkpoint `Resume:` line.

## Signature guidance

- CI: `ci:<checkName>:<first-error-token>` (stable substring from log, not full log)
- Thread: `thread:<graphqlThreadId>`
- Conflict: `conflict:<baseOid>`

If a signature is in `signaturesSeen` and reappears with no new log/thread body,
count toward the "same signature twice → BLOCKED" rule.

## Tick transcript (minimal)

```text
Babysit-loop PR #111 — round 3/8
Primary: review threads (2 open)
- Fixed DirectML probe gating (thread PRRT_…)
- Replied false positive on pin comment (thread PRRT_…)
Pushed: 0e54e10
Re-triggered: @cursor review
Resume: /babysit-loop PR 111 round 4/8 state=.cursor/babysit-loop/111.json
```

## Clean checklist

- [ ] `gh pr checks` — no fail bucket (or only explicitly ignored)
- [ ] All `reviewThreads` pages — `isResolved: true`
- [ ] `mergeable` is `MERGEABLE` (not CONFLICTING)
- [ ] No unanswered human design questions in `blocked`

## Wakeup vs checkpoint

| Harness | Wait strategy |
| ------- | ------------- |
| ScheduleWakeup / cron available | Schedule 180–300s; pass same resume prompt |
| `gh` available, long tick OK | `gh pr checks --watch --fail-fast` then continue |
| No background wake | Checkpoint: end turn with `Resume:` line only |

## Anti-patterns

- Polling `sleep 5` in a shell for tens of minutes
- Fixing CI and review and conflicts in one giant unfocused commit
- Resolving threads without replies
- Declaring clean from a single page of threads when `hasNextPage` is true
- Force-pushing shared branches by default
- Merging the PR from this skill
