# Olive Studio — Troubleshooting Guide

## Python / MCP Issues

### `mcp` pip version conflict

**Symptom:** Import errors mentioning `mcp.server.fastmcp` not found.

**Cause:** `mcp` v2.x removed the `mcp.server.fastmcp` module.

**Fix:** Always install with the version pin:
```bash
cd olive-mcp-server
pip install -e ".[dev]" "mcp<2"
```

### MCP server returns "unavailable" (503)

**Symptom:** `/api/mcp/tool` returns `{ available: false, error: "MCP server unavailable" }`.

**Cause:** Circuit breaker tripped after 3 consecutive failures. Common reasons:
- No `.venv` exists in `olive-mcp-server/`
- Python not on PATH
- Missing dependencies

**Fix:**
1. Create the venv: `cd olive-mcp-server && python -m venv .venv`
2. Install: `.venv\Scripts\pip install -e ".[dev]" "mcp<2"` (Windows) or `.venv/bin/pip install -e ".[dev]" "mcp<2"` (Unix)
3. Wait 30 seconds for the breaker to reset, or restart the dev server

### Python "command not found" in a11y:scan

**Symptom:** `pnpm a11y:scan` fails with "python: command not found".

**Cause:** The script invokes `python` (not `python3`).

**Fix:** Ensure `python` is on PATH. On systems with only `python3`, create an alias or symlink.

## Testing Issues

### Tests timing out on WSL

**Symptom:** `pnpm test:integration` or full suites hang for 10+ minutes.

**Cause:** WSL file system operations on NTFS-mounted drives are extremely slow.

**Fix:** Don't run full suites locally. Push the branch and let GitHub Actions CI run them. For local dev:
```bash
vitest run src/lib/specificFile.test.ts
```

### Integration test setup fails

**Symptom:** Integration tests fail at setup with mock errors.

**Cause:** `src/server/__tests__/setup.integration.ts` mocks child_process, AI providers, and fetch. If mocking fails, check for:
- New unmocked imports in route files
- Changed module paths

**Fix:** Update the setup file to mock new external dependencies.

## Vite / HMR Issues

### Vite crashes during Olive optimization run

**Symptom:** Dev server restarts or HMR errors while a job is running.

**Cause:** Olive/pip writes to `.venv/` and `models/` during optimization. File watchers pick up these changes.

**Fix:** The watchlist already ignores these paths. If still crashing:
- Set `DISABLE_HMR=true` environment variable
- Or restart the dev server after the job completes

### "Failed to fetch" in Tauri WebView

**Symptom:** All imports show "Failed to fetch" when opening via Tauri.

**Cause:** Vite hasn't finished pre-bundling when the WebView opens.

**Fix:** `server.ts` already calls `vite.warmupRequest()` for critical entry points. If adding new critical imports, add them to the warmup list in `server.ts`.

## Build Issues

### ESLint max-warnings exceeded

**Symptom:** `pnpm lint` exits non-zero with "Too many warnings".

**Cause:** More than 20 ESLint warnings in `src/` + `server.ts`.

**Fix:** The threshold is `--max-warnings 20`. Fix warnings until count is ≤ 20. Current known suppressions are 6 `react-hooks/set-state-in-effect` comments — those are intentional.

### Production build missing `dist/server.mjs`

**Symptom:** `pnpm start` fails with "Production build not found".

**Fix:** Run `pnpm build` first. The build step is: `vite build` (frontend) + `esbuild server.ts` (server bundle).

## Hardware / Provider Issues

### Hardware probe returns empty

**Symptom:** No GPUs or providers detected in the IHV panel.

**Cause:** Probing requires system tools (`nvidia-smi`, `rocm-smi`, etc.) and a working Python venv with ONNX Runtime installed.

**Fix:**
1. Install the venv: use the "Install" button in the Runtime Environment controls
2. Ensure GPU drivers are installed (NVIDIA, Intel, AMD as appropriate)
3. Click "Re-probe" in the hardware panel

### "Unsupported CUDA tag" error at recipe-build time

**Symptom:** Recipe validation shows "unsupported CUDA tag" for cu130/cu132.

**Cause:** These CUDA versions don't have pinned PyTorch/ORT package resolutions yet.

**Fix:** Use `cu128` or lower. Check `RESOLVABLE_CUDA_TAGS` in `src/lib/oliveGpuRuntime.ts` for supported tags.
