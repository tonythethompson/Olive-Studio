import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import tourDemoRecipe from "@/data/tour-demo-recipe.json";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { isPipelineOliveRunning } from "@/lib/pipelineNavigation";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { createDefaultPipelineState, usePipelineStore } from "@/lib/stores/pipelineStore";

let tourModelUnsub: (() => void) | undefined;
let tourActive = false;

/**
 * Loads the bundled sample recipe when the workspace has no model selected.
 *
 * @returns Whether a sample recipe was applied
 */
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

/**
 * Guided tour steps: Olive overview, then real pipeline controls.
 * Interaction steps use click-to-advance; Model source waits for a real Apply.
 */
export const TOUR_STEPS: DriveStep[] = [
  {
    data: { id: "overview" },
    popover: {
      title: "What Olive is",
      description:
        "Olive is Microsoft's open-source toolkit for making machine learning models smaller and faster. It converts models to ONNX and applies optimizations like quantization so they run on your CPU, GPU, or NPU. Olive Studio helps you pick a model, target your hardware, and build that recipe. Press Next or the right arrow to continue.",
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

function stepId(step: DriveStep | undefined): string | undefined {
  const data = step?.data as { id?: string } | undefined;
  return data?.id;
}

/**
 * Starts the guided tour and handles completion or dismissal.
 *
 * @param onSettled - Callback invoked once when the tour ends or is skipped
 * @returns The tour instance, or null when an Olive job is running or a tour is already active
 */
export function startGuidedTour(onSettled: () => void) {
  if (isPipelineOliveRunning() || tourActive) return null;

  tourActive = true;
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
      if (stepId(driverObj.getActiveStep()) === "model-source") {
        ensureTourDemoModel();
      }
      driverObj.moveNext();
    },
    onHighlighted: (_element, step) => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
      if (stepId(step) !== "model-source") return;
      tourModelUnsub = usePipelineStore.subscribe((store) => {
        if (!hasSelectedModel(store.state)) return;
        tourModelUnsub?.();
        tourModelUnsub = undefined;
        driverObj.moveNext();
      });
    },
    onDeselected: () => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
    },
    onDestroyStarted: () => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
      tourActive = false;
      onSettled();
      driverObj.destroy();
    },
  });
  driverObj.drive();
  return driverObj;
}
