# Original User Request

## Initial Request — 2026-06-04T18:07:36-07:00

Olive Studio is a React/TypeScript + Node/Express web app (Vite + Tailwind) that provides a GUI for building, validating, and exporting Microsoft Olive model optimization recipes — covering conversion, quantization, pruning, PEFT/LoRA adapters, and hardware execution provider selection. A Gemini AI sidecar provides recipe validation and assistant chat. The codebase currently contains widespread fake scaffolding: simulated progress bars, hardcoded dummy metrics, fictional batch job logs, and a "Execute Live" button that only calls `console.log`.

The task is to strip out all fake scaffolding and replace it with actual working backend logic.

Working directory: a:\Olive-Studio
Integrity mode: development (use any approach, library, or tool that works — but no fake readiness)

---

## Reference Material

- Microsoft Olive getting started: https://microsoft.github.io/Olive/getting-started/getting-started.html
- Olive pass reference: https://microsoft.github.io/Olive/reference/pass.html
- Olive how-to guides: https://microsoft.github.io/Olive/how-to/index.html
- Olive installation: https://microsoft.github.io/Olive/how-to/installation.html
- Olive features overview: https://microsoft.github.io/Olive/features/index.html

---

## Requirements

### R1. Olive Environment Setup & Real Execution Backend

Add a `/api/olive/run` POST endpoint to `server.ts` that:

- On first call (or on demand), checks whether a Python virtual environment (`venv`) exists in the project directory. If not, creates it (`python -m venv .venv`) and installs Olive (`pip install olive-ai`) before proceeding
- Accepts the generated recipe JSON from the frontend as a POST body
- Writes it to a temp file, then spawns `python -m olive run --config <tmpfile>` inside the venv
- Assigns the job a unique ID and streams stdout/stderr line-by-line back to the frontend via Server-Sent Events (SSE) on a `/api/olive/stream/:jobId` GET endpoint
- Tracks running jobs by ID (in a server-side Map) so they can be queried for status and cancelled
- Returns the actual Olive exit code to mark the job as completed or failed
- Also exposes `/api/olive/status/:jobId` GET to check job state without SSE

The venv setup step must stream its own progress to the SSE endpoint (e.g., "Creating virtual environment...", "Installing olive-ai... this may take a minute") so the frontend can show real status rather than a spinner.

If `python` or `python3` is not found on PATH at all, the endpoint must return HTTP 503 with a clear message: `"Python not found on PATH. Install Python 3.10–3.13 (3.12 recommended) to use Olive execution."`

### R2. Replace Fake Batch Job Simulator

Remove the fake `setInterval` progress simulator in `BatchProcessingPanel.tsx` (lines ~110–172) and the hardcoded initial job seeds with fabricated metrics (lines ~44–103).

Replace with:

