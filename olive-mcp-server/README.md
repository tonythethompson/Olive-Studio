# Olive MCP Server

A Model Context Protocol (MCP) server that helps AI agents query, configure,
and troubleshoot Microsoft Olive model optimization workflows.

## Status

Phase 1-4: 14 registered tools, live external fetchers, and an expanded,
versioned knowledge base.

- 84 passes documented in `passes.json`
- 14 hardware profiles in `hardware_profiles.json`
- 20 troubleshooting entries in `troubleshooting.json`
- 20 model entries in `compatibility_matrix.json`
- 10 integration recipes in `integration_recipes.json`
- 3 quirk categories in `quirks.json`
- 130 pytest tests passing

## Setup

```bash
cd olive-mcp-server
python -m venv .venv

# Windows
.venv\Scripts\pip install -e ".[dev]"

# Linux/macOS
.venv/bin/pip install -e ".[dev]"
```

The package depends on `mcp>=1.0.0`, `requests`, and `beautifulsoup4`.

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
| `troubleshoot_olive_error`        | Diagnose a common Olive error with workarounds                 |
| `get_error_frequency_summary`     | Return the most frequently occurring Olive errors              |
| `get_model_compatibility`         | Check Olive support for a model/framework combo                |
| `get_cli_command`                 | Generate a ready-to-run Olive CLI command                      |
| `get_data_config_template`        | Generate DataConfig JSON for calibration/evaluation            |
| `search_olive_documentation`      | Full-text search across the local knowledge base and live docs |
| `get_pass_parameters`             | Deep-dive into a pass parameter schema                         |
| `evaluate_optimization_tradeoff`  | Analyze quality vs. performance tradeoff for a pass sequence   |
| `get_integration_recipe`          | Return full Olive recipe templates or filtered summaries       |

## Knowledge base

- `knowledge_base/passes.json` - pass catalog with parameters and gotchas
- `knowledge_base/hardware_profiles.json` - hardware target profiles
- `knowledge_base/quirks.json` - common behaviors and pitfalls
- `knowledge_base/troubleshooting.json` - error diagnosis rules
- `knowledge_base/compatibility_matrix.json` - model compatibility matrix
- `knowledge_base/integration_recipes.json` - ready-to-run Olive recipe templates

## Fetchers and update mechanism

Live fetchers use `requests` and `BeautifulSoup` to pull fresh guidance from
external sources:

- `fetchers/official_docs_fetcher.py` - <https://microsoft.github.io/Olive/>
- `fetchers/github_scraper.py` - microsoft/Olive releases and issues
- `fetchers/onnx_runtime_fetcher.py` - ONNX Runtime execution-provider docs

Update scripts:

- `scripts/update_kb.py` - fetches all sources and writes
  `knowledge_base/update_report.json` plus `knowledge_base/candidate_quirks.json`
- `scripts/expand_kb.py` - adds extra pass and hardware-profile coverage

To refresh the knowledge base:

```bash
# Windows
.venv\Scripts\python -m scripts.update_kb
.venv\Scripts\python -m scripts.expand_kb

# Linux/macOS
.venv/bin/python -m scripts.update_kb
.venv/bin/python -m scripts.expand_kb
```

## Olive Studio integration

The main Olive Studio app (`../`) proxies MCP tool calls through
`POST /api/mcp/tool` and renders MCP diagnostics with `MCPDiagnosticCard`. The
top-level `.mcp.json` wires this server to Claude via `olive-mcp-server/run.py`.

## Roadmap

- Add deployment docs (Docker / serverless)
- Expand compatibility matrix with more models
