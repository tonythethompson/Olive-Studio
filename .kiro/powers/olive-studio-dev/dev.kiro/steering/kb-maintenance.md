# Knowledge Base Maintenance

Guide for maintaining and extending the Olive MCP server's knowledge base files.

## Knowledge Base Location

All KB files live in `olive-mcp-server/olive_mcp_server/knowledge_base/`:

```
knowledge_base/
├── passes.json                 # 92 pass definitions (core catalog)
├── hardware_profiles.json      # 22 hardware profiles
├── compatibility_matrix.json   # Model x hardware x pass support
├── integration_recipes.json    # Pre-built end-to-end recipes
├── troubleshooting.json        # Error patterns with fixes
├── studio_troubleshooting.json # Studio-specific UI/bridge errors
├── quirks.json                 # Edge cases for specific configurations
├── candidate_quirks.json       # Proposed quirks awaiting validation
├── update_report.json          # Last KB update metadata
└── indexes/                    # Pre-built semantic search indexes
    ├── docs_embeddings.npy     # Documentation embedding vectors
    ├── docs_metadata.json      # Document metadata for search results
    ├── troubleshoot_embeddings.npy
    └── troubleshoot_metadata.json
```

## Adding a New Pass Entry

**File:** `passes.json`

Each pass entry follows this schema:

```json
{
  "name": "MyNewPass",
  "type": "category",
  "class": "olive.passes.my_new_pass.MyNewPass",
  "description": "One sentence describing what the pass does.",
  "input_format": "onnx",
  "output_format": "onnx",
  "parameters": {
    "param_name": {
      "type": "string",
      "default": "value",
      "description": "What this parameter controls.",
      "valid_values": ["option_a", "option_b"]
    }
  },
  "hardware_requirements": ["gpu"],
  "execution_providers": ["CUDAExecutionProvider"],
  "gotchas": [
    "Brief note about a common pitfall."
  ],
  "related_passes": ["RelatedPass1", "RelatedPass2"]
}
```

### Required fields:
- `name` — Exact Olive pass class name
- `type` — One of: `quantization`, `conversion`, `graph_optimization`, `pruning`, `finetuning`, `distillation`, `performance_tuning`
- `description` — Clear, concise (shown to agents)
- `input_format` / `output_format` — `onnx`, `pytorch`, `openvino`, `qnn`, or `any`
- `parameters` — At minimum the key user-facing parameters

### Optional but recommended:
- `hardware_requirements` — `["cpu"]`, `["gpu"]`, `["npu"]`
- `execution_providers` — Which EPs the pass supports
- `gotchas` — Common mistakes or constraints
- `related_passes` — For cross-referencing

## Adding a Hardware Profile

**File:** `hardware_profiles.json`

```json
{
  "name": "NVIDIA RTX 5090",
  "category": "nvidia",
  "description": "Consumer GPU, Blackwell architecture",
  "vram_gb": 32,
  "compute_capability": "10.0",
  "recommended_passes": ["OnnxConversion", "OrtTransformersOptimization", "OnnxQuantization"],
  "recommended_ep": "CUDAExecutionProvider",
  "quantization_methods": ["AWQ", "GPTQ", "HQQ", "RTN"],
  "max_model_params_billions": 30,
  "notes": ["Supports INT4 natively via Tensor Cores"]
}
```

### Key considerations:
- `category` determines strategy routing: `nvidia`, `amd`, `intel`, `qualcomm`, `apple`, `webgpu`, `cpu`
- `recommended_passes` should be in execution order
- `max_model_params_billions` is approximate (depends on quantization level)

## Adding a Troubleshooting Entry

**File:** `troubleshooting.json` (Olive errors) or `studio_troubleshooting.json` (Studio-specific)

```json
{
  "id": "unique-kebab-case-id",
  "pattern": "regex pattern matching the error message",
  "keywords": ["keyword1", "keyword2"],
  "category": "oom|conversion|provider|calibration|compatibility|runtime",
  "severity": "critical|warning|info",
  "title": "Human-readable title",
  "description": "Why this error occurs.",
  "root_cause": "Technical explanation of the root cause.",
  "fix": "Step-by-step resolution.",
  "recipe_patch": {
    "path.to.config.key": "new_value"
  },
  "related_entries": ["other-entry-id"],
  "frequency": 0
}
```

### Pattern guidelines:
- Use regex that matches the key error substring (not the full traceback)
- Escape special characters properly
- Test the pattern against 2-3 real examples before committing
- `keywords` enable keyword-fallback search when semantic search misses

