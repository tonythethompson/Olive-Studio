# Guided tour: Olive overview and live pipeline walkthrough

**Status:** Approved for implementation planning
**Branch:** `feat/welcome-screen`
**Date:** 2026-08-13

## Problem

First-run onboarding has two surfaces that do not work as a single story:

1. `WelcomeModal` can be skipped. If `welcomeDismissed` is already true, or the user only uses **Settings → Take the tour**, the session starts on the UI walkthrough with no explanation of what Olive is or why it exists.
2. The tour only highlights section headings. Hardware and Recipe & run stay locked behind `hasSelectedModel`, so a first-time user never sees the real configurable controls.

## Goal

One guided tour is the entire welcome. It starts with what Olive is and why it is useful, then walks the real Model source, Hardware, and Recipe & run controls. If the workspace has no model, the tour loads a tiny CPU demo recipe and **leaves it loaded** after the tour. If a model is already selected, the tour never replaces it.

## Non-goals

- Do not download model weights.
- Do not run Olive (`Execute Live` / batch).
- Do not fetch the demo recipe from GitHub or the network.
- Do not roll back the demo when the tour finishes or is skipped.
- Do not add a second welcome dialog.
- Do not auto-start the tour below the desktop minimum viewport.

## UX

### First-run

On desktop, if `tourSeen` is false, auto-start the tour after the dashboard has painted (keep the existing ~600ms delay). Finishing or skipping the tour calls `markTourSeen`. Replay is always **Settings → Take the tour** and uses the same step list.

### Removed

- `WelcomeModal` and its tests
- `welcomeOpen` gating in `App.tsx`
- `welcomeDismissed` / `dismissWelcome` on the preferences store

Stale `welcomeDismissed` values already in `olive:preferences` are ignored. A user who dismissed the old modal but never finished the tour still auto-starts the new tour (they have not seen the Olive overview).

### Step list

| # | Title | Anchor | Notes |
|---|--------|--------|--------|
| 1 | What Olive is | none (centered popover) | What Olive is; why it exists (models too big/slow → smaller/faster on CPU, GPU, or NPU); one line that this app builds and runs that recipe. |
| 2 | Your pipeline | `nav[aria-label="Pipeline"]` | Existing copy. |
| 3 | Model source | `data-tour="model-source"` on the real recipe/model controls (catalog / apply area), not only `#input-heading` | Point at choosing a recipe or model. |
| — | *(side effect)* | — | If `!hasSelectedModel(state)`, apply the bundled demo. If a model is already selected, no-op. |
| 4 | Hardware | `data-tour="hardware-providers"` on the provider/pass controls | Only after the demo apply (or existing model) has flushed so `PipelineSectionGate` is unlocked. Fallback: `#ihv-heading` if the inner target is missing. |
| 5 | Recipe & run | `data-tour="recipe-graph"` on the recipe graph | Same unlock/fallback rule (`#execute-heading`). |
| 6 | Playground | `#playground-heading` | Existing copy. |
| 7 | Assistant | `[data-tour="assistant"]` | Existing copy. |
| 8 | Replay | `[data-tour="settings"]` | Existing copy. |

Driver.js `showProgress` continues to count only popover steps (1–8). The demo apply is not a user-facing step.

### Demo model

- **When:** immediately after the user leaves step 3, and only if `hasSelectedModel` is false at that moment.
- **What:** a checked-in Olive recipe JSON at `src/data/tour-demo-recipe.json`. It must be a valid recipe for a tiny Hugging Face model targeting `CPUExecutionProvider`, with enough passes that the recipe graph is not an empty default.
- **How:** `deriveUiStateFromOliveRecipe(fixture, { replacePasses: true })` then `replaceState` onto the current store so `hfModelId` is non-empty and `hasSelectedModel` becomes true. No network. No Olive process.
- **After the tour:** leave that state in the persisted pipeline store. The user can keep using Hardware and Recipe & run.
- **Replay with a model already loaded:** do not call `replaceState` for the demo.