- When "Start Queue" is clicked, call `/api/olive/run` sequentially for each queued job (using the job's configured model, provider, and passes to build the recipe JSON)
- Receive the job ID from the backend and open an SSE connection to `/api/olive/stream/:jobId`
- Append each streamed log line to `job.logs[]` in real-time
- Parse Olive's actual stdout for progress signals (e.g., lines containing `Pass`, `%`, or `Step`) to update `job.progress`; if no parseable progress, show an indeterminate spinner
- On real process exit 0, mark job `"completed"`; on non-zero exit or connection error, mark `"failed"` with the last stderr line visible
- Remove all hardcoded latency/throughput/compression metrics — only show metrics if Olive's output explicitly reports them; otherwise omit the metrics section entirely

### R3. Wire "Execute Live" Button to Real Backend

- Replace `onExecute={() => console.log("Run triggered")}` in `App.tsx` with a real handler that calls `/api/olive/run` with the current recipe JSON
- In `ExecutionWorkspace.tsx`, replace the static "Optimization Logs" card (which always shows `[INFO] Waiting for execution trigger...`) with a live SSE log stream that connects to `/api/olive/stream/:jobId` once a job is started
- Show a real running indicator (spinner + "Olive running..." label) while the process is active
- On completion, show exit code and final log lines; on failure, show error summary
- The Execute Live button should be disabled while a job is already running

### R4. Fix Gemini Model Name

In `server.ts`, replace all three occurrences of `"gemini-3.5-flash"` (which is not a real model name) with `"gemini-2.0-flash"`. Apply this fix to the `/api/gemini/validate`, `/api/gemini/analyze-state`, and `/api/gemini/chat` endpoints.

### R5. Real File Chunk Reconstruction

Replace the fake `setInterval` in `InputEnvironmentPanel.tsx`'s `startReconstruction()` function (lines ~363–416) with actual in-browser binary file assembly:

- The user has already selected the chunk files via the file input; use the actual `File` objects (stored in a ref alongside the `{name, size}` metadata currently in state)
- Sort chunks by their numeric suffix (`.001`, `.002`, etc.)
- Read each chunk as an `ArrayBuffer` using `FileReader` or `file.arrayBuffer()`
- Concatenate into a single `Blob` and create a real download URL via `URL.createObjectURL()`
- Update progress based on actual bytes read vs total bytes
- Add a download button for the assembled file so the user can actually retrieve it
- Remove the fake `generateFileHash` simulation; if a checksum is desired, compute a real SHA-256 using the Web Crypto API (`crypto.subtle.digest`)

### R6. Fix EnterpriseInfraPanel Distributed Caching Switch

- Add a `distributedCaching: boolean` field to the `UIState` type in `types.ts` (default `false`)
- Wire the `<Switch defaultChecked />` in `EnterpriseInfraPanel.tsx` to read from and write to `state.distributedCaching`
- In `ExecutionWorkspace.tsx`, update the recipe JSON builder so that when `state.distributedCaching` is `true` and `state.azureStr` is non-empty, the `engine.cache_dir` in the generated recipe is set to the Azure connection path; otherwise use the local `state.cacheDir`

### R7. Remove or Replace PerformanceMetrics Placeholder

Inspect `PerformanceMetrics.tsx`. If it displays static/hardcoded chart data:

- Either remove it entirely from `ExecutionWorkspace.tsx`, or
- Replace its data source with real metrics parsed from the most recently completed Olive job's log output
- Do not leave fabricated chart data rendering as though it represents real optimization results

---

## Acceptance Criteria

### R1 — Olive Backend

- [ ] `POST /api/olive/run` endpoint exists in `server.ts`
- [ ] If Python is not on PATH, the endpoint returns HTTP 503 with a Python-not-found message (testable by temporarily renaming python)
- [ ] If `.venv` does not exist, hitting the endpoint creates it and installs olive-ai (observable via filesystem and pip list)
- [ ] Venv setup progress streams through SSE (check network tab for `text/event-stream` response)
- [ ] `GET /api/olive/stream/:jobId` returns a `text/event-stream` content-type response
- [ ] No simulated sleep/delay is used anywhere in the execution path

### R2 — Batch Processing

- [ ] The `setInterval` fake loop is completely removed from `BatchProcessingPanel.tsx`
- [ ] The hardcoded initial job seeds (`job-1`, `job-2`, `job-3`) with fabricated metrics are removed
- [ ] Clicking "Start Queue" produces a network request to `/api/olive/run` (visible in browser DevTools Network tab)
- [ ] Job logs in the UI contain real Olive CLI output lines (or real setup/error lines), not hardcoded strings
- [ ] No hardcoded metrics values (e.g., `"14.2 ms"`, `"70.4 tok/s"`) remain anywhere in the batch panel

### R3 — Execute Live

- [ ] The `console.log("Run triggered")` noop is removed from `App.tsx`
- [ ] Clicking "Execute Live" triggers a real POST to `/api/olive/run`
- [ ] The Optimization Logs section in `ExecutionWorkspace.tsx` updates in real-time with streamed output
- [ ] The button is disabled while a job is running

### R4 — Gemini Model Name

- [ ] `grep -r "gemini-3.5-flash" server.ts` returns no results
- [ ] Gemini API calls succeed without model-not-found errors (requires GEMINI_API_KEY to be set)

### R5 — File Reconstruction

- [ ] The fake `setInterval` in `startReconstruction` is removed
- [ ] Uploading two chunk files (e.g., `model.bin.001` and `model.bin.002`) and clicking reconstruct produces a real download
- [ ] Progress reflects actual bytes read
- [ ] The fake `generateFileHash` simulation is removed; if a hash is shown it is computed via Web Crypto

### R6 — Caching Switch

- [ ] `UIState` in `types.ts` has a `distributedCaching` boolean field
- [ ] The switch in `EnterpriseInfraPanel.tsx` is controlled (reads/writes `state.distributedCaching`)
- [ ] The generated recipe JSON in `ExecutionWorkspace.tsx` reflects the switch state in `engine.cache_dir`

### R7 — PerformanceMetrics

- [ ] No hardcoded/static chart values remain in `PerformanceMetrics.tsx`
- [ ] Either the component is removed, or it only displays data from real completed job output
