# Olive MCP Server

A Model Context Protocol (MCP) server that helps AI agents query, configure,
and troubleshoot Microsoft Olive model optimization workflows.

## Status

Phase 1-4 plus Studio bridge + local feedback: registered tools (including
`diagnose_error` alias, UIState recipe bridge tools, and
`record_troubleshoot_feedback`), live external fetchers, and a versioned
knowledge base with Olive + Olive Studio domains.

- 84 passes documented in `passes.json`
- 18 hardware profiles in `hardware_profiles.json` (includes TensorRT RTX, OpenVINO NPU, DirectML, WebGPU)
- 34 Olive troubleshooting entries in `troubleshooting.json` (`domain: olive`)
- 12 Studio troubleshooting entries in `studio_troubleshooting.json` (`domain: studio`)
- Evidence-backed model entries in `compatibility_matrix.json`
- 15 integration recipes in `integration_recipes.json`
- 6 quirk categories in `quirks.json` (includes `studio`)
- pytest covers domain routing (`auto` / `olive` / `studio`), bridge tools, feedback, and Apply flags

## Setup

```bash
cd olive-mcp-server
python -m venv .venv

# Windows
.venv\Scripts\pip install -e ".[dev]" "mcp<2"

# Linux/macOS
.venv/bin/pip install -e ".[dev]" "mcp<2"
```

The package depends on `mcp>=1.0.0,<2`, `requests`, and `beautifulsoup4`.
Pin `mcp<2` — 2.x removes `mcp.server.fastmcp`.

## Run

```bash
# Module entry point (Windows)
.venv\Scripts\python -m olive_mcp_server

# Module entry point (Linux/macOS)
.venv/bin/python -m olive_mcp_server

# Console script after install (Windows)
.venv\Scripts\olive-mcp-server

# Console script after install (Linux/macOS)
.venv/bin/olive-mcp-server
```

The server uses stdio transport by default and exposes the registered tools.

For Claude Desktop, the top-level `.mcp.json` uses the cross-platform launcher:

```bash
python olive-mcp-server/run.py
```

### Studio recipe bridge precondition

`validate_ui_state_recipe` and `get_recipe_for_ui_state` call a **loopback-only**
HTTP bridge on a running Olive Studio instance. They never shell out to Olive
and never accept a caller-supplied base URL.

1. Start Olive Studio (`pnpm dev` or `pnpm start`) so
   `POST /api/mcp/studio-recipe` is listening on loopback.
2. Set **`OLIVE_STUDIO_API_URL`** to a loopback base URL only, for example:
   - `http://127.0.0.1:3000`
   - `http://localhost:3000`
   - `http://[::1]:3000`
3. Non-loopback hosts, credentials in the URL, and non-http(s) schemes are
   rejected. Missing/misconfigured URL or an unreachable Studio returns a
   structured `studio_unavailable` error within a short timeout (~5s).

Optional env for local feedback storage:

| Variable | Purpose |
| -------- | ------- |
| `OLIVE_STUDIO_API_URL` | Loopback base URL for the Studio recipe bridge (required for bridge tools) |
| `OLIVE_MCP_FEEDBACK_PATH` | Override path for the aggregate feedback JSON file (tests / advanced) |

## Test

```bash
# Windows
.venv\Scripts\python -m pytest tests -q

# Linux/macOS
.venv/bin/python -m pytest tests -q
```

## Tools

| Tool                              | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `get_olive_passes`                | List available passes, filtered by category                    |
| `get_pass_config_template`        | Generate scaffold Olive workflow JSON for a pass               |
| `get_quantization_strategy`       | Recommend a quantization approach for model + hardware         |
| `get_hardware_optimization_guide` | Return a hardware-specific optimization path                   |
| `get_pass_chain`                  | Validate and explain an ordered pass chain                     |
| `troubleshoot_olive_error`        | Diagnose Olive or Studio errors (`domain`: auto/olive/studio)  |
| `diagnose_error`                  | Alias for `troubleshoot_olive_error`                           |
| `get_error_frequency_summary`     | Return the most frequently occurring Olive errors              |
| `get_model_compatibility`         | Check Olive support for a model/framework combo                |
| `get_cli_command`                 | Generate a ready-to-run Olive CLI command                      |
| `get_data_config_template`        | Generate DataConfig JSON for calibration/evaluation            |
| `search_olive_documentation`      | Full-text search across the local knowledge base and live docs |
| `get_pass_parameters`              | Deep-dive into a pass parameter schema                         |
| `evaluate_optimization_tradeoff`  | Analyze quality vs. performance tradeoff for a pass sequence   |
| `get_integration_recipe`          | Return full Olive recipe templates or filtered summaries       |
| `validate_ui_state_recipe`        | Validate a (partial) Studio UIState via local bridge (no Olive run) |
| `get_recipe_for_ui_state`         | Same bridge evaluation plus built `olive_recipe` JSON          |
| `record_troubleshoot_feedback`    | Local aggregate thumbs feedback for a matched KB entry         |
| `get_mcp_capabilities`            | Capability state for agents (not transport/process health)     |

