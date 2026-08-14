# Guided Tour Olive Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `WelcomeModal` with one guided tour that starts with what Olive is, walks the real Model source / Hardware / Recipe controls, advances on real Studio clicks (with Next and arrow keys as fallback), and loads a bundled sample recipe only when the workspace is empty.

**Architecture:** Keep driver.js in `src/lib/tour.ts`. Add a checked-in Olive recipe fixture and `ensureTourDemoModel()` that calls `deriveUiStateFromOliveRecipe` then `replaceState`. `startGuidedTour` uses `allowKeyboardControl`, per-step `advanceOnClick` where a click is the real action, and a shared `advanceFrom` for Next / Right arrow (including sample-recipe inject on Model source). `App.tsx` auto-starts only when `!tourSeen` and the desktop shell is showing.

**Tech Stack:** React 19, Zustand (`usePipelineStore`, `usePreferencesStore`), driver.js 1.8 (`advanceOnClick`, `allowKeyboardControl`, `waitForElement`), Vitest (unit + component).

**Spec:** `docs/superpowers/specs/2026-08-13-guided-tour-olive-overview-design.md`

## Global Constraints

- Package manager is pnpm. Never `npm install`.
- No live Olive runs. No weight downloads. No GitHub fetch for the demo recipe.
- User-facing tour strings must not contain U+2014 (`—`) or U+2013 (`–`).
- Do not say "dummy" or "fixture" in UI copy. Say "sample recipe".
- Do not revert pipeline state when the tour ends or is skipped.
- Never call `replaceState` for the sample if `hasSelectedModel(state)` is already true.
- Auto-start only when `window.innerWidth >= WIDE_SHELL_MIN_WIDTH_PX` (900) and `!tourSeen`. Auto-start never resizes.
- **Take the tour** may grow the window toward 900px when `screen.availWidth >= 900`. App floor is phone width from merged [PR 301](https://github.com/tonythethompson/Olive-Studio/pull/301): `DESKTOP_MIN_WIDTH_PX` = 320, Tauri `minWidth` 320 / `minHeight` 568. Import those constants. Do not start the tour if the window is still under 900 after a resize attempt. Do not put the 600px gate back.
- If `isPipelineOliveRunning()` is true, do not start the tour and do not mutate pipeline state.
- `mcp` stays pinned `<2`. Do not change that pin.
- Tests for this work must not hit the network.

## File map

| File | Responsibility |
|------|----------------|
| `src/data/tour-demo-recipe.json` | Static Olive recipe for `sshleifer/tiny-gpt2` on CPU |
| `src/lib/tour.ts` | Steps, `ensureTourDemoModel`, `startGuidedTour`, `advanceFrom` |
| `src/lib/tourViewport.ts` | `ensureDesktopTourViewport()`: grow toward 900px on Take the tour |
| `src/lib/tour.test.ts` | Unit tests for steps, demo apply, keyboard flags, copy, viewport helper |
| `src/lib/stores/preferencesStore.ts` | Drop `welcomeDismissed` / `dismissWelcome`; keep `tourSeen` and MCP fields |
| `src/App.tsx` | Remove welcome modal; keep PR 301 header compact / `useLayoutEffect` / grid tracks; auto-start on `!tourSeen` + width >= 900; Take the tour may resize |
| `src/components/WelcomeModal.tsx` | Delete |
| `src/components/WelcomeModal.test.tsx` | Delete |
| `src/components/features/input/InputRecipeRail.tsx` | `data-tour="model-source"` plus sample Apply; keep PR 301 `grid-cols-1 sm:grid-cols-3` tabs |
| `src/components/features/ihv/ProviderCardGrid.tsx` | `data-tour="hardware-providers"` on the local-accelerator grid |
| `src/components/features/execute/recipe-graph/RecipeGraphView.tsx` | `data-tour="recipe-graph"` on the PR 301 GraphCanvas overflow wrapper |

## Prerequisite: merge `main` (PR 301)

Before Task 1, merge `origin/main` into `feat/welcome-screen`. PR 301 is already on `main` (`f5a9754e`). That commit is what you want: `DESKTOP_MIN_WIDTH_PX = 320`, Tauri 320×568, header compact on first paint, recipe tabs `grid-cols-1 sm:grid-cols-3`, graph scroll scoped to the canvas wrapper.

Resolve conflicts the same way as the earlier Settings merge: keep both sides. Do not drop 301 header/`useLayoutEffect`/grid-track work when touching `App.tsx`. Do not restore `overflow-x-auto` on the whole `RecipeGraphView` workspace.

```bash
git fetch origin main
git merge origin/main
```

If `App.tsx`, `InputRecipeRail.tsx`, or `RecipeGraphView.tsx` conflict, take `main`'s layout and re-apply this branch's welcome/tour wiring on top.

---

### Task 1: Bundled sample recipe fixture

**Files:**
- Create: `src/data/tour-demo-recipe.json`
- Test: `src/lib/tour.test.ts` (add a `tour demo recipe` describe; keep existing describes)

**Interfaces:**
- Consumes: `deriveUiStateFromOliveRecipe(parsed, { replacePasses: true })` from `src/lib/oliveRecipeHub.ts`; `hasSelectedModel` from `src/lib/pipelineValidation.ts`; `createDefaultPipelineState` from `src/lib/stores/pipelineStore.ts`
- Produces: JSON module at `@/data/tour-demo-recipe.json` with `input_model.config.hf_config.model_name === "sshleifer/tiny-gpt2"` and `CPUExecutionProvider`

- [ ] **Step 1: Write the failing test**

Add this describe to `src/lib/tour.test.ts` (import the JSON even though the file does not exist yet):

```ts
import tourDemoRecipe from "@/data/tour-demo-recipe.json";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { createDefaultPipelineState } from "@/lib/stores/pipelineStore";

describe("tour demo recipe", () => {
  it("derives a selected Hugging Face model on CPU with conversion enabled", () => {
    const derived = deriveUiStateFromOliveRecipe(tourDemoRecipe, { replacePasses: true });
    const state = {
      ...createDefaultPipelineState(),
      ...derived,
      passes: { ...createDefaultPipelineState().passes, ...derived.passes },
    };
    expect(hasSelectedModel(state)).toBe(true);
    expect(state.hfModelId).toBe("sshleifer/tiny-gpt2");
    expect(state.modelSource).toBe("huggingface");
    expect(state.ihvProvider).toBe("CPUExecutionProvider");
    expect(state.passes.conversion).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: FAIL (cannot resolve `@/data/tour-demo-recipe.json`)

- [ ] **Step 3: Write the fixture**

Create `src/data/tour-demo-recipe.json`:

```json
{
  "input_model": {
    "type": "HfModel",
    "config": {
      "hf_config": {
        "model_name": "sshleifer/tiny-gpt2",
        "task": "text-generation"
      },
      "model_path": "sshleifer/tiny-gpt2"
    }
  },
  "systems": {
    "local_system": {
      "type": "LocalSystem",
      "config": {
        "accelerators": [
          {
            "device": "cpu",
            "execution_providers": ["CPUExecutionProvider"]
          }
        ]
      }
    }
  },
  "passes": {
    "conversion": {
      "type": "OnnxConversion",
      "config": {
        "target_opset": 17
      }
    }
  }
}
```

If `deriveUiStateFromOliveRecipe` does not set `ihvProvider` from this `systems` block, adjust only the JSON shape (same model id, still CPU, still a conversion pass) until the test passes. Do not fetch from GitHub.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: PASS (existing tour tests plus the new describe)

- [ ] **Step 5: Commit**

```bash
git add src/data/tour-demo-recipe.json src/lib/tour.test.ts
git commit -m "test: add bundled tour sample recipe fixture"
```

---

### Task 2: `ensureTourDemoModel`

**Files:**
- Modify: `src/lib/tour.ts`
- Modify: `src/lib/tour.test.ts`
- Test: `src/lib/tour.test.ts`

**Interfaces:**
- Consumes: fixture from Task 1; `usePipelineStore.getState().replaceState`; `hasSelectedModel`
- Produces: `export function ensureTourDemoModel(): { applied: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/tour.test.ts`. Import `ensureTourDemoModel` from `./tour` and `usePipelineStore`.

```ts
describe("ensureTourDemoModel", () => {
  beforeEach(() => {
    usePipelineStore.getState().resetState();
  });

  it("applies the sample recipe when no model is selected", () => {
    const result = ensureTourDemoModel();
    expect(result.applied).toBe(true);
    const state = usePipelineStore.getState().state;
    expect(hasSelectedModel(state)).toBe(true);
    expect(state.hfModelId).toBe("sshleifer/tiny-gpt2");
  });

  it("does not overwrite an already selected model", () => {
    usePipelineStore.getState().setState({ hfModelId: "microsoft/phi-2" });
    const result = ensureTourDemoModel();
    expect(result.applied).toBe(false);
    expect(usePipelineStore.getState().state.hfModelId).toBe("microsoft/phi-2");
  });

  it("is a no-op the second time after a successful apply", () => {
    expect(ensureTourDemoModel().applied).toBe(true);
    expect(ensureTourDemoModel().applied).toBe(false);
    expect(usePipelineStore.getState().state.hfModelId).toBe("sshleifer/tiny-gpt2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: FAIL (`ensureTourDemoModel` is not exported)

- [ ] **Step 3: Implement `ensureTourDemoModel` in `src/lib/tour.ts`**

Add imports:

```ts
import tourDemoRecipe from "@/data/tour-demo-recipe.json";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { createDefaultPipelineState, usePipelineStore } from "@/lib/stores/pipelineStore";
```

Add:

```ts
export function ensureTourDemoModel(): { applied: boolean } {
  const store = usePipelineStore.getState();
  if (hasSelectedModel(store.state)) return { applied: false };
  try {
    const derived = deriveUiStateFromOliveRecipe(tourDemoRecipe, { replacePasses: true });
    store.replaceState({
      ...createDefaultPipelineState(),
      ...derived,
      passes: { ...createDefaultPipelineState().passes, ...derived.passes },
    });
    return { applied: hasSelectedModel(usePipelineStore.getState().state) };
  } catch {
    return { applied: false };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour.ts src/lib/tour.test.ts
git commit -m "feat: apply bundled sample recipe only when workspace is empty"
```

---

### Task 3: Rewrite `TOUR_STEPS` (overview first, real anchors, no em dashes)

**Files:**
- Modify: `src/lib/tour.ts` (`TOUR_STEPS`)
- Modify: `src/lib/tour.test.ts` (replace the old element-order assertion)

**Interfaces:**
- Consumes: driver.js `DriveStep` (`element?`, `advanceOnClick?`, `waitForElement?`, `data?`, `popover`)
- Produces: 8-step `TOUR_STEPS`. Step 0 has no `element`. Step `data.id` values: `overview`, `pipeline`, `model-source`, `hardware`, `recipe`, `playground`, `assistant`, `settings`

- [ ] **Step 1: Rewrite the failing structure tests**

Replace the `TOUR_STEPS` describe in `src/lib/tour.test.ts`:

```ts
describe("TOUR_STEPS", () => {
  it("starts with an unanchored Olive overview, then real controls", () => {
    expect(TOUR_STEPS).toHaveLength(8);
    expect(TOUR_STEPS[0]!.element).toBeUndefined();
    expect(TOUR_STEPS[0]!.data).toEqual({ id: "overview" });
    expect(TOUR_STEPS.map((s) => s.element).slice(1)).toEqual([
      'nav[aria-label="Pipeline"]',
      '[data-tour="model-source"]',
      '[data-tour="hardware-providers"]',
      '[data-tour="recipe-graph"]',
      "#playground-heading",
      '[data-tour="assistant"]',
      '[data-tour="settings"]',
    ]);
  });

  it("enables click-to-advance on interaction steps and waits for gated panels", () => {
    const byId = Object.fromEntries(TOUR_STEPS.map((s) => [s.data?.id, s]));
    expect(byId.overview?.advanceOnClick).toBeFalsy();
    expect(byId.pipeline?.advanceOnClick).toBe(true);
    expect(byId["model-source"]?.advanceOnClick).toBeFalsy();
    expect(byId.hardware?.advanceOnClick).toBe(true);
    expect(byId.hardware?.waitForElement).toBe(4000);
    expect(byId.recipe?.advanceOnClick).toBe(true);
    expect(byId.recipe?.waitForElement).toBe(4000);
    expect(byId.assistant?.advanceOnClick).toBe(true);
  });

  it("gives every step a title and description without em or en dashes", () => {
    for (const step of TOUR_STEPS) {
      const title = step.popover?.title ?? "";
      const description = step.popover?.description ?? "";
      expect(title.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
      expect(title + description).not.toMatch(/[—–]/);
    }
  });

  it("explains Olive the toolkit in the first step", () => {
    const text = `${TOUR_STEPS[0]!.popover?.title} ${TOUR_STEPS[0]!.popover?.description}`.toLowerCase();
    expect(text).toContain("olive");
    expect(text).toMatch(/onnx|quantiz|cpu|gpu|npu/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: FAIL (first step still has a pipeline `element`)

- [ ] **Step 3: Replace `TOUR_STEPS` in `src/lib/tour.ts`**

Use this exact copy (no em/en dashes). Keep `side` / `align` as below.

```ts
export const TOUR_STEPS: DriveStep[] = [
  {
    data: { id: "overview" },
    popover: {
      title: "What Olive is",
      description:
        "Olive is Microsoft's open-source toolkit for making machine learning models smaller and faster. It converts models to ONNX and applies optimizations like quantization so they run on your CPU, GPU, or NPU. Olive Studio helps you pick a model, target your hardware, and build that recipe. Press Next or the right arrow to continue.",
      side: "over",
      align: "center",
    },
  },
  {
    data: { id: "pipeline" },
    element: 'nav[aria-label="Pipeline"]',
    advanceOnClick: true,
    popover: {
      title: "Your pipeline",
      description:
        "These four steps are the whole workflow: pick a model, target your hardware, build and run an optimization recipe, then try the result. Click a step to jump to it, or press Next or the arrow keys.",
      side: "right",
      align: "start",
    },
  },
  {
    data: { id: "model-source" },
    element: '[data-tour="model-source"]',
    popover: {
      title: "Model source",
      description:
        "Apply the sample recipe if you do not have a model yet, or apply any other recipe. If a model is already loaded, press Next or the arrow keys. Applying a recipe also moves the tour forward.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "hardware" },
    element: '[data-tour="hardware-providers"]',
    advanceOnClick: true,
    waitForElement: 4000,
    popover: {
      title: "Hardware",
      description:
        "Click a provider card to choose where the optimized model will run (CPU, GPU, or NPU). Next or the arrow keys also work and keep the current provider.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "recipe" },
    element: '[data-tour="recipe-graph"]',
    advanceOnClick: true,
    waitForElement: 4000,
    popover: {
      title: "Recipe and run",
      description:
        "This graph is the Olive recipe. Click a node to inspect it, or press Next or the arrow keys.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "playground" },
    element: "#playground-heading",
    popover: {
      title: "Playground",
      description:
        "Try the optimized model in the browser: in-browser inference, WebGPU benchmarks, and the model Arena. Press Next or the arrow keys to continue.",
      side: "top",
      align: "start",
    },
  },
  {
    data: { id: "assistant" },
    element: '[data-tour="assistant"]',
    advanceOnClick: true,
    popover: {
      title: "The Assistant",
      description:
        "Click Open Assistant to ask questions about Olive and get help building your recipe. Next or the arrow keys also work.",
      side: "bottom",
      align: "end",
    },
  },
  {
    data: { id: "settings" },
    element: '[data-tour="settings"]',
    popover: {
      title: "Replay this tour anytime",
      description:
        "That is the tour. Run it again whenever you like from Settings, Take the tour.",
      side: "bottom",
      align: "end",
    },
  },
];
```

If TypeScript rejects `data` on `DriveStep`, put `data` under a module-level parallel map `TOUR_STEP_IDS` instead and update the tests to read that map. Prefer `data` if the installed driver.js types already include it (`node_modules/driver.js/dist/driver.js.d.ts`).

If `side: "over"` is not in the type union, omit `side`/`align` on the overview step so driver.js centers an unanchored popover.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour.ts src/lib/tour.test.ts
git commit -m "feat: lead the tour with an Olive overview and real control anchors"
```

---

### Task 4: `startGuidedTour` interaction and fallback

**Files:**
- Modify: `src/lib/tour.ts` (`startGuidedTour`)
- Modify: `src/lib/tour.test.ts`

**Interfaces:**
- Consumes: `ensureTourDemoModel` from Task 2; `TOUR_STEPS` from Task 3; `isPipelineOliveRunning` from `src/lib/pipelineNavigation.ts`
- Produces: `startGuidedTour(onSettled: () => void): { drive: () => void; destroy: () => void } | null`. Returns `null` when an Olive job is running. Config includes `allowKeyboardControl: true`. `onNextClick` calls `ensureTourDemoModel()` when the active step `data.id` is `model-source`, then `moveNext()`.

- [ ] **Step 1: Write the failing tests**

Update / add in `src/lib/tour.test.ts`. Extend the hoisted mock so the factory object also has `moveNext`, `getActiveStep`:

```ts
const mocks = vi.hoisted(() => {
  const drive = vi.fn();
  const destroy = vi.fn();
  const moveNext = vi.fn();
  const getActiveStep = vi.fn(() => ({ data: { id: "overview" } }));
  const driverFactory = vi.fn((config: Record<string, unknown>) => ({
    drive,
    destroy,
    moveNext,
    getActiveStep,
    config,
  }));
  return { drive, destroy, moveNext, getActiveStep, driverFactory };
});
```

```ts
describe("startGuidedTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveStep.mockReturnValue({ data: { id: "overview" } });
  });

  it("enables keyboard control and drives immediately", () => {
    startGuidedTour(() => {});
    expect(mocks.driverFactory).toHaveBeenCalledTimes(1);
    expect(mocks.driverFactory.mock.calls[0][0]).toMatchObject({
      steps: TOUR_STEPS,
      allowKeyboardControl: true,
    });
    expect(mocks.drive).toHaveBeenCalledTimes(1);
  });

  it("applies the sample recipe when Next is pressed on Model source with an empty workspace", () => {
    usePipelineStore.getState().resetState();
    mocks.getActiveStep.mockReturnValue({ data: { id: "model-source" } });
    startGuidedTour(() => {});
    const config = mocks.driverFactory.mock.calls[0][0] as {
      onNextClick: () => void;
    };
    config.onNextClick();
    expect(usePipelineStore.getState().state.hfModelId).toBe("sshleifer/tiny-gpt2");
    expect(mocks.moveNext).toHaveBeenCalledTimes(1);
  });

  it("does not clobber an existing model when Next is pressed on Model source", () => {
    usePipelineStore.getState().resetState();
    usePipelineStore.getState().setState({ hfModelId: "microsoft/phi-2" });
    mocks.getActiveStep.mockReturnValue({ data: { id: "model-source" } });
    startGuidedTour(() => {});
    const config = mocks.driverFactory.mock.calls[0][0] as { onNextClick: () => void };
    config.onNextClick();
    expect(usePipelineStore.getState().state.hfModelId).toBe("microsoft/phi-2");
    expect(mocks.moveNext).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not mutate state while an Olive job is running", async () => {
    const { setPipelineOliveRunning } = await import("@/lib/pipelineNavigation");
    usePipelineStore.getState().resetState();
    setPipelineOliveRunning(true);
    try {
      const result = startGuidedTour(() => {});
      expect(result).toBeNull();
      expect(mocks.driverFactory).not.toHaveBeenCalled();
      expect(usePipelineStore.getState().state.hfModelId).toBe("");
    } finally {
      setPipelineOliveRunning(false);
    }
  });

  it("settles exactly once on destroy, whether finished or skipped", () => {
    const onSettled = vi.fn();
    startGuidedTour(onSettled);
    const config = mocks.driverFactory.mock.calls[0][0] as { onDestroyStarted: () => void };
    config.onDestroyStarted();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: FAIL (`allowKeyboardControl` missing and/or no `onNextClick`)

- [ ] **Step 3: Implement `startGuidedTour`**

Replace `startGuidedTour` in `src/lib/tour.ts`:

```ts
import { isPipelineOliveRunning } from "@/lib/pipelineNavigation";

export function startGuidedTour(onSettled: () => void) {
  if (isPipelineOliveRunning()) return null;

  const driverObj = driver({
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "olive-tour-popover",
    allowKeyboardControl: true,
    disableActiveInteraction: false,
    steps: TOUR_STEPS,
    onNextClick: () => {
      const step = driverObj.getActiveStep();
      const id = (step as { data?: { id?: string } } | undefined)?.data?.id;
      if (id === "model-source") {
        ensureTourDemoModel();
      }
      driverObj.moveNext();
    },
    onHighlighted: (_element, step, { driver: activeDriver }) => {
      const id = (step as { data?: { id?: string } }).data?.id;
      if (id !== "model-source") return;
      const unsubscribe = usePipelineStore.subscribe((store) => {
        if (!hasSelectedModel(store.state)) return;
        unsubscribe();
        activeDriver.moveNext();
      });
      (activeDriver.getState() as { __tourUnsub?: () => void }).__tourUnsub = unsubscribe;
    },
    onDeselected: (_element, _step, { driver: activeDriver }) => {
      const extra = activeDriver.getState() as { __tourUnsub?: () => void };
      extra.__tourUnsub?.();
      extra.__tourUnsub = undefined;
    },
    onDestroyStarted: () => {
      onSettled();
      driverObj.destroy();
    },
  });
  driverObj.drive();
  return driverObj;
}
```

If `driver.getState` is awkward to type, keep the unsubscribe in a module-level `let tourModelUnsub: (() => void) | undefined` instead of hanging it on driver state. Clean it in `onDeselected` and `onDestroyStarted`.

Do not set `advanceOnClick` on the Model source step. Catalog search/filter clicks must not advance. Apply (sample or any recipe) flips `hasSelectedModel` and the store subscription advances.

driver.js `allowKeyboardControl` maps Right arrow to the same next path as the Next button (`onNextClick`). Left arrow is previous only. Escape still destroys.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour.ts src/lib/tour.test.ts
git commit -m "feat: advance the tour on real clicks with keyboard fallback"
```

---

### Task 5: `data-tour` anchors and sample Apply control

**Files:**
- Modify: `src/components/features/input/InputRecipeRail.tsx` (the `<aside aria-label="Recipes">` wrapper, around line 112)
- Modify: `src/components/features/ihv/ProviderCardGrid.tsx` (the local-accelerators grid around line 85)
- Modify: `src/components/features/execute/recipe-graph/RecipeGraphView.tsx` (wrap `GraphCanvas`)
- Test: `src/components/WelcomeModal.test.tsx` is the wrong file. Add assertions to existing component tests if present; otherwise add a small `src/components/features/input/InputRecipeRail.tour.test.tsx` only if you can render the rail with stub props. Prefer asserting attributes in `src/lib/tour.test.ts` already done in Task 3. For the sample button, add a focused test file `src/components/features/input/TourSampleApply.test.tsx` if you extract a 20-line button component; otherwise skip a new component file and put the button inline, covered by a unit test of a click handler that calls `ensureTourDemoModel`.

**Interfaces:**
- Consumes: `ensureTourDemoModel` from Task 2
- Produces: DOM anchors `[data-tour="model-source"]`, `[data-tour="tour-sample-apply"]`, `[data-tour="hardware-providers"]`, `[data-tour="recipe-graph"]`

- [ ] **Step 1: Add the sample Apply control to `InputRecipeRail`**

On the root `<aside>` add `data-tour="model-source"`.

Directly above the `<Tabs>` (inside the rounded card), add:

```tsx
<div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
  <div className="min-w-0">
    <p className="text-sm font-medium text-slate-200">Sample recipe</p>
    <p className="text-xs text-slate-500">tiny-gpt2 on CPU. No download required to inspect the next steps.</p>
  </div>
  <button
    type="button"
    data-tour="tour-sample-apply"
    className="shrink-0 inline-flex items-center justify-center rounded-md bg-electric-blue px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-electric-blue-dark cursor-pointer"
    onClick={() => {
      void import("@/lib/tour").then(({ ensureTourDemoModel }) => {
        ensureTourDemoModel();
      });
    }}
  >
    Apply
  </button>
</div>
```

Do not use an em dash in that helper text. "No download required to inspect the next steps." is enough.

- [ ] **Step 2: Tag Hardware and Recipe**

In `ProviderCardGrid.tsx`, on the `div.grid` that maps `detectedLocal`, add `data-tour="hardware-providers"`.

In `RecipeGraphView.tsx` (post-301), `GraphCanvas` already sits in:

```tsx
<div className="flex-1 min-h-0 overflow-auto">
  <GraphCanvas ... />
</div>
```

Add `data-tour="recipe-graph"` to that wrapper. Do not put `overflow-x-auto` back on the outer `flex flex-col h-full min-h-[340px]` workspace.

- [ ] **Step 3: Smoke-check selectors**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: PASS (unchanged)

Optional: `pnpm vitest run --config vitest.component.config.ts src/components/SettingsMenu.test.tsx`

Expected: PASS (`data-tour="settings"` already exists on the gear)

- [ ] **Step 4: Commit**

```bash
git add src/components/features/input/InputRecipeRail.tsx src/components/features/ihv/ProviderCardGrid.tsx src/components/features/execute/recipe-graph/RecipeGraphView.tsx
git commit -m "feat: add tour anchors and a sample recipe apply control"
```

---

### Task 6: First-run wiring and remove `WelcomeModal`

**Files:**
- Create: `src/lib/tourViewport.ts`
- Modify: `src/App.tsx` (import, `welcomeOpen` state ~144-147, auto-start effect ~215-225, `<WelcomeModal>` ~628)
- Modify: `src/lib/stores/preferencesStore.ts` (remove `welcomeDismissed` and `dismissWelcome` only; keep MCP fields and `tourSeen`)
- Delete: `src/components/WelcomeModal.tsx`
- Delete: `src/components/WelcomeModal.test.tsx`
- Test: `src/lib/tourViewport.test.ts` and a preferences assertion in `src/lib/tour.test.ts`

**Interfaces:**
- Consumes: `startGuidedTour` (nullable) from Task 4; `WIDE_SHELL_MIN_WIDTH_PX` (900) and `DESKTOP_MIN_WIDTH_PX` (320) from `src/components/DesktopMinimumViewport.tsx` after the main merge; `isPipelineOliveRunning` from `src/lib/pipelineNavigation.ts`
- Produces: `export async function ensureDesktopTourViewport(): Promise<boolean>` (true iff `innerWidth >= 900` after optional grow). No `WelcomeModal`. Auto-start iff `!tourSeen` and current width >= 900. Settings `onTakeTour` calls `ensureDesktopTourViewport()` then `startGuidedTour`.

- [ ] **Step 1: Extend the preference test**

In `src/lib/tour.test.ts` `guided tour preference` describe:

```ts
it("no longer exposes welcomeDismissed", () => {
  expect(usePreferencesStore.getState()).not.toHaveProperty("welcomeDismissed");
  expect(usePreferencesStore.getState()).not.toHaveProperty("dismissWelcome");
  expect(usePreferencesStore.getState().tourSeen).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tour.test.ts`

Expected: FAIL (`welcomeDismissed` still exists)

- [ ] **Step 3: Remove welcome preference fields**

In `src/lib/stores/preferencesStore.ts`, delete `welcomeDismissed`, `dismissWelcome`, and their initializers. Leave `tourSeen`, `markTourSeen`, `mcpRetrievalMode`, `mcpPreloadEmbeddings`, and theme fields.

Stale `welcomeDismissed` keys already in `olive:preferences` are ignored by Zustand persist.

- [ ] **Step 4: Add `ensureDesktopTourViewport` and rewire `App.tsx`**

Create `src/lib/tourViewport.ts`:

```ts
import { WIDE_SHELL_MIN_WIDTH_PX } from "@/components/DesktopMinimumViewport";

export async function ensureDesktopTourViewport(): Promise<boolean> {
  if (window.innerWidth >= WIDE_SHELL_MIN_WIDTH_PX) return true;
  if (window.screen.availWidth < WIDE_SHELL_MIN_WIDTH_PX) return false;

  const targetW = Math.min(Math.max(WIDE_SHELL_MIN_WIDTH_PX, window.innerWidth), window.screen.availWidth);
  const targetH = Math.min(Math.max(window.innerHeight, 600), window.screen.availHeight);

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await getCurrentWindow().setSize(new LogicalSize(targetW, targetH));
  } catch {
    try {
      window.resizeTo(targetW, targetH);
    } catch {
      return false;
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  return window.innerWidth >= WIDE_SHELL_MIN_WIDTH_PX;
}
```

Add unit tests in `src/lib/tourViewport.test.ts` that mock `innerWidth` / `screen.availWidth`:

- already >= 900: returns true, does not call resize
- availWidth < 900: returns false, does not call resize
- innerWidth 320 and availWidth 1440: calls Tauri `setSize` (mock the dynamic import) or `resizeTo`, then returns true when `innerWidth` is stubbed to 900 after

In `App.tsx`:

1. Remove `import { WelcomeModal } from "@/components/WelcomeModal";`
2. Add `import { isPipelineOliveRunning } from "@/lib/pipelineNavigation";` if not already imported from that module (merge with the existing `pipelineNavigation` import).
3. Delete the `welcomeOpen` / `setWelcomeOpen` state.
4. Replace `startTour` and the auto-start effect:

```ts
const startTour = useCallback((opts?: { allowResize?: boolean }) => {
  if (isPipelineOliveRunning()) return;
  void (async () => {
    if (opts?.allowResize) {
      const { ensureDesktopTourViewport } = await import("@/lib/tourViewport");
      const ready = await ensureDesktopTourViewport();
      if (!ready) return;
    } else if (window.innerWidth < 900) {
      return;
    }
    const { startGuidedTour } = await import("@/lib/tour");
    startGuidedTour(() => usePreferencesStore.getState().markTourSeen());
  })();
}, []);

useEffect(() => {
  if (usePreferencesStore.getState().tourSeen) return;
  const timer = window.setTimeout(() => startTour(), 600);
  return () => window.clearTimeout(timer);
}, [startTour]);
```

5. Delete `<WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />`.
6. Keep `<SettingsMenu onTakeTour={() => startTour({ allowResize: true })} />`.

Use `WIDE_SHELL_MIN_WIDTH_PX` instead of the literal `900` in `App.tsx`. After the 301 merge, `App.tsx` already imports `WIDE_SHELL_MIN_WIDTH_PX` for `headerCompact`. Extend that import. Keep:

- `headerCompact` initialized from `window.innerWidth < WIDE_SHELL_MIN_WIDTH_PX`
- `useLayoutEffect` for the header cluster measure (do not revert to `useEffect`)
- header `grid-cols` tracks from main
- `matchMedia` guard inside `DesktopMinimumViewport` (do not remove it)

- [ ] **Step 5: Delete the modal files**

Delete `src/components/WelcomeModal.tsx` and `src/components/WelcomeModal.test.tsx`. Grep the repo for `WelcomeModal`, `welcomeOpen`, `welcomeDismissed`, `dismissWelcome` and fix any leftover imports (there should be none after App + store).

- [ ] **Step 6: Run tests**

Run:

```
pnpm vitest run src/lib/tour.test.ts
pnpm vitest run --config vitest.component.config.ts src/components/SettingsMenu.test.tsx
```

Expected: PASS. `WelcomeModal.test.tsx` is gone (do not run it).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/lib/stores/preferencesStore.ts src/lib/tour.test.ts src/lib/tourViewport.ts src/lib/tourViewport.test.ts
git add -u src/components/WelcomeModal.tsx src/components/WelcomeModal.test.tsx
git commit -m "feat: make the guided tour the only first-run welcome"
```

---

### Task 7: Spec self-check and targeted verification

**Files:** none new. Read-only check plus tests already added.

- [ ] **Step 1: Grep for leftover welcome surface and banned dashes**

```
# PowerShell
Select-String -Path src/lib/tour.ts,src/components/features/input/InputRecipeRail.tsx -Pattern "WelcomeModal|welcomeDismissed|welcomeOpen|[—–]"
```

Expected: no `WelcomeModal` / `welcomeDismissed` / `welcomeOpen`. No em/en dashes in those files' user-facing strings. Comments may still use ASCII hyphens.

- [ ] **Step 2: Run the full targeted suite**

```
pnpm vitest run src/lib/tour.test.ts
pnpm vitest run --config vitest.component.config.ts src/components/SettingsMenu.test.tsx
pnpm exec eslint src/lib/tour.ts src/App.tsx src/lib/stores/preferencesStore.ts src/components/features/input/InputRecipeRail.tsx src/components/features/ihv/ProviderCardGrid.tsx src/components/features/execute/recipe-graph/RecipeGraphView.tsx --max-warnings 20
```

Expected: tests PASS, eslint exit 0.

- [ ] **Step 3: Manual browser check (when implementing, not in CI)**

1. Clear `olive:preferences` and `olive:pipeline-state` in localStorage, width >= 600. Confirm the first popover is "What Olive is", not a welcome modal and not "Your pipeline".
2. Apply the sample recipe. Confirm Hardware and Recipe unlock and the tour advances.
3. Refresh with that model still loaded. Replay from Settings. Confirm Next on Model source does not change `hfModelId`.
4. Right arrow and Left arrow move forward and back. Escape ends the tour. `tourSeen` becomes true so auto-start does not fire again.

- [ ] **Step 4: Commit only if Step 1-2 produced extra fixes**

```bash
git add -u
git commit -m "fix: finish guided-tour welcome cleanup"
```

Skip this commit if the tree is already clean.

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Drop WelcomeModal / welcomeDismissed | 6 |
| Overview is tour step 1 | 3 |
| Walk real Model / Hardware / Recipe controls | 3, 5 |
| Sample recipe if empty, leave loaded | 1, 2 |
| Never clobber existing model | 2, 4 |
| Click-to-advance on real actions | 4, 5 |
| Next + arrow keys share fallback | 4 |
| Model source Apply (sample or any) advances | 4 (store subscribe) |
| waitForElement after unlock | 3 |
| No em/en dashes | 3, 7 |
| Auto-start `!tourSeen` + width >= 900 (no resize) | 6 |
| Take the tour grows a phone-narrow (320) window when availWidth >= 900 | 6 |
| Merge PR 301 layout (header, rail tabs, graph overflow, 320 gate) | Prerequisite |
| No start while Olive running | 4, 6 |
| Settings replay same steps | 6 (existing `onTakeTour`) |
| No network / no Olive run | 1, 2 |

## Placeholder scan

No TBD, TODO, or "similar to Task N" steps. Function names used later (`ensureTourDemoModel`, `startGuidedTour`, `TOUR_STEPS`, `hasSelectedModel`) are defined in earlier tasks.
