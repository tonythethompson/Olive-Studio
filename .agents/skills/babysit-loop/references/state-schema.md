# State file schema

## Session (required)

Path: `.cursor/babysit-loop/session.json`

Created after intake. One active session at a time unless the user starts a
fresh run (`fresh` / `reset`).

```json
{
  "version": 1,
  "status": "active",
  "prs": [111, 113],
  "wait": {
    "raw": "5 minutes",
    "seconds": 300
  },
  "batch": 2,
  "batchPosition": 0,
  "startedAt": "2026-08-05T00:00:00Z",
  "updatedAt": "2026-08-05T00:20:00Z",
  "lastBatchFinishedAt": "2026-08-05T00:18:00Z",
  "blocked": [
    {
      "pr": 113,
      "reason": "Needs product decision on API shape (thread PRRT_…)"
    }
  ],
  "history": [
    {
      "at": "2026-08-05T00:18:00Z",
      "batch": 2,
      "action": "batch-complete",
      "detail": "111 clean; 113 CI still pending after push"
    }
  ]
}
```

| Field | Rule |
| ----- | ---- |
| `status` | `active` \| `waiting` \| `done` \| `blocked` \| `stopped` |
| `prs` | Ordered list from intake; process consecutively each batch. |
| `wait.seconds` | Full interval between batches. No default unless user asks for one (then 300). |
| `batch` | Increment after each completed pass over all PRs (before wait). |
| `batchPosition` | Index into `prs` for mid-batch resume (0-based). |
| `blocked` | Human-needed items; session may stay active if other PRs still actionable. |
| `history` | Append-only; keep last ~50 entries. |

## Per-PR cache (optional)

Path: `.cursor/babysit-loop/<pr-number>.json`

```json
{
  "version": 1,
  "pr": 111,
  "prUrl": "https://github.com/org/repo/pull/111",
  "baseRef": "main",
  "headRef": "cursor/feature-d95f",
  "lastHeadSha": "abc1234",
  "lastPrimaryStream": "ci",
  "lastAction": "Fixed lint; pushed abc1234",
  "lastCiConclusion": "success",
  "signaturesSeen": [
    "ci:lint:eslint-max-warnings",
    "thread:PRRT_kwDO..."
  ],
  "streams": {
    "reviews": { "open": false, "unresolved": 0 },
    "conflicts": { "open": false },
    "ci": { "open": false }
  },
  "clean": true
}
```

Per-PR files are caches. Always re-snapshot with `gh` before acting.

## Resume

1. Load `session.json` (required).
2. Load per-PR caches if present.
3. Refresh live PR/CI/review/conflict signals.
4. If `status` is `waiting` and the interval has elapsed, set `status` to
   `active`, increment `batch`, set `batchPosition` to `0`, continue.
5. `fresh` / `reset` in the prompt: archive or delete state and re-run intake.