### Agent clients (Phases 0–1)

- **Launcher:** start via `python olive-mcp-server/run.py` (prefers project `.venv`).
- **Retrieval:** `OLIVE_MCP_RETRIEVAL_MODE=auto|keyword|semantic` (default `auto`). Cold semantic work is budgeted (`OLIVE_MCP_SEMANTIC_BUDGET_MS`, default 8000); timeout yields keyword results with `retrieval.degraded=true`.
- **Shipped indexes:** document embeddings under `knowledge_base/indexes/` (rebuild with `pnpm mcp:build-index` when KB JSON changes).
- **Warm path:** `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` loads model + indexes at process start.
- **Smoke:** from repo root, `pnpm mcp:native-smoke` and `pnpm mcp:agent-smoke` (pinned mcporter canary).
- **mcporter example:** `config/mcporter.example.json` uses the same launcher.

Optional env (in addition to Studio bridge vars above):

| Variable | Purpose |
| -------- | ------- |
| `OLIVE_MCP_RETRIEVAL_MODE` | `auto` (default), `keyword`, or `semantic` |
| `OLIVE_MCP_SEMANTIC_BUDGET_MS` | Cold semantic budget under `auto` (default 8000; 0 = unlimited) |
| `OLIVE_MCP_PRELOAD_EMBEDDINGS` | If `1`, warm model + indexes before accepting MCP traffic |
| `OLIVE_MCP_REBUILD_INDEX` | If `1`, ignore shipped indexes and re-encode at runtime |
| `OLIVE_MCP_REQUIRE_VENV` | If `1`, launcher exits when no project venv is found |

### Studio UIState bridge tools

Both tools POST `{ "uiState": <object> }` to
`${OLIVE_STUDIO_API_URL}/api/mcp/studio-recipe`. Studio merges allowed partial
fields into the same defaults as the UI, runs the TypeScript recipe pipeline
once, and returns structured validation — **no Olive process is started**.

#### `validate_ui_state_recipe`

**Input**

```json
{
  "ui_state": {
    "modelSource": "huggingface",
    "hfModelId": "microsoft/phi-2",
    "ihvProvider": "CPUExecutionProvider",
    "passes": {
      "conversion": true,
      "quantization": true,
      "quantizationMethod": "awq"
    }
  }
}
```

**Success (compact validation view)**

```json
{
  "effective_state": { "...": "sanitized UIState" },
  "schema_errors": [],
  "pipeline_issues": [{ "severity": "critical", "title": "..." }],
  "pipeline_critical_count": 1,
  "local_execution_issues": [],
  "advisories": [],
  "is_runnable": false
}
```

**Unavailable bridge**

```json
{
  "error": "studio_unavailable",
  "message": "OLIVE_STUDIO_API_URL is not set. Start Olive Studio and point OLIVE_STUDIO_API_URL at its loopback base URL (e.g. http://127.0.0.1:3000)."
}
```

#### `get_recipe_for_ui_state`

Same evaluation as `validate_ui_state_recipe`, plus:

```json
{
  "effective_state": { "...": "..." },
  "schema_errors": [],
  "pipeline_issues": [],
  "pipeline_critical_count": 0,
  "local_execution_issues": [],
  "advisories": [],
  "is_runnable": true,
  "olive_recipe": { "input_model": {}, "passes": {} },
  "conversion_warnings": []
}
```

`olive_recipe` is the exact JSON produced by Studio’s `buildRecipeFromState` for
the effective state (same as UI export), not a Python reimplementation.

### Local troubleshoot feedback

#### `record_troubleshoot_feedback`

Records **local-only, aggregate** thumbs for a troubleshooting KB
`matched_entry`. Used by Olive Studio’s diagnostic card (via
`POST /api/mcp/tool`) so future ranking can slightly prefer helpful matches.

**Input** (no logs, tracebacks, or free-form text)

```json
{
  "matched_entry": "onnxruntime-large-model-external-data",
  "rating": "thumbs-up",
  "reason_code": "accurate"
}
```