Recommended fixture identity (implementation may substitute an equally tiny CPU recipe if schema tests require it): `sshleifer/tiny-gpt2` on CPU. The fixture is a static file; the catalog row of the same name is not required at runtime.

### Copy constraints

Step 1 must explain Olive the toolkit, not only Olive Studio chrome. Do not put engineering details in user-facing strings (viewport breakpoints, store keys, “dummy,” “fixture”). If the tour injected a model, later steps may say a **sample recipe** is loaded so they can see the next panels — not that a test dummy was injected.

## Architecture

```text
App.tsx
  auto-start iff !tourSeen && desktop viewport
  SettingsMenu.onTakeTour → startGuidedTour
  no WelcomeModal

src/lib/tour.ts
  TOUR_STEPS (8 popovers)
  startGuidedTour(onSettled)
  ensureTourDemoModel() — pure-enough helper used from onNextClick after step 3

src/data/tour-demo-recipe.json
  static Olive recipe

src/lib/stores/preferencesStore.ts
  tourSeen only (welcomeDismissed removed)

src/lib/stores/pipelineStore.ts
  unchanged API; tour calls replaceState only when injecting
```

### Data flow

1. `startGuidedTour` builds a driver.js instance with `TOUR_STEPS`.
2. `onNextClick` for the transition out of Model source: if `!hasSelectedModel(usePipelineStore.getState().state)`, apply the fixture via `replaceState`. Wait one animation frame (or `flushSync` if tests require it) so gated panels mount, then `moveNext()`.
3. `onDestroyStarted` always calls `onSettled` once (`markTourSeen`). Demo state is not reverted here.

`ensureTourDemoModel()` returns `{ applied: boolean }` so tests can assert the no-clobber path without mounting driver.js.

### Error handling

| Condition | Behavior |
|-----------|----------|
| `isPipelineOliveRunning()` | Do not auto-start. Settings replay is a no-op (or a single toast using the existing nav-blocked message). Do not mutate pipeline state. |
| Demo apply throws or does not satisfy `hasSelectedModel` | Log nothing user-facing. Continue the tour. Hardware/Recipe stay locked; popovers fall back to section headings. |
| Viewport narrower than `DESKTOP_MIN_WIDTH_PX` | Do not auto-start. Starting from Settings is allowed only if the desktop shell is showing. |
| Missing `data-tour` target | Driver.js highlights the fallback heading. The tour does not crash. |

## Testing

- **Unit (`tour.test.ts`):** step 1 has no `element` and a non-empty Olive overview; remaining anchors match the table; `ensureTourDemoModel` applies the fixture iff `hasSelectedModel` is false; applying twice / applying when `hfModelId` is already set does not overwrite that id; `startGuidedTour` still settles once on destroy.
- **Unit (preferences):** `welcomeDismissed` / `dismissWelcome` are gone; `tourSeen` still persists via `markTourSeen`.
- **Component:** delete `WelcomeModal.test.tsx`. Add `data-tour` assertions on Model source / Hardware / Recipe graph if those files already have component tests; otherwise a shallow render in the tour test file is enough.
- **No live Olive, no network in these tests.** Import the fixture as JSON.

## Files

| Action | Path |
|--------|------|
| Delete | `src/components/WelcomeModal.tsx`, `src/components/WelcomeModal.test.tsx` |
| Edit | `src/App.tsx` — remove modal; auto-start only on `!tourSeen` + desktop |
| Edit | `src/lib/tour.ts`, `src/lib/tour.test.ts` |
| Edit | `src/lib/stores/preferencesStore.ts` (+ existing preference tests if any) |
| Edit | Model source / IHV / recipe graph markup for `data-tour` |
| Add | `src/data/tour-demo-recipe.json` |

## Success criteria

1. A clean first launch (no `tourSeen`) opens the tour on the Olive overview, not a separate modal and not “Your pipeline.”
2. Settings replay includes that overview.
3. Empty workspace: after Model source, Hardware and Recipe & run are unlocked and the tour highlights their real controls. The sample recipe is still there after Done/Skip.
4. Workspace that already has a model: that model and recipe are unchanged through the whole tour.
5. No WelcomeModal remains in the tree or tests.