### Recipe patch:
- Optional — only include if the fix is a deterministic config change
- Uses dot-notation paths into the recipe JSON
- The `diagnose_and_fix` tool applies these patches automatically

## Adding an Integration Recipe

**File:** `integration_recipes.json`

```json
{
  "id": "modelname_hardware_method",
  "title": "Model Name → INT4 on Hardware",
  "description": "End-to-end recipe for optimizing ModelName for TargetHW.",
  "model_type": "LLM",
  "target_hardware": ["nvidia", "cpu"],
  "source_format": "PyTorch",
  "passes": [
    {
      "name": "conversion",
      "type": "OnnxConversion",
      "config": { "use_external_data_format": true }
    },
    {
      "name": "quantization",
      "type": "OnnxQuantization",
      "config": { "weight_type": "QInt4", "calibrate_method": "MinMax" }
    }
  ],
  "expected_outcomes": {
    "size_reduction": "~75%",
    "latency_improvement": "2-3x",
    "accuracy_impact": "<2% drop"
  },
  "prerequisites": ["CUDA 12+", "16GB+ VRAM"],
  "tags": ["popular", "validated"]
}
```

### Naming convention for IDs:
- `{model}_{hardware}_{method}` — e.g., `llama3_nvidia_awq`, `resnet50_cpu_ptq`

## Adding a Quirk Entry

**File:** `quirks.json` (validated) or `candidate_quirks.json` (unvalidated)

```json
{
  "id": "quirk-kebab-id",
  "applies_to": {
    "passes": ["PassName"],
    "models": ["model-pattern*"],
    "hardware": ["category"]
  },
  "description": "What's quirky about this combination.",
  "workaround": "How to avoid the issue.",
  "verified": true,
  "added_date": "2026-08-13"
}
```

Use `candidate_quirks.json` for unverified reports. Move to `quirks.json` after validation.

## Rebuilding Semantic Search Indexes

After modifying KB files, rebuild the search indexes:

```bash
# Windows (PowerShell) — from repo root:
.\scripts\setup-mcp.ps1 -RebuildIndex

# Linux/macOS:
./scripts/setup-mcp.sh --rebuild-index

# Or manually:
cd olive-mcp-server
.venv\Scripts\python scripts/build_index.py
```

### When to rebuild:
- After adding/modifying entries in `troubleshooting.json` or `studio_troubleshooting.json`
- After significant changes to `passes.json` descriptions
- NOT needed for: `hardware_profiles.json`, `integration_recipes.json` (these use keyword search)

### Index files:
- `indexes/docs_embeddings.npy` + `docs_metadata.json` — for `search_olive_documentation`
- `indexes/troubleshoot_embeddings.npy` + `troubleshoot_metadata.json` — for `troubleshoot_olive_error`
- Uses BAAI/bge-small-en-v1.5 (~130MB model, downloaded on first build)

## Updating the Compatibility Matrix

**File:** `compatibility_matrix.json`

Structure: nested dict of `model_type → hardware → pass → support_level`

Support levels: `full`, `partial`, `experimental`, `unsupported`

```json
{
  "LLM": {
    "nvidia": {
      "AWQ": "full",
      "GPTQ": "full",
      "HQQ": "full",
      "RTN": "full",
      "SpinQuant": "experimental"
    }
  }
}
```

## Update Report

**File:** `update_report.json`

Updated automatically by the index build script. Contains:
- Last build timestamp
- Pass count, profile count, recipe count
- Index statistics (document count, embedding dimensions)

Do not edit manually — it's regenerated on each index build.

## Verification

After any KB change:

```bash
# Run all MCP tests (they validate KB integrity)
cd olive-mcp-server
.venv\Scripts\python -m pytest tests -q

# Spot-check your addition via the tool
.venv\Scripts\python -c "
from olive_mcp_server.mcp_server import call_tool
import json
result = call_tool('get_olive_passes', {'filter': 'quantization'})
print(json.dumps(result, indent=2)[:500])
"

# If troubleshooting entry added, test the pattern match
.venv\Scripts\python -c "
from olive_mcp_server.mcp_server import call_tool
result = call_tool('troubleshoot_olive_error', {'error_message': 'your test error'})
print(result.get('title', 'NO MATCH'))
"
```

## Best Practices

- Keep descriptions concise — agents have context limits
- Use consistent terminology across entries (e.g., always "ONNX Runtime" not "ORT" in user-facing text)
- Cross-reference related entries via `related_passes` / `related_entries`
- Add `gotchas` for any non-obvious behavior — these save users hours of debugging
- Test pattern regexes against real error messages before committing
- Commit KB changes and index rebuilds together (indexes are deterministic given the same model)
