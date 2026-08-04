# State file schema

Path (repo-relative): `.cursor/babysit-loop/<pr-number>.json`

Create `.cursor/babysit-loop/` if needed. One file per PR so concurrent watches do not collide.

```json
{
  "version": 1,
  "status": "active",
  "pr": 111,
  "prUrl": "https://github.com/org/repo/pull/111",
  "baseRef": "main",
  "headRef": "cursor/feature-d95f",
  "round": 2,
  "maxRounds": 8,
  "pollSeconds": 180,
  "startedAt": "2026-08-04T21:00:00Z",
  "updatedAt": "2026-08-04T21:10:00Z",
  "lastHeadSha": "abc1234",
  "lastPrimaryStream": "ci",
  "lastAction": "Fixed lint in src/foo.ts; pushed abc1234",
  "lastCiConclusion": "failure",
  "signaturesSeen": [
    "ci:lint:eslint-max-warnings",
    "thread:PRRT_kwDO...:path:file.ts"
  ],
  "streams": {
    "conflicts": { "open": false },
    "ci": { "open": true, "note": "lint job failing" },
    "review": { "open": true, "unresolved": 3 }
  },
  "blocked": [],
  "bots": {
    "cursorReview": true,
    "greptile": false
  },
  "history": [
    {
      "at": "2026-08-04T21:10:00Z",
      "round": 2,
      "action": "fix",
      "detail": "Fixed lint; pushed abc1234"
    }
  ]
}
```

## Field rules

| Field | Rule |
| ----- | ---- |
| `status` | `active` \| `done` \| `blocked` \| `stopped` |
| `round` | Increment once per full tick (snapshot → act → wait/resume). |
| `maxRounds` | Default **8**. Stop with BLOCKED summary when reached. |
| `signaturesSeen` | Dedup key for CI/thread/conflict; same signature twice with no new evidence → escalate. |
| `blocked` | Human-needed items; when non-empty and no other work, `status=blocked`. |
| `history` | Append-only; keep last ~50 entries. |
| `streams.*.open` | Cache only; always re-snapshot from `gh` before acting. |

## Resume

On skill start, if state exists for the PR:

1. Load JSON.
2. Refresh live PR/CI/review/conflict signals (state is a cache, not truth).
3. Continue from `round + 1` unless the user said `fresh` / `reset`.
