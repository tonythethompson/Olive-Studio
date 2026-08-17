---
name: olive-recipe-builder
description: Build, validate, and export Olive optimization recipes in Olive Studio. Use when constructing a recipe from the pipeline UI state, running the recipe builder smoke test, modifying pipelineValidation/oliveRecipeBuilder/passCatalog, or adding cross-pass compatibility rules.
---

# Olive Recipe Builder

Build, validate, and export Olive optimization recipes. Olive Studio translates a pipeline UI state (`UIState`) into an Olive recipe JSON via `src/lib/oliveRecipeBuilder.ts`, then validates it with `src/lib/pipelineValidation.ts`.

## Core Flow

```
UIState (zustand)  ──buildRecipe()──►  PassSpec[]  ──►  Olive recipe JSON
                                                          │
                                            validate() ◄──┘   (CROSS_PASS_RULES + getProviderConflicts)
```

## Quick Commands

```bash
pnpm validate:recipe      # Recipe builder smoke test (CPU-only, always safe)
pnpm test                 # Unit tests in src/lib/ — covers builders + validation
pnpm lint:quick           # oxlint on src/
```

These are CPU-only. **Never** trigger live Olive execution ("Execute Live" / `submit_optimization_job` / `execute_and_observe`) — that downloads models + CUDA wheels.

## Recipe JSON Structure

```json
{
  "input_model": {
    "type": "HfModel",
    "config": { "model_path": "meta-llama/Llama-3-8B", "task": "text-generation", "trust_remote_code": false }
  },
  "systems": {
    "local_system": { "type": "LocalSystem", "config": { "accelerators": ["gpu"] } }
  },
  "passes": {
    "conversion":    { "type": "OnnxConversion", "config": {} },
    "quantization":  { "type": "OnnxQuantization", "config": {} }
  },
  "engine": { "search_strategy": false, "host": "local_system", "target": "local_system", "output_dir": "./models/optimized" }
}
```

`search_strategy: false` is the Studio default — fixed pipeline, no architecture search.

## Pass Ordering

`preferredPassOrder()` in `oliveRecipeBuilder.ts` fixes execution order. Order depends on the quantization family:

**Standard ONNX path** (PTQ, HQQ, RTN, QAT, KQuant):
```
peft → pruning → conversion → transformer_opt → quantization → splitting
```

**PyTorch-native quant** (AWQ, GPTQ, SpinQuant, QuaRot):
```
peft → pruning → quantization → conversion → transformer_opt → splitting
```

PyTorch-native quantizers operate on torch models, so they run *before* ONNX conversion. Insert new passes at the correct position relative to their dependencies.

## Builder Pattern

Each pass has a builder in `oliveRecipeBuilder.ts`, registered in `PASS_BUILDERS`:

```typescript
function buildMyPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.myPass) return undefined;
  return { type: "MyOlivePass", config: { /* map UIState → Olive config */ } };
}

const PASS_BUILDERS = { /* ... */ my_pass: buildMyPass };
```

## Validation Rules

Cross-pass rules live in `CROSS_PASS_RULES` (`pipelineValidation.ts`). Each rule:

```typescript
{
  id: "unique-kebab-id",
  applies: (passes, provider) => boolean,   // true when invalid state exists
  fix: Partial<UIState["passes"]>,           // patch that resolves the conflict
  autoCoerce: boolean,                       // silent fix at commit time?
  severity: "critical" | "warning" | "info",
  title: string,
  description: string,
  affectedTabs: string[],
  affectedPasses: string[],
  actionLabel: string,
}
```

**`autoCoerce: true`** — only for idempotent fixes that never surprise the user (e.g., disabling ONNX transforms when OpenVINO format is selected). Runs on every `commitUiStateUpdate`, must be cheap.

**`autoCoerce: false`** — surfaces as an issue with a fix button; the user decides (e.g., downgrading quant precision).

### Cross-Pass Compatibility (invalid combinations)

| Combination | Issue | Auto-fixed? |
|---|---|---|
| ONNX quant/transforms without conversion | No ONNX graph | No — user enables |
| LoRA + INT4/INT8 quant | Must use QLoRA | Yes → QLoRA |
| Pruning + INT4 quant | Double compression | Yes → INT8 |
| OpenVINO format + ONNX transforms | Redundant/conflicting | Yes → disable |
| Model splitting + QAT | QAT needs unbroken weights | Yes → disable splitting |
| QLoRA on CPU provider | Needs CUDA kernels | No — user decides |
| OpenVINO format + non-OpenVINO EP | Runtime failure | No — user fixes |
| QairtPipeline + OnnxDiscrepancyCheck | QAIRT produces no ONNX | Yes → disable check |
| QairtPipeline without QNN EP | QAIRT is QNN-only | Yes → disable QAIRT |
| MobiusBuilder + QNN EP | MobiusBuilder is CPU/CUDA only | Yes → disable MobiusBuilder |

Provider conflict checks live in `getProviderConflicts()`:
- GPU-only (AWQ, GPTQ, SpinQuant, QuaRot) → blocked on CPU/NPU
- HQQ/RTN → CPU or CUDA only
- QAT → blocked on QNN
- Structured pruning → requires tensor-core providers
- QLoRA on CPU → warning, not blocking

## Schema Engine

New pass types must be recognized by `isKnownPass()` in `src/lib/schemaEngine.ts`. It checks the static catalog AND dynamically loaded passes from the MCP KB. Unknown pass types → `getPassCatalogIssues()` flags a "critical" issue blocking execution.

## Common Gotchas

- Models >2GB require `use_external_data_format: true` in ONNX conversion
- Dynamic shapes must be declared via `dynamic_axes`
- `trust_remote_code: true` is opt-in for HF models with custom code
- `passRecipeOverrides` are applied after building (expert users)

## When Modifying the Builder / Validation

Follow `.kiro/steering/pipeline-validation-rules.md` strictly. See the **olive-pass-checklist** skill for the full add-a-pass checklist. After changes:

```bash
pnpm validate:recipe && pnpm test && pnpm lint:quick
```
