# Olive MCP Server

A Model Context Protocol (MCP) server that helps AI agents query, configure,
and troubleshoot Microsoft Olive model optimization workflows.

## Status

Phase 1-3 MVP: implements all 12 spec tools with a local, versioned knowledge
base:

- 40 passes documented
- 13 hardware profiles
- 20 troubleshooting entries
- 21 unit and integration tests passing

The fetchers are stubs; wire them to requests/firecrawl for live updates.

## Setup

```bash
cd olive-mcp-server
python -m venv .venv

# Windows
.venv\Scripts\pip install -e ".[dev]"

# Linux/macOS
.venv/bin/pip install -e ".[dev]"
```

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

## Test

```bash
# Windows
.venv\Scripts\python -m pytest tests -q

# Linux/macOS
.venv/bin/python -m pytest tests -q
```

## Tools

| Tool | Purpose |
|------|---------|
| `get_olive_passes` | List available passes, filtered by category |
| `get_pass_config_template` | Generate scaffold Olive workflow JSON for a pass |
| `get_quantization_strategy` | Recommend quantization algorithm for model + hardware |
| `get_hardware_optimization_guide` | Hardware-specific pass chain and settings |
| `get_pass_chain` | Validate and explain pass ordering |
| `troubleshoot_olive_error` | Diagnose common errors with workarounds |
| `get_model_compatibility` | Check model x pass x hardware compatibility |
| `get_cli_command` | Generate ready-to-run Olive CLI commands |
| `get_data_config_template` | Generate DataConfig JSON for calibration/evaluation |
| `search_olive_documentation` | Full-text search over local knowledge base |
| `get_pass_parameters` | Deep-dive into a pass parameter schema |
| `evaluate_optimization_tradeoff` | Predict accuracy/latency/size tradeoffs |

## Knowledge Base

- `knowledge_base/passes.json` - pass catalog with parameters and gotchas
- `knowledge_base/hardware_profiles.json` - hardware target profiles
- `knowledge_base/quirks.json` - common behaviors and pitfalls
- `knowledge_base/troubleshooting.json` - error diagnosis rules
- `knowledge_base/compatibility_matrix.json` - model compatibility matrix

## Fetchers / Update Mechanism

- `fetchers/official_docs_fetcher.py` - stub for https://microsoft.github.io/Olive/
- `fetchers/github_scraper.py` - stub for microsoft/Olive releases and issues
- `fetchers/onnx_runtime_fetcher.py` - stub for ONNX Runtime EP docs
- `scripts/update_kb.py` - generates `knowledge_base/update_report.json` from stubs

To run the update stub:

```bash
.venv\Scripts\python -m scripts.update_kb
```

## Roadmap

- Wire fetchers to requests/firecrawl for live updates
- Add integration recipes JSON and tool
- Add deployment docs (Docker / serverless)
- Expand compatibility matrix with more models
