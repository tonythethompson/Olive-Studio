---
name: setup
description: Set up the Olive Studio development environment. Use when onboarding, initializing the project, or troubleshooting environment issues.
---

# Set Up Olive Studio Development Environment

## Prerequisites

- **Node.js** >= 22.16
- **pnpm** 11.17 (package manager — `npm install` is blocked)
- **Python** >= 3.10 (for MCP server)
- **Git**

## Step 1: Install Dependencies

```bash
pnpm install
```

Never use `npm install` — a preinstall guard will block it with an error.

## Step 2: Start Dev Server

```bash
pnpm dev
```

Opens Express + Vite on http://localhost:3000 with HMR.

## Step 3: Set Up MCP Server (Optional)

The Python MCP server provides 27 tools for pass catalog, validation, and troubleshooting. The web app runs fine without it.

```bash
cd olive-mcp-server
python -m venv .venv

# Windows:
.venv\Scripts\pip install -e ".[dev]" "mcp<2"

# Linux/macOS:
.venv/bin/pip install -e ".[dev]" "mcp<2"
```

**Critical:** Pin `mcp<2` — version 2.x removes `mcp.server.fastmcp` and breaks all imports.

Verify:
```bash
# Windows:
.venv\Scripts\python -m pytest tests -q

# Linux/macOS:
.venv/bin/python -m pytest tests -q
```

## Step 4: Configure Kiro MCP (Optional)

Create `.kiro/settings/mcp.json` manually (cannot be written by agents):

```json
{
  "mcpServers": {
    "olive-mcp": {
      "type": "stdio",
      "command": "python",
      "args": ["olive-mcp-server/run.py"],
      "env": {
        "OLIVE_MCP_RETRIEVAL_MODE": "auto",
        "OLIVE_STUDIO_API_URL": "http://127.0.0.1:3000",
        "PYTHONPATH": "olive-mcp-server"
      }
    }
  }
}
```

## Step 5: Verify the Setup

```bash
pnpm lint:quick          # Fast lint (oxlint)
pnpm validate:recipe     # Recipe builder smoke test
pnpm test                # Unit tests (src/lib/)
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OLIVE_BIND` | Server bind address (default: `127.0.0.1`) |
| `SYNC_KB_TOKEN` | Token for KB sync endpoint |
| `OLIVE_ARENA_ALLOW_REMOTE` | Allow remote Arena inference (Docker setups) |
| `DISABLE_HMR` | Disable Vite HMR (for stability during Olive runs) |
| `ANALYZE` | Set to `1` for bundle visualization on build |

## Common Issues

- **Port 3000 in use:** Kill the existing process or set `PORT` env var
- **Python not found:** Ensure `python` (not just `python3`) is on PATH
- **pnpm not found:** Install via `corepack enable` (Node 22+ includes corepack)
- **WSL slow tests:** Don't run full suites locally — push and let CI verify
