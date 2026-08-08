---
inclusion: fileMatch
fileMatchPattern: "**/pipelineValidation*,**/oliveRecipeBuilder*,**/passCatalog*,**/defaultPasses*,**/crossPass*"
---

# Pipeline Validation & Recipe Builder — Modification Rules

When modifying the pipeline validation system, recipe builder, or pass catalog, follow these rules strictly.

## Adding a New Cross-Pass Rule

Cross-pass rules live in the `CROSS_PASS_RULES` array in `src/lib/pipelineValidation.ts`.

Each rule is a `CrossPassRule` object:

```typescript
{
  id: "unique-kebab-id",
  applies: (passes, provider) => boolean,  // True when invalid state exists
  fix: Partial<UIState["passes"]>,         // Patch that resolves the conflict
  autoCoerce: boolean,                     // Silent fix at commit time?
  severity: "critical" | "warning" | "info",
  title: string,
  description: string,
  affectedTabs: string[],
  affectedPasses: string[],
  actionLabel: string,
}
```

### When to use `autoCoerce: true`
- Only for fixes that **never surprise the user** (e.g., disabling ONNX transforms when OpenVINO format is selected).
- The fix must be **idempotent** — applying it twice produces the same result.
- It runs on every `commitUiStateUpdate` call, so it must be cheap.

### When to use `autoCoerce: false`
- When the fix changes something the user explicitly chose (e.g., downgrading quant precision).
- These surface as issues with an "actionLabel" button — the user decides.

## Adding a New Optimization Pass

Complete checklist (all steps required):

1. **Types**: Add UIState fields in `src/types.ts` → `passes` object.
2. **Defaults**: Add defaults in `src/lib/defaultPasses.ts`.
3. **Builder**: Add builder function in `src/lib/oliveRecipeBuilder.ts` → register in `PASS_BUILDERS`.
4. **Pass ordering**: Insert into `preferredPassOrder()` at the correct pipeline position.
5. **Cross-pass rules**: Add rules in `CROSS_PASS_RULES` if the new pass conflicts with others.
6. **Provider conflicts**: Update `getProviderConflicts()` if the pass requires specific hardware.
7. **Pass catalog**: Add to `src/lib/passCatalog.ts` (client-side) AND `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json` (MCP KB).
8. **UI component**: Add toggle/config UI in the appropriate feature panel.
9. **Tests**: Add test coverage in `src/lib/__tests__/` and update `scripts/validate-recipe-builder.ts`.

## Provider Conflicts

Provider conflict checks live in `getProviderConflicts()`. Rules follow this pattern:

- GPU-only methods (AWQ, GPTQ, SpinQuant, QuaRot) → blocked on CPU/NPU providers
- HQQ/RTN → only CPU or CUDA
- QAT → blocked on QNN
- Structured pruning → requires tensor-core providers
- QLoRA → inefficient on CPU (warning, not blocking)

When adding a new method, determine which EPs support it and add the appropriate gate.

## Recipe Builder Pass Ordering

The `preferredPassOrder()` function determines Olive pass execution order:

**For PyTorch-native quant (AWQ/GPTQ/SpinQuant/QuaRot):**
```
peft → pruning → quantization → conversion → transformer_opt → float16 → splitting
```

**For ONNX-path quant (PTQ/HQQ/RTN/QAT):**
```
peft → pruning → conversion → transformer_opt → quantization → float16 → splitting
```

Insert new passes at the correct position relative to their dependencies.

## Schema Engine Registration

New pass types must be recognized by `isKnownPass()` in `src/lib/schemaEngine.ts`. This function checks against both the static catalog and dynamically loaded passes from the MCP KB. If a pass type is unknown, `getPassCatalogIssues()` will flag a "critical" issue blocking execution.

## Testing Requirements

- `scripts/validate-recipe-builder.ts` must cover the new pass combination.
- Unit tests in `src/lib/__tests__/` must test the builder function in isolation.
- If the pass has provider gates, test that incompatible providers produce validation issues.
- If the pass interacts with other passes (coercion), test the coercion path.
