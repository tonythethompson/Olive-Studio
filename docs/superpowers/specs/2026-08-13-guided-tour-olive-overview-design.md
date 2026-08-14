# Guided tour: Olive overview and live pipeline walkthrough

**Status:** Approved for implementation planning
**Branch:** `feat/welcome-screen`
**Date:** 2026-08-13

## Problem

First-run onboarding has two surfaces that do not work as a single story:

1. `WelcomeModal` can be skipped. If `welcomeDismissed` is already true, or the user only uses **Settings → Take the tour**, the session starts on the UI walkthrough with no explanation of what Olive is or why it exists.
2. The tour only highlights section headings. Hardware and Recipe & run stay locked behind `hasSelectedModel`, so a first-time user never sees the real configurable controls.

## Goal

One guided tour is the entire welcome. It starts with what Olive is and why it is useful, then walks the real Model source, Hardware, and Recipe & run controls. The preferred way to move forward is to do the real action in Studio (apply a recipe, pick a provider, click the recipe graph). Next and the arrow keys are a fallback. If the workspace has no model and they skip Model source without applying one, the tour loads a tiny CPU demo recipe so later panels unlock. That demo **stays loaded** after the tour. If a model is already selected, the tour never replaces it.

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

| # | Title | Anchor | Advance by doing | Fallback (Next / Right arrow) |
|---|--------|--------|------------------|-------------------------------|
| 1 | What Olive is | none (centered popover) | None. Read, then Next or Right arrow. | Next / Right arrow. |
| 2 | Your pipeline | `nav[aria-label="Pipeline"]` | Click a pipeline step in the nav. The click navigates as usual and the tour advances. | Next / Right arrow (no nav change required). |
| 3 | Model source | `data-tour="model-source"` wrapping the real recipe list plus a sample Apply control | Click **Apply** on the sample recipe (bundled fixture, no network) or Apply on any other visible recipe. Native apply runs, then the tour advances once `hasSelectedModel` is true. | Next / Right arrow. If still no model, apply the bundled demo, then advance. |
| 4 | Hardware | `data-tour="hardware-providers"` on the provider cards | Click a provider card. The selection commits as usual and the tour advances. Wait for the gate to unlock (`waitForElement`) after step 3. Fallback anchor: `#ihv-heading`. | Next / Right arrow. Keep the current provider. |
| 5 | Recipe & run | `data-tour="recipe-graph"` on the recipe graph | Click the graph (or a pass node). Native inspector/selection runs and the tour advances. Fallback anchor: `#execute-heading`. | Next / Right arrow. |
| 6 | Playground | `#playground-heading` | Optional: click the Playground nav item. | Next / Right arrow. |
| 7 | Assistant | `[data-tour="assistant"]` | Click Open Assistant. The sidebar opens and the tour advances. | Next / Right arrow (sidebar stays closed). |
| 8 | Replay | `[data-tour="settings"]` | Click Settings or Done. | Done / Right arrow ends the tour. |

Driver.js `showProgress` counts popover steps (1-8) only.

### Interaction vs fallback

- **Preferred:** the user performs the real Studio action on the highlighted control. `disableActiveInteraction` stays false. Use driver.js `advanceOnClick` on steps 2-7 (and a click listener on the sample Apply if the highlight is a larger region so only Apply, not search/filters, advances).
- **Fallback:** Next and keyboard. Set `allowKeyboardControl: true`. Right arrow and Next share one `advanceFrom(step)` helper (same demo-inject rules). Left arrow and Back only go to the previous step. Escape still closes the tour.
- Popover copy on interaction steps says what to click, then that Next or the arrow keys also work. No em dashes.
- If a model is already selected on step 3, copy says it is already loaded. Clicking Apply is optional; Next / Right arrow must not call `replaceState`.

### Demo model

- **When:** when leaving step 3 (click-to-advance after a successful Apply, or fallback Next / Right arrow), and only if `hasSelectedModel` is still false. A user who applied the sample or any other recipe has already selected a model, so the tour must not overwrite it.
- **What:** a checked-in Olive recipe JSON at `src/data/tour-demo-recipe.json`. It must be a valid recipe for a tiny Hugging Face model targeting `CPUExecutionProvider`, with enough passes that the recipe graph is not an empty default.
- **How:** `deriveUiStateFromOliveRecipe(fixture, { replacePasses: true })` then `replaceState` onto the current store so `hfModelId` is non-empty and `hasSelectedModel` becomes true. No network. No Olive process.
- **After the tour:** leave that state in the persisted pipeline store. The user can keep using Hardware and Recipe & run.
- **Replay with a model already loaded:** do not call `replaceState` for the demo.

Recommended fixture identity (implementation may substitute an equally tiny CPU recipe if schema tests require it): `sshleifer/tiny-gpt2` on CPU. The fixture is a static file; the catalog row of the same name is not required at runtime.

### Copy constraints