- `rating`: `thumbs-up` | `thumbs-down` only
- `reason_code` (optional): allowlisted codes only (`accurate`, `clear_fix`,
  `fixed_issue`, `wrong_match`, `outdated`, `incomplete`, `incorrect_fix`)
- Unknown `matched_entry` ids are rejected

**Success (aggregate acknowledgement)**

```json
{
  "status": "ok",
  "matched_entry": "onnxruntime-large-model-external-data",
  "rating": "thumbs-up",
  "reason_code": "accurate",
  "thumbs_up": 3,
  "thumbs_down": 1,
  "total": 4,
  "score_delta": 0.02,
  "max_score_adjustment": 0.05
}
```

**Privacy**

- Feedback is stored only on the local machine (default:
  `$XDG_DATA_HOME/olive-mcp/troubleshoot_feedback.json`, or
  `~/.local/share/olive-mcp/troubleshoot_feedback.json`; override with
  `OLIVE_MCP_FEEDBACK_PATH`).
- The store keeps **counts per entry id** (and optional reason-code tallies) —
  never error logs, stack traces, or user prose.
- Ranking influence is capped (`max_score_adjustment` = 0.05) so feedback can
  only break close ties, not override strong keyword/semantic matches.
- Nothing is uploaded to a remote service by this tool.

## Knowledge base

- `knowledge_base/passes.json` - pass catalog with parameters and gotchas
- `knowledge_base/hardware_profiles.json` - hardware target profiles
- `knowledge_base/quirks.json` - common behaviors and pitfalls (incl. `studio`)
- `knowledge_base/troubleshooting.json` - Olive runtime error diagnosis rules
- `knowledge_base/studio_troubleshooting.json` - Olive Studio / builder / UI diagnosis rules
- `knowledge_base/compatibility_matrix.json` - model compatibility matrix (evidence-backed claims)
- `knowledge_base/integration_recipes.json` - ready-to-run Olive recipe templates

### Diagnose domains

`troubleshoot_olive_error` / `diagnose_error` accept `domain`:

- `auto` (default): score Olive entries first; on miss try Studio
- `olive`: Olive runtime KB only
- `studio`: Olive Studio KB only

Responses include `domain` (`olive` | `studio` | null), `matched_entry` (stable
id or null), and `applyable` (bool). When `applyable` is false, Olive Studio
disables Apply Fix and shows guidance only. Thumbs feedback appears only when
`matched_entry` is a non-empty string.

## Fetchers and update mechanism

Live fetchers use `requests` and `BeautifulSoup` to pull fresh guidance from
external sources:

- `fetchers/official_docs_fetcher.py` - <https://microsoft.github.io/Olive/>
- `fetchers/github_scraper.py` - microsoft/Olive releases and issues
- `fetchers/onnx_runtime_fetcher.py` - ONNX Runtime execution-provider docs

Update scripts:

- `scripts/update_kb.py` - fetches all sources and writes
  `knowledge_base/update_report.json` plus `knowledge_base/candidate_quirks.json`
  (and deterministic refresh metadata)
- `scripts/expand_kb.py` - adds extra pass and hardware-profile coverage

To refresh the knowledge base **locally** (review the diff; do not auto-merge):

```bash
# Windows
.venv\Scripts\python -m scripts.update_kb
.venv\Scripts\python -m scripts.expand_kb

# Linux/macOS
.venv/bin/python -m scripts.update_kb
.venv/bin/python -m scripts.expand_kb
```

### Scheduled KB refresh PR process

GitHub Actions workflow [`.github/workflows/kb-update.yml`](../.github/workflows/kb-update.yml)
runs on a Monday schedule (and `workflow_dispatch`):

1. Install deps with `mcp<2`, run `update_kb.py` + `expand_kb.py`
2. Validate the compatibility matrix and run the full Python MCP pytest suite
3. Upload report artifacts (`update_report.json`, `candidate_quirks.json`,
   `refresh_metadata.json`) for review even when nothing changed
4. If tracked KB files differ, open or update **one** labeled PR
   (`kb-refresh` on branch `chore/kb-refresh`)
5. **Never auto-merges.** Human commits on the refresh branch block force-updates
   so manual edits are preserved

## Olive Studio integration

The main Olive Studio app (`../`) proxies MCP tool calls through
`POST /api/mcp/tool` and exposes the loopback recipe bridge at
`POST /api/mcp/studio-recipe`. `MCPDiagnosticCard` renders MCP troubleshooting
results (with optional local thumbs feedback when `matched_entry` is set). The
top-level `.mcp.json` wires this server to Claude via `olive-mcp-server/run.py`.

## Roadmap

- Add deployment docs (Docker / serverless)
- Expand compatibility matrix with more models
