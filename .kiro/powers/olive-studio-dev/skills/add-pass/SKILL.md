---
name: add-pass
description: Add a new optimization pass to Olive Studio. Use when implementing a new Olive pass type, integrating a new quantizer, or adding a new graph transformation to the pipeline.
---

# Add a New Optimization Pass

Complete checklist for adding a new optimization pass to Olive Studio. All steps are required.

## Step 1: Add UIState Fields

**File:** `src/types.ts` → `passes` object

Add toggle and configuration fields:
```typescript
// In the passes interface:
myNewPass: boolean;
myNewPassConfig?: string;  // any method-specific config
```

## Step 2: Add Defaults

**File:** `src/lib/defaultPasses.ts`

Add initial values so the store starts clean:
```typescript
myNewPass: false,
myNewPassConfig: "default_value",
```

## Step 3: Add Builder Function

**File:** `src/lib/oliveRecipeBuilder.ts`

Create the pass builder:
```typescript
function buildMyNewPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.myNewPass) return undefined;
  return {
    type: "MyNewOlivePass",
    config: {
      // map UIState fields to Olive pass config
    },
  };
}
```

Register in `PASS_BUILDERS`:
```typescript
const PASS_BUILDERS = {
  // ... existing entries ...
  my_new_pass: buildMyNewPass,
};
```

## Step 4: Update Pass Ordering

**File:** `src/lib/oliveRecipeBuilder.ts` → `preferredPassOrder()`

Insert at the correct pipeline position relative to dependencies. Consider:
- Does it need ONNX conversion first? → Place after `conversion`
- Is it a torch-native operation? → Place before `conversion`
- Does it conflict with quantization? → Check both orderings

## Step 5: Add Cross-Pass Rules

**File:** `src/lib/pipelineValidation.ts` → `CROSS_PASS_RULES`

Add rules if the pass conflicts with others:
```typescript
{
  id: "my-new-pass-conflict-id",
  applies: (passes, provider) => passes.myNewPass && /* conflict condition */,
  fix: { myNewPass: false },
  autoCoerce: true,  // or false if user should decide
  severity: "critical",
  title: "Human-readable title",
  description: "Why this combination fails.",
  affectedTabs: ["relevant_tabs"],
  affectedPasses: ["my_new_pass", "conflicting_pass"],
  actionLabel: "Fix action label",
}
```

### Auto-coerce rules:
- `true` — silent fix, never surprises user (e.g., disabling redundant pass)
- `false` — shows issue with fix button, user decides

## Step 6: Add Provider Conflicts

**File:** `src/lib/pipelineValidation.ts` → `getProviderConflicts()`

If the pass requires specific hardware:
- GPU-only methods → block on CPU/NPU
- QNN-only passes → block on non-QNN EPs
- Intel-only → block on non-OpenVINO EPs

## Step 7: Register in Pass Catalog

**Client:** `src/lib/passCatalog.ts`
- Add metadata for UI display (name, description, category)

**MCP KB:** `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json`
- Add full entry: name, type, class, description, input/output formats, params, hardware requirements, gotchas

## Step 8: Add UI Component

**Directory:** `src/components/features/` (appropriate panel)

Add toggle switch and configuration controls. Connect to zustand store via `usePipelineStore`.

## Step 9: Add Tests

**Unit tests:** `src/lib/__tests__/`
- Test builder function in isolation
- Test cross-pass rule interactions
- Test provider conflict gates

**Recipe validation:** `scripts/validate-recipe-builder.ts`
- Add combinations that exercise the new pass

## Verification

After all steps:
```bash
pnpm validate:recipe    # Recipe builder smoke test
pnpm test               # Unit tests
pnpm lint:quick         # Quick lint check
```
