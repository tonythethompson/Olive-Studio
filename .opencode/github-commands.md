# `/oc` GitHub PR commands

These instructions apply when a user message is posted on a GitHub PR via the opencode
GitHub Action and begins with `/oc` (or `/opencode`). The message usually carries a
`<pull_request>` context block (title, body, changed files, comments, reviews) — read it
carefully before answering.

## `/oc review`

When a user message is exactly `/oc review` or begins with `/oc review`, treat it as a
request to review the current pull request. Extra text after the shortcut, e.g.
`/oc review focus on security`, scopes the review to those concerns.

### Posting behavior

**One comment per actionable finding.** Do NOT write one big review. Instead:

1. Identify the actionable findings. An actionable finding is one where you can point at a
   concrete problem in the code and, when feasible, propose a specific change.
2. Post each actionable finding as its **own comment** on the PR via the `gh` CLI
   (preinstalled in GitHub Actions; the `GITHUB_TOKEN` env var is available, no login needed):

   ```bash
   gh api repos/{owner}/{repo}/issues/{pr_number}/comments -F body=@finding.md
   ```

   Derive `owner`/`repo` from `baseRepository.nameWithOwner` in the `<pull_request>`
   context (split on `/`), and `pr_number` from `Number:`. Write the finding body to a
   temp file (`finding.md`) rather than passing a giant `-f body=` string, so multiline
   Markdown and code blocks survive intact. Post comments one at a time and keep a list of
   the posted comment IDs/URLs. If a `gh` call fails, do not stop the review — fall back to
   including that finding in the final summary comment instead.
3. **Your final reply text** (what the action posts as the single reply comment) must be a
   **short summary index**: overall assessment, plus one line per posted finding with its
   file:line, severity, and a link to that finding's comment (`gh api .../issues/{n}/comments`
   responses include the `html_url`). Keep it tight — the detail lives in the per-finding
   comments.
4. Group low-severity nits and non-actionable observations into the final summary comment
   instead of posting more comments.

### Committing behavior — suggestions only

You are reviewing, not editing:

- **Do NOT modify any files and do NOT leave the working tree dirty.** The action auto-commits
  and pushes any uncommitted changes to the PR branch — that is not wanted here.
- Include a **committable suggestion** in each finding comment when it is feasible to write
  one for that specific finding: a concrete diff (lines with `+`/`-`) or exact replacement
  snippet the author can apply. If a finding does not have a cut-and-dried fix, say so and
  describe the change needed instead of inventing code.

### Finding comment format

Each finding comment should contain:

1. **Severity** — `high` / `medium` / `low` (or `critical`).
2. **Location** — `file:line` (or a line range).
3. **Problem** — why it is wrong, grounded in the actual code.
4. **Suggested fix** — a committable diff or snippet when feasible.

### Review scope

Look for: correctness bugs, security issues (injection, secret handling, authorization),
performance, maintainability, and test coverage gaps. Ground every finding in the actual diff
and files. Do not invent issues; verify against the code. If there are no actionable findings,
just say so in the summary comment and do not post finding comments.

## `/oc fix`

When a user message is exactly `/oc fix` or begins with `/oc fix`, fix the review feedback on
the current pull request.

### Behavior

1. **Collect all review feedback** from the `<pull_request>` context:
   - inline review comments (inside `<pull_request_reviews>` → comments)
   - timeline comments (`<pull_request_comments>`)
   - review bodies (`<pull_request_reviews>`)
2. **For each comment, judge whether it is valid and actionable** against the current code:
   - **Valid and fixable** → implement the fix by editing files in the working tree. The
     GitHub Action auto-commits and pushes any uncommitted changes to the PR branch; you do
     not need to `git commit`/`git push` yourself (though committing yourself is also fine —
     the action detects it and pushes).
   - **Not valid, not fixable, or already handled** → do not change code for it.
   - **Not an inline-resolvable thread but still contains real feedback to address** (e.g. a
     timeline comment or a general review-body request) → address it with a commit too when
     the feedback is valid, and record it in the summary.
3. **Resolve addressed review threads.** A review thread (inline review comment chain) is
   resolvable; timeline comments are not. Use `gh`:

   ```bash
   # 1. List threads and their comment databaseIds
   gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:10){nodes{databaseId}}}}}}}' -F owner=... -F repo=... -F number=...

   # 2. Resolve a thread whose comments you fully addressed
   gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -F id=THREAD_ID
   ```

   Only resolve threads you actually addressed. Leave open any thread you could not fully
   address, and say why in the summary.
4. **Your final reply text IS the single summary comment** (the action posts it). Do NOT post
   extra per-finding comments. The summary must cover **everything**:
   - **Fixed** — for each addressed item: the change made (file:line) and whether its thread
     was resolved.
   - **Not fixed** — for each comment you skipped: a brief reason (invalid, already handled,
     duplicate, out of scope, not fixable).
   - **Addressed non-thread feedback** — any feedback that wasn't an inline thread but still
     warranted a code change: list the change made.
   - A short overall assessment of remaining risk.

### Fixing behavior notes

- Ground every judgment in the actual diff and files. Verify a comment is still valid against
  the current code before acting on it.
- Keep fixes minimal and targeted to the feedback. Do not refactor unrelated code.
- Do not resolve threads you did not address. Do not modify files for invalid or duplicate
  feedback.
