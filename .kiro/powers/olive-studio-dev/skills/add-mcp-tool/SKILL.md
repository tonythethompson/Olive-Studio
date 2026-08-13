---
name: add-mcp-tool
description: Add a new tool to the Olive MCP server. Use when implementing a new MCP tool, exposing a new knowledge-base query, or adding a new agent-facing capability to the Python MCP server.
---

# Add a New MCP Tool

Complete checklist for adding a new tool to the Olive MCP server. All steps are required.

## Step 1: Create Tool Module

**Directory:** `olive-mcp-server/olive_mcp_server/tools/`

Create `my_tool.py`:

```python
"""My new tool — brief description."""

from __future__ import annotations


def my_new_tool(param: str, optional_param: str = "default") -> dict:
    """One-sentence tool description for the MCP tool catalog.

    Args:
        param: Description of required parameter.
        optional_param: Description with default noted.

    Returns:
        A dict with the tool's structured response.
    """
    # Implementation here
    return {"result": "value"}
```

### Conventions:
- One tool per function (or closely related tools in one module)
- Use type annotations for all parameters — FastMCP derives the JSON schema from them
- Docstring is the tool description shown to agents (first line) and parameter docs (Args section)
- Return `dict` — JSON-serializable
- Return `{"error": "message"}` on failures (don't raise)
- Keep imports minimal at module level — heavy deps use lazy `importlib` inside the function

## Step 2: Register in Tool Imports

**File:** `olive-mcp-server/olive_mcp_server/mcp_server.py` → `_TOOL_IMPORTS`

Add an entry mapping the tool name to its module and function:

```python
_TOOL_IMPORTS: dict[str, tuple[str, str]] = {
    # ... existing entries ...
    "my_new_tool": ("olive_mcp_server.tools.my_tool", "my_new_tool"),
}
```

The tool is lazy-imported at first invocation — startup cost is zero.

## Step 3: Add to Node-Side Allowlist

**File:** `src/server/services/mcp/allowedTools.ts` → `ALLOWED_MCP_TOOL_NAMES`

Add the tool name string to the Set:

```typescript
export const ALLOWED_MCP_TOOL_NAMES = new Set([
  // ... existing entries ...
  "my_new_tool",
]);
```

Without this, the Express MCP proxy (`POST /api/mcp/tool`) will reject calls to the tool.

### Placement guidelines:
- Read-only tools: add in the main block
- Write/mutation tools: add after the `// Write-capable` comment with a note
- Studio bridge tools: add after the `// Phase 2–3` comment
- Agent loop tools: add after the `// Phase 3` comment

## Step 4: Add Tests

**Directory:** `olive-mcp-server/tests/`

Create `test_my_tool.py`:

```python
"""Tests for my_new_tool."""

import pytest
from olive_mcp_server.tools.my_tool import my_new_tool


def test_basic_usage():
    result = my_new_tool(param="test_value")
    assert "result" in result
    assert result["result"] == "expected"


def test_error_handling():
    result = my_new_tool(param="")
    assert "error" in result


def test_optional_param():
    result = my_new_tool(param="test", optional_param="custom")
    assert result["result"] == "custom_expected"
```

### Test rules:
- Never make network calls — mock external services
- Never trigger actual Olive optimization
- Test the happy path, error cases, and edge cases
- Use fixtures for shared KB data access

## Step 5: Access Knowledge Base (If Needed)

If the tool queries KB data:

```python
import json
from pathlib import Path

_KB_DIR = Path(__file__).resolve().parent.parent / "knowledge_base"

def _load_kb(filename: str) -> dict:
    """Load a knowledge base JSON file."""
    with open(_KB_DIR / filename) as f:
        return json.load(f)
```

Available KB files:
| File | Content |
|------|---------|
| `passes.json` | 92 pass definitions |
| `hardware_profiles.json` | 22 hardware profiles |
| `compatibility_matrix.json` | Model x hardware x pass support |
| `integration_recipes.json` | Pre-built recipes |
| `troubleshooting.json` | Error patterns with fixes |
| `studio_troubleshooting.json` | Studio-specific errors |
| `quirks.json` | Edge cases |

## Step 6: Use Semantic Search (If Needed)

For tools that search the KB semantically:

```python
from olive_mcp_server.tools.retrieval import search_kb

def my_search_tool(query: str, top_k: int = 5) -> dict:
    results = search_kb(query, top_k=top_k, mode="auto")
    return {"results": results, "count": len(results)}
```

The `retrieval.py` module handles keyword/semantic/auto mode selection and index loading.

## Step 7: Studio Loopback (If Needed)

For tools that call back to the Olive Studio Express server:

```python
from olive_mcp_server.tools.studio_loopback import studio_request

def my_studio_tool(data: dict) -> dict:
    """Tool that requires Studio to be running."""
    resp = studio_request("POST", "/api/olive/some-endpoint", json=data)
    if resp is None:
        return {"error": "studio_unavailable", "message": "Olive Studio not running"}
    return resp
```

The `studio_loopback.py` module handles `OLIVE_STUDIO_API_URL` detection and HTTP calls.

## Step 8: Update Documentation

1. **Tool reference:** Update `.kiro/powers/olive-mcp-tools/dev.kiro/steering/tool-reference.md` with the new tool in the appropriate table.
2. **Relevant skill:** If the tool fits an existing skill (discover, optimize, troubleshoot, validate), add usage examples there.
3. **KB passes.json:** If the tool relates to a new pass capability, update the KB entry.

## Verification

```bash
# Run Python tests
cd olive-mcp-server
.venv\Scripts\python -m pytest tests/test_my_tool.py -v

# Verify tool registers correctly
.venv\Scripts\python -c "from olive_mcp_server.mcp_server import call_tool; print(call_tool('my_new_tool', {'param': 'test'}))"

# Quick lint on the TypeScript side
pnpm lint:quick
```

## Common Patterns

### Tool that wraps KB lookup with filtering
See: `pass_catalog.py`, `integration_recipes.py`

### Tool that provides strategy/recommendation
See: `strategy_advisor.py`, `hardware_guide.py`

### Tool that bridges to Studio HTTP
See: `studio_jobs.py`, `studio_recipe.py`

### Tool that uses semantic search
See: `docs_search.py`, `troubleshooting.py`

### Tool that serves the agent autonomous loop
See: `agent_planner.py`, `agent_execute.py`, `agent_diagnosis.py`

## Important Rules

- Tool names must be **snake_case** and match in all three locations (Python function, `_TOOL_IMPORTS` key, `allowedTools.ts`)
- Never import heavy libraries at module level — use lazy imports inside the function
- Tools that have **side effects** (job submission, cancellation) must document this in the docstring
- The `mcp` package must be pinned `<2` — version 2.x breaks FastMCP
- Studio loopback tools should gracefully return `studio_unavailable` when the Studio API is unreachable
- Tool responses are capped at 8MB — paginate or truncate large outputs
