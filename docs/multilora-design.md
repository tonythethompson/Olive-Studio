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
- Minimum ORT version: 1.21+ (LoRA adapter slot-mapping support)

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
slot-mapping output will NOT be emitted until builder integration (Phase 4) is complete.

### TypeScript Interface

```typescript
interface AdapterConfig {
  name: string;
  path: string;
  rank: number;
  alpha: number;
  targetModules?: string[]; // e.g. ["q_proj", "v_proj"]
}

// Added to OliveRecipeSchema (optional field)
interface OliveRecipe {
  // ... existing fields
  adapters?: AdapterConfig[];
}
```

## VRAM Budget Formula

```
total_vram = base_model_vram + N * adapter_delta

where:
  base_model_vram = estimated VRAM for base model (from buildMaxMemoryMap)
  N = number of active adapters
  adapter_delta = rank * hidden_dim * 2 bytes * num_layers / 1e9  (GB)
```

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

## Slot-Mapping Schema (ORT 1.21+)

```json
{
  "session_options": {
    "lora_config": {
      "slot_mapping": {
        "0": "adapters/customer-support.safetensors",
        "1": "adapters/code-gen.safetensors"
      },
      "active_slot": 0
    }
  }
}
```

Runtime switching is done via `session.set_lora_slot(index)` without model reload.

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
4. **Builder integration**: Emit slot-mapping config when adapters present
5. **E2E validation**: Test with real LoRA adapters on CUDA EP
