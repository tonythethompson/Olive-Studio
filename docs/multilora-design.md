# Multi-LoRA Adapter Support — Design Document

**Status:** BLOCKED by upstream (requires Olive >= 0.3.0 multi-adapter pass configuration)
**Target:** v0.4.0+
**Feature Flag:** `multiLora` (default: off)

## Overview

Multi-LoRA enables loading multiple LoRA/QLoRA adapters into a single optimized model,
allowing runtime switching between adapters without reloading the base model. This is
critical for serving multiple fine-tuned variants of the same base model efficiently.

## Upstream Dependency

- Olive must expose multi-adapter optimization as a supported pass configuration
- Tracking: https://github.com/microsoft/Olive/issues (multi-adapter milestone)
- Minimum ORT version: 1.21+ (ORT GenAI `Adapters` API / `set_active_adapter` support)

## Schema Extension

### Recipe JSON (backward-compatible)

```json
{
  "passes": {
    "lora": {
      "type": "LoRA",
      "config": {
        "adapter_path": "adapters/customer-support.safetensors"
      }
    }
  },
  "adapters": [
    {
      "name": "customer-support",
      "path": "adapters/customer-support.safetensors",
      "rank": 16,
      "alpha": 32
    },
    {
      "name": "code-generation",
      "path": "adapters/code-gen.safetensors",
      "rank": 16,
      "alpha": 32
    }
  ]
}
```

**Backward compatibility:** When `adapters` is absent or empty, behavior is identical
to v0.2.0 single-adapter mode. The builder ignores unknown keys.

**Current implementation status:** The recipe schema validator accepts the `adapters[]`
field for forward-compatibility validation, but the current builder (`buildOliveRecipe`)
does not consume it — only `passes.lora.config.adapter_path` (single-adapter mode) is
emitted. When both `adapters[].path` and `passes.lora.config.adapter_path` are present,
the validator does not reject this as a conflict; however, only the pass-level
`adapter_path` will be used by the builder until multi-adapter builder support is
implemented (requires Olive >= 0.3.0). For recipes using `adapters[]` today, the
runtime adapter-loading artifacts will NOT be emitted until builder integration (Phase 4)
is complete.

### TypeScript Interface

```typescript
interface AdapterConfig {
  name: string;
  path: string;
  /** Positive integer (> 0). Matches the LoRA pass `lora_rank` constraint. */
  rank: number;
  /** Positive finite number (> 0). */
  alpha: number;
  targetModules?: string[]; // e.g. ["q_proj", "v_proj"]
}

// Added to OliveRecipeSchema (optional field)
interface OliveRecipe {
  // ... existing fields
  adapters?: AdapterConfig[];
}
```

**Validation notes (as of `validateRecipeSchema` in `src/lib/schemaEngine.ts`):**

- `rank` must be a positive integer (`> 0`).
- `alpha` must be a positive finite number (`> 0`, not `NaN` or `Infinity`).
- `targetModules`, when present, must be an array of non-empty strings.

## VRAM Budget Formula

```text
total_vram = base_model_vram + sum(adapter_delta_i for i in active_adapters)

where:
  base_model_vram = estimated VRAM for base model (from buildMaxMemoryMap)
  active_adapters = enabled entries in adapters[]
  adapter_delta_i = rank_i * len(targetModules_i) * hidden_dim * bytes_per_param * 2 / 1e9  (GB)
    - rank_i, targetModules_i: this adapter's own rank and target module list
    - bytes_per_param: dtype-dependent (e.g. 4 for fp32, 2 for fp16/bf16)
    - the "* 2" accounts for both LoRA A and B matrices per targeted module
```

**Assumptions:** This estimate assumes LoRA adapters (A/B low-rank matrices) applied to the
listed `targetModules` only, and that adapter weights use the specified dtype (default
assumption fp16 if unspecified). It may underestimate for QLoRA or other adapter types with
different structures. **Implementation status:** This is Phase 2 (not yet implemented); no
`adapter_delta` calculation currently exists in `src/lib/vramEstimate.ts` or
`src/lib/memoryOffload.ts`.

### Thresholds

| Adapters    | Budget Multiplier | Action                                  |
| ----------- | ----------------- | --------------------------------------- |
| 1 (default) | 100%              | Normal operation                        |
| 2           | 110%              | Warn if exceeded                        |
| 3+          | N/A               | Hard-cap at 2 for consumer GPUs <= 12GB |

### Consumer GPU Mitigation

For GPUs with <= 12GB VRAM:

- Hard-cap at 2 adapters maximum
- Reduce `buildMaxMemoryMap()` GPU budget from 90% to 80% when multi-adapter active
- Extends existing logic in `src/lib/memoryOffload.ts` (`buildMaxMemoryMap()`)

## UI Integration

1. **Recipe Import:** When a recipe contains `adapters[]`, show adapter list in
   InputEnvironmentPanel with per-adapter enable/disable toggles
2. **VRAM Banner:** VramEstimateBanner shows per-adapter delta breakdown
3. **Batch Processing:** Each adapter can be a separate batch job variant
4. **Comparison:** BatchComparisonView shows adapter name as a column

## Runtime Adapter Loading (ORT GenAI Adapters API)

Adapters are prepared/exported via Olive (Olive-prepared adapter artifacts), then loaded at
runtime using the ONNX Runtime GenAI `Adapters` API:

```python
# Load adapters at runtime
adapters = og.Adapters(model)
adapters.load("adapters/customer-support.onnx_adapter", "customer-support")
adapters.load("adapters/code-gen.onnx_adapter", "code-generation")

# Switch active adapter during generation
generator = og.Generator(model, params)
generator.set_active_adapter(adapters, "customer-support")
# ... generate with customer-support adapter ...

generator.set_active_adapter(adapters, "code-generation")
# ... generate with code-generation adapter ...
```

**Key behaviors:**

- Each adapter must be registered with a unique name (the `adapter_name` / `AdapterConfig.name`
  field serves this purpose); loading two adapters with the same name is treated as a conflict.
- **Disabling an adapter:** Stop referencing it as the active adapter (base model behavior
  resumes).
- **Reordering:** Order does not affect runtime behavior since adapters are referenced by name,
  not index/slot.
- **Removing an adapter:** Unload via the Adapters API / drop from the active recipe's
  `adapters[]` list.

**Integration status:** Runtime and builder integration remain BLOCKED until the E2E test in
the Graduation Gate passes (2 adapters loaded, switched at runtime, correct output on ORT 1.21+).

## Graduation Gate

Re-evaluate after Olive 0.3.0 release:

- [ ] Olive >= 0.3.0 documents multi-adapter optimization as supported
- [ ] E2E test: 2 adapters loaded, switched at runtime, correct output on ORT 1.21+
- [ ] VRAM budget <= 110% of single-adapter baseline for 2-adapter config
- [ ] Recipe schema extension backward-compatible with v0.2.0 recipes

## Implementation Phases

1. **Schema scaffolding** (this PR): Optional `adapters[]` field, feature flag
2. **VRAM estimation**: Extend `vramEstimate.ts` with adapter delta calculation
3. **UI wiring**: Adapter list in InputEnvironmentPanel, gated by `multiLora` flag
4. **Builder integration**: Emit runtime adapter-loading config (ORT GenAI `Adapters` API) when adapters present
5. **E2E validation**: Test with real LoRA adapters on CUDA EP