Step 1 must explain Olive the toolkit, not only Olive Studio chrome. Do not put engineering details in user-facing strings (viewport breakpoints, store keys, "dummy," "fixture"). If the tour injected a model, later steps may say a **sample recipe** is loaded so they can see the next panels, not that a test dummy was injected. Interaction steps tell the user what to click, then that Next or the arrow keys also work.

**No em dashes.** User-facing tour copy (titles, descriptions, buttons) must not use U+2014 (em dash, `—`) or U+2013 (en dash, `–`). Use a comma, colon, period, or parentheses instead. Remove any existing em/en dashes from tour popovers and from first-run strings this work replaces. Do not introduce them in new copy. Tests should reject `—` and `–` in `TOUR_STEPS` popover text.

## Architecture

```text
App.tsx
  auto-start iff !tourSeen && desktop viewport
  SettingsMenu.onTakeTour → startGuidedTour
  no WelcomeModal

src/lib/tour.ts
  TOUR_STEPS (8 popovers)
  startGuidedTour(onSettled)
  advanceFrom(step) : Next, Right arrow, and click-to-advance
  ensureTourDemoModel() : only if leaving Model source with no model selected

src/data/tour-demo-recipe.json
  static Olive recipe

src/lib/stores/preferencesStore.ts
  tourSeen only (welcomeDismissed removed)

src/lib/stores/pipelineStore.ts
  unchanged API; tour calls replaceState only when injecting
```

### Data flow

1. `startGuidedTour` builds a driver.js instance with `TOUR_STEPS`, `allowKeyboardControl: true`, and `advanceOnClick` on interaction steps. `onNextClick` / keyboard Right both call `advanceFrom`.
2. `advanceFrom` on Model source: if `!hasSelectedModel`, apply the fixture via `replaceState`. Wait for Hardware targets (`waitForElement` or one animation frame / `flushSync` if tests require it), then `moveNext()`.
3. A successful Apply on the sample (or any recipe) makes `hasSelectedModel` true before `advanceFrom` runs, so the fixture is not applied.
4. `onDestroyStarted` always calls `onSettled` once (`markTourSeen`). Demo or user-applied state is not reverted.

`ensureTourDemoModel()` returns `{ applied: boolean }` so tests can assert the no-clobber path without mounting driver.js.

### Error handling

| Condition | Behavior |
|-----------|----------|
| `isPipelineOliveRunning()` | Do not auto-start. Settings replay is a no-op (or a single toast using the existing nav-blocked message). Do not mutate pipeline state. |
| Demo apply throws or does not satisfy `hasSelectedModel` | Log nothing user-facing. Continue the tour. Hardware/Recipe stay locked; popovers fall back to section headings. |
| Viewport narrower than `DESKTOP_MIN_WIDTH_PX` | Do not auto-start. Starting from Settings is allowed only if the desktop shell is showing. |
| Missing `data-tour` target | Driver.js highlights the fallback heading. The tour does not crash. |

## Testing

- **Unit (`tour.test.ts`):** step 1 has no `element` and a non-empty Olive overview; remaining anchors match the table; interaction steps set `advanceOnClick`; `allowKeyboardControl` is true; `advanceFrom` / `ensureTourDemoModel` applies the fixture iff `hasSelectedModel` is false; applying twice / applying when `hfModelId` is already set does not overwrite that id; `startGuidedTour` still settles once on destroy; popover text contains no `—` or `–`.
- **Unit (preferences):** `welcomeDismissed` / `dismissWelcome` are gone; `tourSeen` still persists via `markTourSeen`.
- **Component:** delete `WelcomeModal.test.tsx`. Add `data-tour` assertions on Model source / Hardware / Recipe graph if those files already have component tests; otherwise a shallow render in the tour test file is enough.
- **No live Olive, no network in these tests.** Import the fixture as JSON.

## Files

| Action | Path |
|--------|------|
| Delete | `src/components/WelcomeModal.tsx`, `src/components/WelcomeModal.test.tsx` |
| Edit | `src/App.tsx`: remove modal; auto-start only on `!tourSeen` + desktop |
| Edit | `src/lib/tour.ts`, `src/lib/tour.test.ts` |
| Edit | `src/lib/stores/preferencesStore.ts` (+ existing preference tests if any) |
| Edit | Model source / IHV / recipe graph markup for `data-tour` |
| Add | `src/data/tour-demo-recipe.json` |

## Success criteria

1. A clean first launch (no `tourSeen`) opens the tour on the Olive overview, not a separate modal and not “Your pipeline.”
2. Settings replay includes that overview.
3. Empty workspace: applying the sample recipe (or any recipe) unlocks Hardware and Recipe & run and advances the tour. Skipping with Next or Right arrow loads the same sample and still unlocks those panels. The loaded recipe is still there after Done/Skip.
4. Workspace that already has a model: that model and recipe are unchanged through the whole tour, including Next / arrow fallback on Model source.
5. Clicking the highlighted control performs the real Studio action and advances. Right arrow and Next also advance. Left arrow goes back.
6. No WelcomeModal remains in the tree or tests.
